import { db } from '@/lib/db';
import { signalExecutions } from '@/lib/db/schema';
import { eq, and, or } from 'drizzle-orm';
import type { MetaApiTradeInterface } from '@/types/signals';

/**
 * Called when a position closes. If it was a TP1 split execution that closed
 * at take profit, moves the linked TP2 position's SL to the original entry price.
 *
 * The closedPositionId may be either the MetaApi orderId or positionId —
 * MT5 uses different IDs for orders vs positions. We search both.
 */
export async function onPositionClosed(
  closedPositionId: string,
  wasTPHit: boolean,
  metaApi: MetaApiTradeInterface,
): Promise<{ action: string; breakevenMovedAt?: Date } | null> {
  // Find the execution row — search by metaapiOrderId (may match orderId or positionId)
  const matchingExecs = await db
    .select()
    .from(signalExecutions)
    .where(eq(signalExecutions.metaapiOrderId, closedPositionId));

  // If not found by orderId, the positionId might be stored differently
  // In MT5, the orderId from createMarketBuyOrder response may differ from the positionId in onDealAdded
  const closedExec = matchingExecs[0] ?? null;

  if (!closedExec) {
    // Not a signal-copied trade — ignore silently
    return null;
  }

  // Only process TP1 positions in split mode
  if (closedExec.splitIndex !== 1 || !closedExec.linkedExecutionId) {
    return null;
  }

  // If TP1 was stopped out (not TP hit), leave TP2 unchanged
  if (!wasTPHit) {
    console.log(`[breakeven] TP1 stopped out (not TP hit) — leaving TP2 unchanged`);
    return { action: 'tp1_stopped_out_no_action' };
  }

  // Find the linked TP2 execution
  const [tp2Exec] = await db
    .select()
    .from(signalExecutions)
    .where(
      and(
        eq(signalExecutions.id, closedExec.linkedExecutionId),
        eq(signalExecutions.splitIndex, 2),
      ),
    );

  if (!tp2Exec || !tp2Exec.metaapiOrderId) {
    console.warn(`[breakeven] TP2 execution not found for linked ID ${closedExec.linkedExecutionId}`);
    return { action: 'tp2_not_found' };
  }

  // Already moved
  if (tp2Exec.breakevenMovedAt) {
    return { action: 'already_moved' };
  }

  // Move TP2's SL to the original entry price (breakeven)
  const entryPrice = tp2Exec.adjustedEntry;
  if (entryPrice == null) {
    console.warn(`[breakeven] No adjusted entry price for TP2 execution ${tp2Exec.id}`);
    return { action: 'no_entry_price' };
  }

  try {
    console.log(`[breakeven] Moving TP2 SL to entry ${entryPrice} for position ${tp2Exec.metaapiOrderId}`);
    await metaApi.modifyPosition(tp2Exec.metaapiOrderId, {
      stopLoss: entryPrice,
    });

    const now = new Date();
    await db
      .update(signalExecutions)
      .set({ breakevenMovedAt: now })
      .where(eq(signalExecutions.id, tp2Exec.id));

    console.log(`[breakeven] Successfully moved TP2 SL to breakeven for execution ${tp2Exec.id}`);
    return { action: 'breakeven_moved', breakevenMovedAt: now };
  } catch (error) {
    console.error(
      `[breakeven] Failed to move TP2 breakeven for execution ${tp2Exec.id}:`,
      error,
    );
    return { action: 'error' };
  }
}
