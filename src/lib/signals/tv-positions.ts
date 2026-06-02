import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { tvPositions } from '@/lib/db/schema';
import type { MetaApiTradeInterface } from '@/types/signals';
import type { TvAlertConfig, TvPositionRecord } from '@/types/tv-alerts';

/**
 * Look up the most recent open position for this config + symbol. Returns
 * null if none — the caller should then short-circuit the management alert.
 */
export async function findOpenPositionForSymbol(
  configId: string,
  tvSymbol: string,
): Promise<TvPositionRecord | null> {
  const rows = await db
    .select()
    .from(tvPositions)
    .where(and(
      eq(tvPositions.configId, configId),
      eq(tvPositions.tvSymbol, tvSymbol),
      inArray(tvPositions.status, ['open', 'partial']),
    ))
    .orderBy(tvPositions.openedAt);

  const row = rows[rows.length - 1];
  if (!row) return null;
  return rowToRecord(row);
}

function rowToRecord(row: typeof tvPositions.$inferSelect): TvPositionRecord {
  let ids: string[] = [];
  try {
    ids = JSON.parse(row.metaapiPositionIds);
    if (!Array.isArray(ids)) ids = [];
  } catch {
    ids = [];
  }
  return {
    id: row.id,
    configId: row.configId,
    accountId: row.accountId,
    tvSymbol: row.tvSymbol,
    fusionSymbol: row.fusionSymbol,
    direction: row.direction as TvPositionRecord['direction'],
    entryPrice: row.entryPrice,
    originalStopLoss: row.originalStopLoss,
    currentStopLoss: row.currentStopLoss,
    rDistance: row.rDistance,
    initialTakeProfit: row.initialTakeProfit,
    initialLotSize: row.initialLotSize,
    remainingLots: row.remainingLots,
    riskMultiplierApplied: row.riskMultiplierApplied,
    metaapiPositionIds: ids,
    hit1R: row.hit1R,
    hit2R: row.hit2R,
    hit5R: row.hit5R,
    movedToBreakeven: row.movedToBreakeven,
    status: row.status as TvPositionRecord['status'],
    isDryRun: row.isDryRun,
  };
}

/**
 * Apply a Target Reached alert to an open position.
 *
 *   r_level === beAtRMultiple        → move SL of all legs to entry
 *   r_level === partialCloseAtRMul…  → partial-close partialClosePercent
 *   r_level === closeAtRMultiple     → close all legs
 *
 * For dry-run positions, no MetaApi calls are made — only DB state updates.
 */
export async function applyTargetReached(
  position: TvPositionRecord,
  rLevel: number,
  config: TvAlertConfig,
  metaApi: MetaApiTradeInterface,
): Promise<{ action: string; updates: Partial<typeof tvPositions.$inferInsert> }> {
  const updates: Partial<typeof tvPositions.$inferInsert> = {};
  const actions: string[] = [];

  // Mark which R-multiple was hit
  if (rLevel >= 1 && !position.hit1R) updates.hit1R = true;
  if (rLevel >= 2 && !position.hit2R) updates.hit2R = true;
  if (rLevel >= 5 && !position.hit5R) updates.hit5R = true;

  // 1R: breakeven
  if (rLevel >= config.beAtRMultiple && !position.movedToBreakeven) {
    if (!position.isDryRun) {
      for (const pid of position.metaapiPositionIds) {
        try {
          await metaApi.modifyPosition(pid, { stopLoss: position.entryPrice });
        } catch (e) {
          actions.push(`BE modify failed for ${pid}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    updates.movedToBreakeven = true;
    updates.currentStopLoss = position.entryPrice;
    actions.push(`Moved SL to breakeven (${position.entryPrice})`);
  }

  // 2R: partial close
  if (
    rLevel >= config.partialCloseAtRMultiple &&
    position.status !== 'partial' &&
    position.remainingLots > 0
  ) {
    const fraction = config.partialClosePercent / 100;
    const lotsToClose = roundToStep(position.remainingLots * fraction, config.lotStep);
    if (lotsToClose >= config.minLotSize && !position.isDryRun) {
      await partialCloseAcrossLegs(position, lotsToClose, metaApi);
    }
    updates.remainingLots = roundToStep(position.remainingLots - lotsToClose, config.lotStep);
    updates.partialClosedAt = new Date();
    updates.status = 'partial';
    actions.push(`Partial close ${config.partialClosePercent}% (${lotsToClose} lots)`);
  }

  // 5R: close remaining
  if (rLevel >= config.closeAtRMultiple && position.status !== 'closed') {
    if (!position.isDryRun) {
      for (const pid of position.metaapiPositionIds) {
        try {
          await metaApi.closePosition(pid);
        } catch (e) {
          actions.push(`Close failed for ${pid}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    updates.remainingLots = 0;
    updates.status = 'closed';
    updates.closeReason = `${rLevel}r_target`;
    updates.closedAt = new Date();
    updates.rGainAchieved = rLevel;
    actions.push(`Closed at ${rLevel}R`);
  }

  return { action: actions.join('; ') || `Noop (r_level ${rLevel})`, updates };
}

/**
 * Close all legs of an open position (Invalidation Hit).
 */
export async function applyInvalidationHit(
  position: TvPositionRecord,
  metaApi: MetaApiTradeInterface,
): Promise<{ action: string; updates: Partial<typeof tvPositions.$inferInsert> }> {
  const errors: string[] = [];

  if (!position.isDryRun) {
    for (const pid of position.metaapiPositionIds) {
      try {
        await metaApi.closePosition(pid);
      } catch (e) {
        errors.push(`${pid}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return {
    action: errors.length === 0
      ? `Closed ${position.metaapiPositionIds.length} leg(s) on invalidation`
      : `Closed with errors: ${errors.join('; ')}`,
    updates: {
      remainingLots: 0,
      status: 'invalidated',
      closeReason: 'invalidation_hit',
      closedAt: new Date(),
    },
  };
}

async function partialCloseAcrossLegs(
  position: TvPositionRecord,
  totalLotsToClose: number,
  metaApi: MetaApiTradeInterface,
): Promise<void> {
  // Spread the partial close across legs proportionally. If a leg is too
  // small to take its share, fully close it and roll the surplus onward.
  let remaining = totalLotsToClose;
  const legCount = position.metaapiPositionIds.length;
  for (let i = 0; i < legCount && remaining > 0; i++) {
    const pid = position.metaapiPositionIds[i];
    const share = remaining / (legCount - i);
    try {
      await metaApi.closePositionPartially(pid, share);
      remaining -= share;
    } catch (e) {
      // Don't let one leg failure block the others.
      console.warn(`[tv-positions] partial close failed for ${pid}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

function roundToStep(v: number, step: number): number {
  return Math.round((Math.round(v / step) * step) * 100) / 100;
}
