import type {
  ParsedMessage,
  MetaApiTradeInterface,
  CancellationResult,
} from '@/types/signals';
import { db } from '@/lib/db';
import { signalExecutions } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

export async function handleCancellation(
  parsedMessage: Extract<ParsedMessage, { type: 'cancellation' }>,
  configId: string,
  metaApi: MetaApiTradeInterface,
): Promise<CancellationResult[]> {
  const { cancellation } = parsedMessage;
  const results: CancellationResult[] = [];

  // Find pending executions to cancel
  const conditions = [
    eq(signalExecutions.configId, configId),
    eq(signalExecutions.status, 'sent'),
  ];

  if (cancellation.type === 'cancel_specific' && cancellation.tradeNumber != null) {
    conditions.push(eq(signalExecutions.tradeNumber, cancellation.tradeNumber));
  }

  const pendingExecutions = await db
    .select()
    .from(signalExecutions)
    .where(and(...conditions));

  for (const exec of pendingExecutions) {
    try {
      if (!exec.metaapiOrderId) {
        results.push({
          executionId: exec.id,
          status: 'error',
          message: 'No MetaApi order ID — cannot cancel',
        });
        continue;
      }

      await metaApi.cancelOrder(exec.metaapiOrderId);

      await db
        .update(signalExecutions)
        .set({ status: 'cancelled' })
        .where(eq(signalExecutions.id, exec.id));

      results.push({
        executionId: exec.id,
        status: 'cancelled',
        message: `Cancelled order ${exec.metaapiOrderId}`,
      });
    } catch (error) {
      results.push({
        executionId: exec.id,
        status: 'error',
        message: `Failed to cancel: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  // Check for already-filled executions (no-op)
  const filledConditions = [
    eq(signalExecutions.configId, configId),
    eq(signalExecutions.status, 'filled'),
  ];
  if (cancellation.type === 'cancel_specific' && cancellation.tradeNumber != null) {
    filledConditions.push(eq(signalExecutions.tradeNumber, cancellation.tradeNumber));
  }

  const filledExecutions = await db
    .select()
    .from(signalExecutions)
    .where(and(...filledConditions));

  for (const exec of filledExecutions) {
    results.push({
      executionId: exec.id,
      status: 'already_filled',
      message: `Order ${exec.metaapiOrderId} already filled — cannot cancel (no-op)`,
    });
  }

  return results;
}
