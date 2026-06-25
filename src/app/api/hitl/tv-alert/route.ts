import { NextRequest, NextResponse } from 'next/server';
import { loadHitlConfig } from '@/lib/hitl/config';
import { secretMatches, deriveSignalId, getHitlNotifier } from '@/lib/hitl/webhook';
import { parseAlert, type AlertInfo } from '@/lib/hitl/alert';
import { resolveBrokerSymbolLive } from '@/lib/hitl/symbol-map';
import * as session from '@/lib/hitl/session';

/**
 * POST /api/hitl/tv-alert
 * (public path /haia/hitl/tv-alert → proxied here)
 *
 * Single entry point for the TradingView "Unicorn" alerts. The indicator fires
 * plain-text strings (not JSON) for both message types through one alert, so we:
 *   • authenticate via the URL secret (?secret=…) — TradingView can't add JSON
 *     or headers to an indicator alert() string. A JSON body with `secret` is
 *     also accepted for flexibility.
 *   • parse the text → { type, direction, symbol, price }
 *   • map the TradingView ticker → broker symbol (identity unless overridden)
 *   • route: "Activated" → new session (intake guards); "Target Reached" →
 *     breakeven request correlated by symbol + direction.
 *
 * Every business-rule reject returns HTTP 200 so TradingView never disables the
 * webhook.
 */
export async function POST(request: NextRequest) {
  const cfg = loadHitlConfig();
  if (!cfg.enabled) {
    return NextResponse.json({ accepted: false, reason: 'hitl_disabled' });
  }

  const rawBody = await request.text();

  // A JSON body is accepted (back-compat / manual testing); otherwise plain text.
  let jsonBody: Record<string, unknown> | null = null;
  try {
    jsonBody = JSON.parse(rawBody);
  } catch {
    jsonBody = null;
  }

  // Secret: URL query param first, then a JSON `secret` field.
  const urlSecret = request.nextUrl.searchParams.get('secret');
  const providedSecret = urlSecret ?? (typeof jsonBody?.secret === 'string' ? jsonBody.secret : undefined);
  if (!secretMatches(providedSecret, cfg.webhookSecret)) {
    console.warn('[hitl/tv-alert] rejected: bad secret');
    return NextResponse.json({ accepted: false, reason: 'unauthorized' });
  }

  // Normalize either source into AlertInfo.
  const alert: AlertInfo = jsonBody && (jsonBody.symbol || jsonBody.ticker)
    ? alertFromJson(jsonBody)
    : parseAlert(rawBody);

  if (!alert.symbol || alert.direction == null) {
    console.warn('[hitl/tv-alert] unparseable alert:', rawBody.slice(0, 120));
    return NextResponse.json({ accepted: false, reason: 'unparseable' });
  }

  const symbol = await resolveBrokerSymbolLive(cfg, alert.symbol);

  // ── Target Reached → breakeven request (correlated by symbol + direction) ──
  if (alert.type === 'target_reached') {
    const flagged = await session.markBeRequestedBySymbolDirection(symbol, alert.direction);
    if (flagged.length === 0) {
      return NextResponse.json({ accepted: true, applied: false, reason: 'no_actionable_session' });
    }
    getHitlNotifier()?.onBeRequested?.(flagged[0].signalId);
    console.log(`[hitl/tv-alert] BE requested for ${symbol} ${alert.direction} → ${flagged.length} session(s)`);
    return NextResponse.json({ accepted: true, applied: true, sessions: flagged.length });
  }

  // ── Activation → new session, after the ordered intake guards ──
  if (alert.type !== 'activation') {
    return NextResponse.json({ accepted: false, reason: 'unknown_message_type' });
  }
  if (alert.price == null) {
    return NextResponse.json({ accepted: false, reason: 'missing_price' });
  }

  const signalId = typeof jsonBody?.signal_id === 'string' ? jsonBody.signal_id : deriveSignalId(rawBody);

  // Guard 2: exact dedupe.
  const existing = await session.findBySignalId(signalId);
  if (existing) {
    return NextResponse.json({ accepted: false, reason: 'duplicate', sessionId: existing.id });
  }
  // Guard 3: per-symbol cooldown.
  if (await session.inCooldown(symbol, cfg.signalCooldownSeconds)) {
    return NextResponse.json({ accepted: false, reason: 'cooldown' });
  }
  // Guard 4: one active pre-fill per symbol.
  if (await session.hasActivePrefill(symbol)) {
    return NextResponse.json({ accepted: false, reason: 'prefill_active' });
  }

  // Guard 5: create RECEIVED (direction already known from the alert).
  let created;
  try {
    created = await session.createSession({
      signalId,
      symbol,
      entryRef: alert.price,
      action: alert.direction,
      rawAlert: { text: rawBody, parsed: alert, tvSymbol: alert.symbol },
    });
  } catch (err) {
    console.warn('[hitl/tv-alert] insert failed (likely dedupe race):', err);
    return NextResponse.json({ accepted: false, reason: 'duplicate' });
  }

  getHitlNotifier()?.onAlert?.(created.id);
  console.log(`[hitl/tv-alert] accepted ${signalId} (${alert.direction} ${symbol} @ ${alert.price}) → ${created.id}`);
  return NextResponse.json({ accepted: true, sessionId: created.id });
}

/** Build AlertInfo from a JSON test payload (mirrors the text parser shape). */
function alertFromJson(body: Record<string, unknown>): AlertInfo {
  const str = (...keys: string[]): string | null => {
    for (const k of keys) if (typeof body[k] === 'string' && (body[k] as string).trim()) return (body[k] as string).trim();
    return null;
  };
  const rawType = str('type', 'message_type');
  const type = rawType && /target|tp1|breakeven/i.test(rawType) ? 'target_reached' : 'activation';
  const rawDir = str('action', 'side', 'direction');
  const direction = rawDir && /buy|long|bull/i.test(rawDir) ? 'BUY' : rawDir && /sell|short|bear/i.test(rawDir) ? 'SELL' : null;
  const symbol = str('symbol', 'ticker');
  const priceRaw = body.price ?? body.entry ?? body.entry_price ?? body.close;
  const price = priceRaw != null && Number.isFinite(Number(priceRaw)) ? Number(priceRaw) : null;
  return { type, direction, symbol: symbol ? symbol.toUpperCase() : null, price, raw: JSON.stringify(body) };
}
