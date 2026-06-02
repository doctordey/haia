import { and, eq, isNull, or } from 'drizzle-orm';
import { db } from '@/lib/db';
import { tvBreakerContexts } from '@/lib/db/schema';

export interface BreakerContext {
  breakerHigh: number;
  breakerLow: number;
  breakerDirection: 'bullish' | 'bearish' | null;
  receivedAt: Date;
  ageMs: number;
}

/**
 * Upsert the latest breaker H/L for a (tvSymbol, accountId) pair. accountId
 * is optional — when omitted, the row applies to all accounts that share
 * the same tvSymbol.
 */
export async function upsertBreakerContext(
  tvSymbol: string,
  breakerHigh: number,
  breakerLow: number,
  options: { accountId?: string | null; direction?: 'bullish' | 'bearish' | null; source?: string } = {},
): Promise<void> {
  const accountId = options.accountId ?? null;
  const direction = options.direction ?? null;
  const source = options.source ?? 'publisher';
  const now = new Date();

  // Drizzle's onConflictDoUpdate doesn't play well with the (nullable, notnull)
  // unique pair here, so do explicit upsert.
  const existing = await db.query.tvBreakerContexts.findFirst({
    where: and(
      eq(tvBreakerContexts.tvSymbol, tvSymbol),
      accountId == null
        ? isNull(tvBreakerContexts.accountId)
        : eq(tvBreakerContexts.accountId, accountId),
    ),
  });

  if (existing) {
    await db
      .update(tvBreakerContexts)
      .set({ breakerHigh, breakerLow, breakerDirection: direction, source, receivedAt: now })
      .where(eq(tvBreakerContexts.id, existing.id));
  } else {
    await db.insert(tvBreakerContexts).values({
      accountId,
      tvSymbol,
      breakerHigh,
      breakerLow,
      breakerDirection: direction,
      source,
      receivedAt: now,
    });
  }
}

/**
 * Look up the latest fresh breaker context for a (tvSymbol, accountId).
 * Prefers an account-scoped row; falls back to an account-null row.
 * Returns null if the only candidates are older than `maxAgeMs`.
 */
export async function getBreakerContext(
  tvSymbol: string,
  accountId: string | null,
  maxAgeMs: number = 24 * 60 * 60 * 1000,
): Promise<BreakerContext | null> {
  const rows = await db
    .select()
    .from(tvBreakerContexts)
    .where(and(
      eq(tvBreakerContexts.tvSymbol, tvSymbol),
      or(
        isNull(tvBreakerContexts.accountId),
        accountId == null ? isNull(tvBreakerContexts.accountId) : eq(tvBreakerContexts.accountId, accountId),
      ),
    ));

  if (rows.length === 0) return null;

  // Prefer account-scoped row over account-null row, then most recent.
  rows.sort((a, b) => {
    const aHasAccount = a.accountId == null ? 0 : 1;
    const bHasAccount = b.accountId == null ? 0 : 1;
    if (aHasAccount !== bHasAccount) return bHasAccount - aHasAccount;
    return b.receivedAt.getTime() - a.receivedAt.getTime();
  });

  const winner = rows[0];
  const ageMs = Date.now() - winner.receivedAt.getTime();
  if (ageMs > maxAgeMs) return null;

  return {
    breakerHigh: winner.breakerHigh,
    breakerLow: winner.breakerLow,
    breakerDirection: winner.breakerDirection as 'bullish' | 'bearish' | null,
    receivedAt: winner.receivedAt,
    ageMs,
  };
}
