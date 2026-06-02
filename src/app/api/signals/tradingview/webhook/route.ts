import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { tvAlertConfigs, tvAlerts, tvPositions, tradingAccounts } from '@/lib/db/schema';
import { computeTradeParams, validatePayload } from '@/lib/signals/tv-alert';
import { getBreakerContext } from '@/lib/signals/breaker-context';
import {
  findOpenPositionForSymbol,
  applyTargetReached,
  applyInvalidationHit,
} from '@/lib/signals/tv-positions';
import { computeRiskMultiplier, getWatermark, maybeSnapshotDailyBalance } from '@/lib/signals/watermark';
import { withRpcTrade } from '@/lib/metaapi-trade';
import { checkMargin, evaluateMargin } from '@/lib/signals/margin';
import type {
  TvAlertConfig,
  TvAlertPayload,
  TvAlertStatus,
} from '@/types/tv-alerts';

/**
 * POST /api/signals/tradingview/webhook
 *
 * Receives JSON alerts from a TradingView indicator (Unicorn° Pro+ or
 * similar). Authenticated via TRADINGVIEW_WEBHOOK_SECRET in the body.
 *
 * Dispatch by alert_type:
 *   activation       — open a trade (lot sized to current risk %)
 *   target_reached   — manage open position by R-level
 *   invalidation_hit — close any open position for the instrument
 *   invalidation_warning, potential_breaker — logged only
 *
 * See tv_alert_indicator.pine for the canonical payload templates.
 */
export async function POST(request: NextRequest) {
  const t0 = Date.now();

  const webhookSecret = process.env.TRADINGVIEW_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[tv-webhook] TRADINGVIEW_WEBHOOK_SECRET not configured');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  let rawBody: string;
  let body: Partial<TvAlertPayload>;
  try {
    rawBody = await request.text();
    body = JSON.parse(rawBody) as Partial<TvAlertPayload>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (body.secret !== webhookSecret) {
    return NextResponse.json({ error: 'Invalid secret' }, { status: 401 });
  }

  const validation = validatePayload(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.reason }, { status: 400 });
  }
  const payload = body as TvAlertPayload;

  // ── Resolve config (per-instrument, enabled, optionally per-account) ──
  const where = payload.account_id
    ? and(
        eq(tvAlertConfigs.tvSymbol, payload.tv_symbol),
        eq(tvAlertConfigs.accountId, payload.account_id),
        eq(tvAlertConfigs.isEnabled, true),
      )
    : and(
        eq(tvAlertConfigs.tvSymbol, payload.tv_symbol),
        eq(tvAlertConfigs.isEnabled, true),
      );

  const [configRow] = await db.select().from(tvAlertConfigs).where(where).limit(1);

  if (!configRow) {
    await db.insert(tvAlerts).values({
      rawPayload: rawBody,
      tvSymbol: payload.tv_symbol,
      direction: payload.direction ?? '?',
      alertType: payload.alert_type,
      tvPrice: payload.tv_price,
      fusionPrice: payload.fusion_price ?? null,
      status: 'rejected',
      errorMessage: 'No enabled tvAlertConfig matches this tv_symbol/account',
      isDryRun: false,
    });
    return NextResponse.json(
      { error: `No enabled config for ${payload.tv_symbol}` },
      { status: 404 },
    );
  }

  const config: TvAlertConfig = configRow as TvAlertConfig;

  // ── Logged-only types ─────────────────────────────
  if (payload.alert_type === 'invalidation_warning' || payload.alert_type === 'potential_breaker') {
    await db.insert(tvAlerts).values({
      configId: config.id,
      accountId: config.accountId,
      rawPayload: rawBody,
      alertType: payload.alert_type,
      tvSymbol: payload.tv_symbol,
      fusionSymbol: config.fusionSymbol,
      direction: payload.direction ?? '?',
      tvPrice: payload.tv_price,
      fusionPrice: payload.fusion_price ?? null,
      status: 'logged',
      isDryRun: config.dryRun,
      totalLatencyMs: Date.now() - t0,
    });
    return NextResponse.json({ success: true, logged: true });
  }

  // ── Load account + balance ────────────────────────
  const [account] = await db
    .select()
    .from(tradingAccounts)
    .where(eq(tradingAccounts.id, config.accountId))
    .limit(1);

  if (!account) {
    return NextResponse.json({ error: 'Trading account not found' }, { status: 404 });
  }

  let balance = 10_000;
  let equity = 10_000;

  if (!config.dryRun) {
    try {
      const info = await withRpcTrade(account.metaApiId, async (api) => api.getAccountInformation());
      balance = info.balance;
      equity = info.equity;
      await maybeSnapshotDailyBalance(config, balance, equity);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await db.insert(tvAlerts).values({
        configId: config.id,
        accountId: config.accountId,
        rawPayload: rawBody,
        alertType: payload.alert_type,
        tvSymbol: payload.tv_symbol,
        fusionSymbol: config.fusionSymbol,
        direction: payload.direction ?? '?',
        tvPrice: payload.tv_price,
        fusionPrice: payload.fusion_price ?? null,
        status: 'error',
        errorMessage: `Failed to read account info: ${msg}`,
        isDryRun: false,
      });
      return NextResponse.json({ error: 'MetaApi account info unavailable' }, { status: 502 });
    }
  }

  // ── Dispatch by alert type ────────────────────────
  switch (payload.alert_type) {
    case 'activation':
      return await handleActivation(payload, config, account, rawBody, balance, equity, t0);
    case 'target_reached':
      return await handleTargetReached(payload, config, account, rawBody, t0);
    case 'invalidation_hit':
      return await handleInvalidationHit(payload, config, account, rawBody, t0);
    default:
      return NextResponse.json({ error: `Unhandled alert_type: ${payload.alert_type}` }, { status: 400 });
  }
}

// ─── Activation ───────────────────────────────────

async function handleActivation(
  payload: TvAlertPayload,
  config: TvAlertConfig,
  account: typeof tradingAccounts.$inferSelect,
  rawBody: string,
  balance: number,
  equity: number,
  t0: number,
): Promise<NextResponse> {
  // Risk multiplier from watermark
  let riskMultiplier = 1.0;
  let watermarkNote = 'disabled';
  if (config.watermarkEnabled && !config.dryRun) {
    const watermark = await getWatermark(config.accountId, new Date(), config.marketCloseTimezone);
    const m = computeRiskMultiplier(balance, watermark, config);
    riskMultiplier = m.multiplier;
    watermarkNote = m.reason;
  }

  // If the payload didn't carry breaker H/L, fall back to the latest value
  // published by the companion breaker-context indicator.
  let breakerNote = '';
  const hasBreakerInPayload =
    Number.isFinite(payload.breaker_high) && Number.isFinite(payload.breaker_low);
  if (!hasBreakerInPayload) {
    const ctx = await getBreakerContext(payload.tv_symbol, config.accountId);
    if (ctx) {
      payload.breaker_high = ctx.breakerHigh;
      payload.breaker_low = ctx.breakerLow;
      breakerNote = `breaker from publisher (${Math.round(ctx.ageMs / 1000)}s old)`;
    }
  } else {
    breakerNote = 'breaker from payload';
  }

  const tradeOrError = computeTradeParams(payload, config, { balance, equity }, riskMultiplier);

  const baseInsert = {
    configId: config.id,
    accountId: config.accountId,
    rawPayload: rawBody,
    alertType: 'activation' as const,
    tvSymbol: payload.tv_symbol,
    fusionSymbol: config.fusionSymbol,
    direction: payload.direction ?? '?',
    tvPrice: payload.tv_price,
    fusionPrice: payload.fusion_price ?? null,
    breakerHigh: payload.breaker_high ?? null,
    breakerLow: payload.breaker_low ?? null,
    prevCandleHigh: payload.prev_5m_high ?? null,
    prevCandleLow: payload.prev_5m_low ?? null,
    riskMultiplierApplied: riskMultiplier,
  };

  if ('error' in tradeOrError) {
    await db.insert(tvAlerts).values({
      ...baseInsert,
      status: 'rejected',
      errorMessage: tradeOrError.error,
      isDryRun: config.dryRun,
      totalLatencyMs: Date.now() - t0,
    });
    return NextResponse.json({ error: tradeOrError.error }, { status: 400 });
  }

  const trade = tradeOrError;
  const richInsert = {
    ...baseInsert,
    offsetApplied: trade.offsetApplied,
    breakerHighAdjusted: trade.breakerHighAdjusted,
    breakerLowAdjusted: trade.breakerLowAdjusted,
    entryPrice: trade.entryPrice,
    stopLoss: trade.stopLoss,
    takeProfit: trade.takeProfit,
    lotSize: trade.lotSize,
    riskAmount: trade.riskAmount,
    rewardRiskRatio: config.tpRMultiple,
    computeReason: `${trade.reason} | ${breakerNote} | watermark: ${watermarkNote}`,
    isDryRun: config.dryRun,
  };

  // ── Dry run ───────────────────────────────────
  if (config.dryRun) {
    const [alertRow] = await db.insert(tvAlerts).values({
      ...richInsert,
      status: 'dry_run',
      totalLatencyMs: Date.now() - t0,
    }).returning();

    await db.insert(tvPositions).values({
      configId: config.id,
      accountId: config.accountId,
      activationAlertId: alertRow.id,
      tvSymbol: payload.tv_symbol,
      fusionSymbol: config.fusionSymbol,
      direction: payload.direction!,
      entryPrice: trade.entryPrice,
      originalStopLoss: trade.stopLoss,
      rDistance: trade.rDistance,
      initialTakeProfit: trade.takeProfit,
      initialLotSize: trade.lotSize,
      riskAmount: trade.riskAmount,
      riskMultiplierApplied: riskMultiplier,
      metaapiPositionIds: JSON.stringify(['dry-run']),
      currentStopLoss: trade.stopLoss,
      remainingLots: trade.lotSize,
      accountBalanceAtOpen: balance,
      isDryRun: true,
    });

    return NextResponse.json({ success: true, dryRun: true, trade });
  }

  // ── Live execution ────────────────────────────
  const orderType = payload.direction === 'LONG' ? 'ORDER_TYPE_BUY' : 'ORDER_TYPE_SELL';
  let status: TvAlertStatus = 'pending' as TvAlertStatus;
  const metaapiOrderIds: string[] = [];
  let errorMessage: string | null = null;
  const orderSentAt = new Date();

  try {
    await withRpcTrade(account.metaApiId, async (api) => {
      // Margin check on the TOTAL position
      const marginResult = await checkMargin(api, config.fusionSymbol, trade.lotSize, payload.direction!, trade.entryPrice);
      const marginEval = evaluateMargin(marginResult, config.marginWarningThreshold, config.marginRejectThreshold);
      if (marginEval.action === 'reject') {
        status = 'rejected';
        errorMessage = marginEval.message;
        return;
      }
      if (marginEval.action === 'warn') {
        console.warn(`[tv-webhook] ${payload.tv_symbol}: ${marginEval.message}`);
      }

      // Place one order per spillover chunk (single chunk in cap mode).
      for (const chunk of trade.orderSizes) {
        const result = await api.createOrder({
          symbol: config.fusionSymbol,
          type: orderType,
          volume: chunk,
          stopLoss: trade.stopLoss,
          takeProfit: trade.takeProfit,
          comment: `haia-tv-${payload.tv_symbol}`,
          slippage: config.maxSlippage,
        });
        metaapiOrderIds.push(result.orderId);
      }
      status = 'sent';
    });
  } catch (error) {
    status = 'error';
    errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[tv-webhook] Activation failed for ${payload.tv_symbol}:`, error);
  }

  const [alertRow] = await db.insert(tvAlerts).values({
    ...richInsert,
    status,
    metaapiOrderId: metaapiOrderIds[0] ?? null,
    errorMessage,
    orderSentAt,
    totalLatencyMs: Date.now() - t0,
  }).returning();

  // Only record the position when at least one order made it to the broker.
  if (status === 'sent' && metaapiOrderIds.length > 0) {
    await db.insert(tvPositions).values({
      configId: config.id,
      accountId: config.accountId,
      activationAlertId: alertRow.id,
      tvSymbol: payload.tv_symbol,
      fusionSymbol: config.fusionSymbol,
      direction: payload.direction!,
      entryPrice: trade.entryPrice,
      originalStopLoss: trade.stopLoss,
      rDistance: trade.rDistance,
      initialTakeProfit: trade.takeProfit,
      initialLotSize: trade.lotSize,
      riskAmount: trade.riskAmount,
      riskMultiplierApplied: riskMultiplier,
      metaapiPositionIds: JSON.stringify(metaapiOrderIds),
      currentStopLoss: trade.stopLoss,
      remainingLots: trade.lotSize,
      accountBalanceAtOpen: balance,
      isDryRun: false,
    });
  }

  if (status === 'sent') {
    return NextResponse.json({ success: true, orderIds: metaapiOrderIds, trade });
  }
  return NextResponse.json(
    { success: false, status, error: errorMessage, trade },
    { status: status === 'rejected' ? 422 : 502 },
  );
}

// ─── Target Reached ───────────────────────────────

async function handleTargetReached(
  payload: TvAlertPayload,
  config: TvAlertConfig,
  account: typeof tradingAccounts.$inferSelect,
  rawBody: string,
  t0: number,
): Promise<NextResponse> {
  const position = await findOpenPositionForSymbol(config.id, payload.tv_symbol);

  const baseInsert = {
    configId: config.id,
    accountId: config.accountId,
    rawPayload: rawBody,
    alertType: 'target_reached' as const,
    rLevel: payload.r_level ?? null,
    tvSymbol: payload.tv_symbol,
    fusionSymbol: config.fusionSymbol,
    direction: payload.direction ?? position?.direction ?? '?',
    tvPrice: payload.tv_price,
    fusionPrice: payload.fusion_price ?? null,
    isDryRun: config.dryRun,
  };

  if (!position) {
    await db.insert(tvAlerts).values({
      ...baseInsert,
      status: 'no_position',
      errorMessage: 'No open position to manage',
      totalLatencyMs: Date.now() - t0,
    });
    return NextResponse.json({ success: false, reason: 'no_position' }, { status: 404 });
  }

  const result = await withRpcTrade(
    account.metaApiId,
    async (api) => applyTargetReached(position, payload.r_level!, config, api),
  );

  await db.update(tvPositions).set(result.updates).where(eq(tvPositions.id, position.id));

  await db.insert(tvAlerts).values({
    ...baseInsert,
    linkedPositionId: position.id,
    status: config.dryRun ? 'dry_run' : 'sent',
    computeReason: result.action,
    totalLatencyMs: Date.now() - t0,
  });

  return NextResponse.json({ success: true, action: result.action });
}

// ─── Invalidation Hit ────────────────────────────

async function handleInvalidationHit(
  payload: TvAlertPayload,
  config: TvAlertConfig,
  account: typeof tradingAccounts.$inferSelect,
  rawBody: string,
  t0: number,
): Promise<NextResponse> {
  const baseInsert = {
    configId: config.id,
    accountId: config.accountId,
    rawPayload: rawBody,
    alertType: 'invalidation_hit' as const,
    tvSymbol: payload.tv_symbol,
    fusionSymbol: config.fusionSymbol,
    direction: payload.direction ?? '?',
    tvPrice: payload.tv_price,
    fusionPrice: payload.fusion_price ?? null,
    isDryRun: config.dryRun,
  };

  if (!config.invalidationCloseEnabled) {
    await db.insert(tvAlerts).values({
      ...baseInsert,
      status: 'logged',
      computeReason: 'invalidation_close_enabled=false',
      totalLatencyMs: Date.now() - t0,
    });
    return NextResponse.json({ success: true, logged: true });
  }

  const position = await findOpenPositionForSymbol(config.id, payload.tv_symbol);
  if (!position) {
    await db.insert(tvAlerts).values({
      ...baseInsert,
      status: 'no_position',
      errorMessage: 'No open position to close',
      totalLatencyMs: Date.now() - t0,
    });
    return NextResponse.json({ success: false, reason: 'no_position' }, { status: 404 });
  }

  const result = await withRpcTrade(
    account.metaApiId,
    async (api) => applyInvalidationHit(position, api),
  );

  await db.update(tvPositions).set(result.updates).where(eq(tvPositions.id, position.id));

  await db.insert(tvAlerts).values({
    ...baseInsert,
    linkedPositionId: position.id,
    status: config.dryRun ? 'dry_run' : 'sent',
    computeReason: result.action,
    totalLatencyMs: Date.now() - t0,
  });

  return NextResponse.json({ success: true, action: result.action });
}
