import { db } from '@/lib/db';
import { trades } from '@/lib/db/schema';
import { createId } from '@paralleldrive/cuid2';
import { calculatePips } from '@/lib/calculations';

/**
 * Shared trade-ingestion logic for manual entry and history imports. Used by
 * both the public REST API (/api/v1) and the session-authed web routes so the
 * validation and normalization rules live in exactly one place.
 */

export interface TradeInput {
  ticket?: string | null;
  symbol: string;
  direction: string;            // BUY | SELL (case-insensitive; long/short accepted)
  lots: number;
  entryPrice: number;
  closePrice?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  openTime: string | Date;
  closeTime?: string | Date | null;
  profit?: number | null;
  pips?: number | null;
  commission?: number | null;
  swap?: number | null;
  magicNumber?: number | null;
  comment?: string | null;
  isOpen?: boolean;
}

export interface NormalizedTrade {
  accountId: string;
  ticket: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  lots: number;
  entryPrice: number;
  closePrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  openTime: Date;
  closeTime: Date | null;
  profit: number;
  pips: number | null;
  commission: number;
  swap: number;
  isOpen: boolean;
  magicNumber: number | null;
  comment: string | null;
  source: string;
}

function normDirection(value: string): 'BUY' | 'SELL' | null {
  const v = String(value || '').trim().toLowerCase();
  if (/^(buy|long|b)$/.test(v)) return 'BUY';
  if (/^(sell|short|s)$/.test(v)) return 'SELL';
  return null;
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function num(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Validate + normalize one trade input. Throws Error with a clear message on bad data. */
export function normalizeTrade(accountId: string, input: TradeInput, source: string): NormalizedTrade {
  if (!input.symbol || !String(input.symbol).trim()) throw new Error('symbol is required');

  const direction = normDirection(input.direction);
  if (!direction) throw new Error(`invalid direction "${input.direction}" (expected BUY or SELL)`);

  const lots = num(input.lots);
  if (lots == null || lots <= 0) throw new Error('lots must be a positive number');

  const entryPrice = num(input.entryPrice);
  if (entryPrice == null) throw new Error('entryPrice is required and must be numeric');

  const openTime = toDate(input.openTime);
  if (!openTime) throw new Error('openTime is required and must be a valid date');

  const closeTime = toDate(input.closeTime);
  const closePrice = num(input.closePrice);
  // A trade is open unless explicitly closed (closeTime present) or isOpen:false given.
  const isOpen = input.isOpen != null ? Boolean(input.isOpen) : !closeTime;

  const symbol = String(input.symbol).trim().toUpperCase();

  // Derive pips if not provided but we have both prices on a closed trade.
  let pips = num(input.pips);
  if (pips == null && !isOpen && closePrice != null) {
    pips = calculatePips(symbol, direction, entryPrice, closePrice);
  }

  return {
    accountId,
    ticket: input.ticket ? String(input.ticket) : `${source}-${createId()}`,
    symbol,
    direction,
    lots,
    entryPrice,
    closePrice: isOpen ? null : closePrice,
    stopLoss: num(input.stopLoss),
    takeProfit: num(input.takeProfit),
    openTime,
    closeTime: isOpen ? null : closeTime,
    profit: num(input.profit) ?? 0,
    pips,
    commission: num(input.commission) ?? 0,
    swap: num(input.swap) ?? 0,
    isOpen,
    magicNumber: input.magicNumber != null ? Math.trunc(Number(input.magicNumber)) || null : null,
    comment: input.comment != null ? String(input.comment) : null,
    source,
  };
}

/**
 * Upsert a batch of normalized trades (idempotent on accountId+ticket). Returns
 * the count inserted/updated. Does NOT recompute aggregates — callers should run
 * `recomputeAccountAggregates` afterwards.
 */
export async function upsertTrades(rows: NormalizedTrade[]): Promise<number> {
  let count = 0;
  for (const row of rows) {
    await db
      .insert(trades)
      .values(row)
      .onConflictDoUpdate({
        target: [trades.accountId, trades.ticket],
        set: {
          symbol: row.symbol, direction: row.direction, lots: row.lots,
          entryPrice: row.entryPrice, closePrice: row.closePrice,
          stopLoss: row.stopLoss, takeProfit: row.takeProfit,
          openTime: row.openTime, closeTime: row.closeTime,
          profit: row.profit, pips: row.pips, commission: row.commission, swap: row.swap,
          isOpen: row.isOpen, magicNumber: row.magicNumber, comment: row.comment, source: row.source,
        },
      });
    count++;
  }
  return count;
}
