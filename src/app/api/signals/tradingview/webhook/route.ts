import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { tvAlertConfigs, tvAlerts, tradingAccounts } from '@/lib/db/schema';
import { computeTradeParams, validatePayload } from '@/lib/signals/tv-alert';
import { withRpcTrade } from '@/lib/metaapi-trade';
import { checkMargin, evaluateMargin } from '@/lib/signals/margin';
import type { TvAlertConfig, TvAlertPayload, TvAlertStatus } from '@/types/tv-alerts';

/**
 * POST /api/signals/tradingview/webhook
 *
 * Receives a JSON alert from a TradingView Pine Script indicator. The payload
 * authenticates via TRADINGVIEW_WEBHOOK_SECRET (TradingView cannot do session
 * auth, so a shared secret in the alert body is the standard approach).
 *
 * Expected body — see /tv_alert_indicator.pine for the canonical Pine template:
 * {
 *   "secret":       "...",
 *   "tv_symbol":    "XBRUSD" | "UK10YBG",
 *   "direction":    "LONG" | "SHORT",
 *   "tv_price":     <number>,        // current close on the TV chart
 *   "fusion_price": <number>,        // FUSIONMARKETS:UKGILT — only required when tv_symbol != fusion_symbol
 *   "prev_5m_high": <number>,        // high of the last closed 5-min candle
 *   "prev_5m_low":  <number>,        // low  of the last closed 5-min candle
 *   "timestamp":    "{{timenow}}",
 *   "account_id":   "..."            // optional override; otherwise picks the first enabled config
 * }
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

  // ── Resolve config ────────────────────────────────
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
    // Log the orphan alert so it still appears in dashboards.
    await db.insert(tvAlerts).values({
      configId: null,
      accountId: payload.account_id ?? null,
      rawPayload: rawBody,
      tvSymbol: payload.tv_symbol,
      direction: payload.direction,
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

  // ── Load account + account info ──────────────────
  const [account] = await db
    .select()
    .from(tradingAccounts)
    .where(eq(tradingAccounts.id, config.accountId))
    .limit(1);

  if (!account) {
    return NextResponse.json({ error: 'Trading account not found' }, { status: 404 });
  }

  // For dry-runs we use placeholder balance/equity so sizing still produces a
  // visible number. The real values are fetched from MetaApi for live trades.
  let balance = 10_000;
  let equity = 10_000;

  if (!config.dryRun) {
    try {
      const info = await withRpcTrade(account.metaApiId, async (api) => api.getAccountInformation());
      balance = info.balance;
      equity = info.equity;
    } catch (error) {
      await db.insert(tvAlerts).values({
        configId: config.id,
        accountId: config.accountId,
        rawPayload: rawBody,
        tvSymbol: payload.tv_symbol,
        fusionSymbol: config.fusionSymbol,
        direction: payload.direction,
        tvPrice: payload.tv_price,
        fusionPrice: payload.fusion_price ?? null,
        prevCandleHigh: payload.prev_5m_high,
        prevCandleLow: payload.prev_5m_low,
        status: 'error',
        errorMessage: `Failed to read account info: ${error instanceof Error ? error.message : String(error)}`,
        isDryRun: false,
      });
      return NextResponse.json({ error: 'MetaApi account info unavailable' }, { status: 502 });
    }
  }

  // ── Compute trade parameters ─────────────────────
  const tradeOrError = computeTradeParams(payload, config, { balance, equity });

  if ('error' in tradeOrError) {
    await db.insert(tvAlerts).values({
      configId: config.id,
      accountId: config.accountId,
      rawPayload: rawBody,
      tvSymbol: payload.tv_symbol,
      fusionSymbol: config.fusionSymbol,
      direction: payload.direction,
      tvPrice: payload.tv_price,
      fusionPrice: payload.fusion_price ?? null,
      prevCandleHigh: payload.prev_5m_high,
      prevCandleLow: payload.prev_5m_low,
      status: 'rejected',
      errorMessage: tradeOrError.error,
      isDryRun: config.dryRun,
    });
    return NextResponse.json({ error: tradeOrError.error }, { status: 400 });
  }

  const trade = tradeOrError;

  const baseInsert = {
    configId: config.id,
    accountId: config.accountId,
    rawPayload: rawBody,
    tvSymbol: payload.tv_symbol,
    fusionSymbol: config.fusionSymbol,
    direction: payload.direction,
    tvPrice: payload.tv_price,
    fusionPrice: trade.fusionPriceAtAlert,
    offsetApplied: trade.offsetApplied,
    prevCandleHigh: payload.prev_5m_high,
    prevCandleLow: payload.prev_5m_low,
    prevCandleHighAdjusted: trade.prevCandleHighAdjusted,
    prevCandleLowAdjusted: trade.prevCandleLowAdjusted,
    entryPrice: trade.entryPrice,
    stopLoss: trade.stopLoss,
    takeProfit: trade.takeProfit,
    lotSize: trade.lotSize,
    riskAmount: trade.riskAmount,
    rewardRiskRatio: trade.rewardRiskRatio,
    computeReason: trade.reason,
    isDryRun: config.dryRun,
  };

  // ── Dry run short-circuit ────────────────────────
  if (config.dryRun) {
    await db.insert(tvAlerts).values({
      ...baseInsert,
      status: 'dry_run',
      totalLatencyMs: Date.now() - t0,
    });
    return NextResponse.json({ success: true, dryRun: true, trade });
  }

  // ── Live execution ───────────────────────────────
  let status: TvAlertStatus = 'pending' as TvAlertStatus;
  let metaapiOrderId: string | null = null;
  let errorMessage: string | null = null;
  const orderType =
    payload.direction === 'LONG' ? 'ORDER_TYPE_BUY' : 'ORDER_TYPE_SELL';
  const orderSentAt = new Date();

  try {
    await withRpcTrade(account.metaApiId, async (api) => {
      // Margin check first
      const marginResult = await checkMargin(
        api,
        config.fusionSymbol,
        trade.lotSize,
        payload.direction,
        trade.entryPrice,
      );
      const marginEval = evaluateMargin(
        marginResult,
        config.marginWarningThreshold,
        config.marginRejectThreshold,
      );
      if (marginEval.action === 'reject') {
        status = 'rejected';
        errorMessage = marginEval.message;
        return;
      }
      if (marginEval.action === 'warn') {
        console.warn(`[tv-webhook] ${payload.tv_symbol}: ${marginEval.message}`);
      }

      const result = await api.createOrder({
        symbol: config.fusionSymbol,
        type: orderType,
        volume: trade.lotSize,
        stopLoss: trade.stopLoss,
        takeProfit: trade.takeProfit,
        comment: `haia-tv-${payload.tv_symbol}`,
        slippage: config.maxSlippage,
      });
      metaapiOrderId = result.orderId;
      status = 'sent';
    });
  } catch (error) {
    status = 'error';
    errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[tv-webhook] Order failed for ${payload.tv_symbol}:`, error);
  }

  await db.insert(tvAlerts).values({
    ...baseInsert,
    status,
    metaapiOrderId,
    errorMessage,
    orderSentAt,
    totalLatencyMs: Date.now() - t0,
  });

  if (status === 'sent') {
    return NextResponse.json({ success: true, orderId: metaapiOrderId, trade });
  }
  return NextResponse.json(
    { success: false, status, error: errorMessage, trade },
    { status: status === 'rejected' ? 422 : 502 },
  );
}
