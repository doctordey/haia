import { NextRequest, NextResponse } from 'next/server';
import { loadHitlConfig } from '@/lib/hitl/config';
import { secretMatches, strField, getHitlNotifier } from '@/lib/hitl/webhook';
import * as session from '@/lib/hitl/session';

/**
 * POST /api/hitl/tp1-hit
 * (public path /haia/hitl/tp1-hit → proxied here)
 *
 * External "TP1 reached" notification. Authenticates via the shared secret,
 * then flags the matching OPEN session for breakeven. The worker performs the
 * actual SL→entry move (idempotent via `be_applied`). This is the webhook half
 * of BE_TRIGGER=both; the worker's internal price-watch is the backstop, so a
 * missing or duplicated webhook is harmless.
 *
 * Body: { secret, signal_id }
 */
export async function POST(request: NextRequest) {
  const cfg = loadHitlConfig();

  if (!cfg.enabled) {
    return NextResponse.json({ accepted: false, reason: 'hitl_disabled' });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!secretMatches(body.secret, cfg.webhookSecret)) {
    console.warn('[hitl/tp1-hit] rejected: bad secret');
    return NextResponse.json({ accepted: false, reason: 'unauthorized' });
  }

  const signalId = strField(body, 'signal_id', 'id');
  if (!signalId) {
    return NextResponse.json({ accepted: false, reason: 'missing_signal_id' });
  }

  // Flag the OPEN, not-yet-BE'd session. No match (already applied / closed /
  // unknown / repeated call) ⇒ idempotent no-op.
  const flagged = await session.markBeRequested(signalId);
  if (!flagged) {
    return NextResponse.json({ accepted: true, applied: false, reason: 'no_actionable_session' });
  }

  getHitlNotifier()?.onBeRequested?.(signalId);
  console.log(`[hitl/tp1-hit] BE requested for ${signalId} → ${flagged.id}`);

  return NextResponse.json({ accepted: true, applied: true, sessionId: flagged.id });
}
