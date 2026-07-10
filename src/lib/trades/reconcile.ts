import { db } from '@/lib/db';
import { trades } from '@/lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';

/**
 * Backfill ↔ live-sync reconciliation.
 *
 * The primary dedupe key is `accountId + ticket` — when an imported row carries
 * the broker's real position id (MT5 reports do), a later live sync upserts the
 * same row and flips its `source` to "live". This sweep is the safety net for
 * rows whose tickets DON'T match (auto-generated tickets, differently-keyed
 * exports): a manual row that matches a live row on symbol, direction, lots and
 * open time is considered the same trade seen twice, and the manual copy is
 * removed — broker data is authoritative.
 */

export interface TradeLike {
  symbol: string;
  direction: string;
  lots: number;
  openTime: Date;
}

// Open times within this window count as "the same moment" — covers broker vs
// report timestamp rounding.
const OPEN_TIME_WINDOW_MS = 120_000;

export function isManualDuplicate(manual: TradeLike, live: TradeLike): boolean {
  if (manual.symbol !== live.symbol || manual.direction !== live.direction) return false;
  if (Math.abs(manual.lots - live.lots) > 0.001) return false;
  return Math.abs(manual.openTime.getTime() - live.openTime.getTime()) <= OPEN_TIME_WINDOW_MS;
}

/**
 * Delete manual trades that duplicate a live trade (one manual per live row,
 * greedy match). Returns the number removed. Callers recompute aggregates
 * afterwards as part of their normal flow.
 */
export async function reconcileManualDuplicates(accountId: string): Promise<number> {
  const all = await db.query.trades.findMany({ where: eq(trades.accountId, accountId) });
  const manual = all.filter((t) => t.source === 'manual');
  const live = all.filter((t) => t.source === 'live');
  if (manual.length === 0 || live.length === 0) return 0;

  const claimed = new Set<string>();
  const toDelete: string[] = [];
  for (const m of manual) {
    const match = live.find((l) => !claimed.has(l.id) && isManualDuplicate(m, l));
    if (match) {
      claimed.add(match.id);
      toDelete.push(m.id);
    }
  }

  if (toDelete.length > 0) {
    await db.delete(trades).where(and(eq(trades.accountId, accountId), inArray(trades.id, toDelete)));
  }
  return toDelete.length;
}
