import { NextRequest, NextResponse } from 'next/server';
import { loadHitlConfig } from '@/lib/hitl/config';
import {
  secretMatches,
  deriveSignalId,
  numField,
  strField,
  getHitlNotifier,
} from '@/lib/hitl/webhook';
import * as session from '@/lib/hitl/session';

/**
 * POST /api/hitl/tv-alert
 * (public path /haia/hitl/tv-alert → proxied here)
 *
 * TradingView posts a new HITL alert. Runs the ordered intake guards
 * (HITL_DESIGN.md §5); every business-rule reject returns HTTP 200 so
 * TradingView never disables the webhook. On success, inserts a RECEIVED
 * session and nudges the worker.
 *
 * Body (field names accepted flexibly):
 *   { secret, signal_id?, symbol, price|entry, action? }
 */
export async function POST(request: NextRequest) {
  const cfg = loadHitlConfig();

  // HITL not enabled on this deployment → acknowledge and ignore.
  if (!cfg.enabled) {
    return NextResponse.json({ accepted: false, reason: 'hitl_disabled' });
  }

  const rawBody = await request.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Guard 1: shared secret (constant-time). Reject → 200 (no probing signal).
  if (!secretMatches(body.secret, cfg.webhookSecret)) {
    console.warn('[hitl/tv-alert] rejected: bad secret');
    return NextResponse.json({ accepted: false, reason: 'unauthorized' });
  }

  const symbol = strField(body, 'symbol', 'ticker');
  const entry = numField(body, 'price', 'entry', 'entry_price', 'close');
  if (!symbol) {
    return NextResponse.json({ accepted: false, reason: 'missing_symbol' });
  }
  if (entry == null) {
    return NextResponse.json({ accepted: false, reason: 'missing_price' });
  }

  const rawAction = strField(body, 'action', 'side', 'direction');
  const action =
    rawAction && /buy|long/i.test(rawAction) ? 'BUY' :
    rawAction && /sell|short/i.test(rawAction) ? 'SELL' : null;

  const signalId = strField(body, 'signal_id', 'id') ?? deriveSignalId(rawBody);

  // Guard 2: exact dedupe by signalId → no-op.
  const existing = await session.findBySignalId(signalId);
  if (existing) {
    return NextResponse.json({ accepted: false, reason: 'duplicate', sessionId: existing.id });
  }

  // Guard 3: per-symbol cooldown.
  if (await session.inCooldown(symbol, cfg.signalCooldownSeconds)) {
    return NextResponse.json({ accepted: false, reason: 'cooldown' });
  }

  // Guard 4: live pre-fill block — one active pre-fill per symbol.
  if (await session.hasActivePrefill(symbol)) {
    return NextResponse.json({ accepted: false, reason: 'prefill_active' });
  }

  // Guard 5: create RECEIVED.
  let created;
  try {
    created = await session.createSession({
      signalId,
      symbol,
      entryRef: entry,
      action,
      rawAlert: body,
      operatorChatId: cfg.operatorChatId,
    });
  } catch (err) {
    // Unique-constraint race on signalId ⇒ treat as duplicate.
    console.warn('[hitl/tv-alert] insert failed (likely dedupe race):', err);
    return NextResponse.json({ accepted: false, reason: 'duplicate' });
  }

  getHitlNotifier()?.onAlert?.(created.id);
  console.log(`[hitl/tv-alert] accepted ${signalId} (${symbol} @ ${entry}) → ${created.id}`);

  return NextResponse.json({ accepted: true, sessionId: created.id });
}
