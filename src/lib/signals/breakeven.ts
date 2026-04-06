import { db } from '@/lib/db';
import { signalExecutions } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import type { MetaApiTradeInterface } from '@/types/signals';

/**
 * Called when a position closes. If it was a TP1 split execution that closed
 * at take profit, moves the linked TP2 position's SL to the original entry price.
 */
export async function onPositionClosed(
  closedPositionOrderId: string,
  wasTPHit: boolean,
  metaApi: MetaApiTradeInterface,
): Promise<{ action: string; breakevenMovedAt?: Date } | null> {
  // Find the execution row for the closed position
  const [closedExec] = await db
    .select()
    .from(signalExecutions)
    .where(eq(signalExecutions.metaapiOrderId, closedPositionOrderId));

  if (!closedExec) {
    return null;
  }

  // Only process TP1 positions in split mode
  if (closedExec.splitIndex !== 1 || !closedExec.linkedExecutionId) {
    return null;
  }

  // If TP1 was stopped out (not TP hit), leave TP2 unchanged
  if (!wasTPHit) {
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
    return { action: 'tp2_not_found' };
  }

  // Already moved
  if (tp2Exec.breakevenMovedAt) {
    return { action: 'already_moved' };
  }

  // Move TP2's SL to the original entry price (breakeven)
  const entryPrice = tp2Exec.adjustedEntry;
  if (entryPrice == null) {
    return { action: 'no_entry_price' };
  }

  try {
    await metaApi.modifyPosition(tp2Exec.metaapiOrderId, {
      stopLoss: entryPrice,
    });

    const now = new Date();
    await db
      .update(signalExecutions)
      .set({ breakevenMovedAt: now })
      .where(eq(signalExecutions.id, tp2Exec.id));

    return { action: 'breakeven_moved', breakevenMovedAt: now };
  } catch (error) {
    console.error(
      `Failed to move TP2 breakeven for execution ${tp2Exec.id}:`,
      error,
    );
    return { action: 'error' };
  }
}
