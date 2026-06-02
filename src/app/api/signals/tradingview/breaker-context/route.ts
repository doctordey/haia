import { NextRequest, NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { tvBreakerContexts, tradingAccounts } from '@/lib/db/schema';
import { upsertBreakerContext } from '@/lib/signals/breaker-context';

/**
 * POST /api/signals/tradingview/breaker-context
 *
 * Receives the latest breaker high/low from the companion Pine publisher
 * indicator. Authenticated by TRADINGVIEW_WEBHOOK_SECRET in the body.
 *
 * Expected body:
 * {
 *   "secret":            "...",
 *   "tv_symbol":         "XBRUSD",
 *   "breaker_high":      75.55,
 *   "breaker_low":       75.40,
 *   "breaker_direction": "bullish",   // optional, "bullish" | "bearish"
 *   "account_id":        "...",       // optional — scopes to one account
 *   "timestamp":         "{{timenow}}"
 * }
 *
 * GET (authenticated):
 *   Returns the latest stored breaker context for each tvSymbol scoped to
 *   the caller's trading accounts. Used by the settings UI.
 */
export async function POST(request: NextRequest) {
  const webhookSecret = process.env.TRADINGVIEW_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (body.secret !== webhookSecret) {
    return NextResponse.json({ error: 'Invalid secret' }, { status: 401 });
  }

  const tvSymbol = String(body.tv_symbol ?? '').toUpperCase();
  const breakerHigh = Number(body.breaker_high);
  const breakerLow = Number(body.breaker_low);

  if (!tvSymbol || !Number.isFinite(breakerHigh) || !Number.isFinite(breakerLow)) {
    return NextResponse.json({ error: 'Missing or invalid tv_symbol / breaker_high / breaker_low' }, { status: 400 });
  }
  if (breakerHigh < breakerLow) {
    return NextResponse.json({ error: 'breaker_high < breaker_low' }, { status: 400 });
  }

  const dirRaw = body.breaker_direction ? String(body.breaker_direction).toLowerCase() : null;
  const direction = dirRaw === 'bullish' || dirRaw === 'bearish' ? dirRaw : null;
  const accountId = body.account_id ? String(body.account_id) : null;

  await upsertBreakerContext(tvSymbol, breakerHigh, breakerLow, {
    accountId,
    direction,
    source: 'publisher',
  });

  console.log(
    `[breaker-context] ${tvSymbol}${accountId ? ` (${accountId})` : ''}: H=${breakerHigh} L=${breakerLow} dir=${direction ?? '?'}`,
  );
  return NextResponse.json({ success: true });
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userAccounts = await db
    .select({ id: tradingAccounts.id })
    .from(tradingAccounts)
    .where(eq(tradingAccounts.userId, session.user.id));
  const accountIds = userAccounts.map((a) => a.id);

  // Rows scoped to one of the user's accounts OR globally (accountId IS NULL).
  const rows = await db
    .select()
    .from(tvBreakerContexts)
    .orderBy(desc(tvBreakerContexts.receivedAt));

  const scoped = rows.filter((r) => r.accountId == null || (r.accountId && accountIds.includes(r.accountId)));
  return NextResponse.json(scoped);
}
