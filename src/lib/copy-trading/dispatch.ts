import { db } from '@/lib/db';
import { copyPositions, copyEvents, copySlaves } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import type {
  MasterPositionEvent,
  ResolvedCopyGroup,
  ResolvedCopySlave,
  ResolvedSymbolMap,
  CopyTradeInterface,
  CopySizingInput,
  CopyEventType,
} from '@/types/copy-trading';
import { calculateCopyLotSize } from './sizing';

type TradeInterfaceMap = Map<string, CopyTradeInterface>;

async function logEvent(
  groupId: string,
  eventType: CopyEventType,
  copyPositionId: string | null,
  masterAccountId: string | null,
  slaveAccountId: string | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any,
): Promise<void> {
  await db.insert(copyEvents).values({
    groupId,
    copyPositionId,
    eventType,
    masterAccountId,
    slaveAccountId,
    payload: payload ? JSON.stringify(payload) : null,
  });
}

export async function dispatchOpen(
  event: MasterPositionEvent,
  group: ResolvedCopyGroup,
  tradeInterfaces: TradeInterfaceMap,
): Promise<void> {
  for (const slave of group.slaves) {
    if (!slave.isEnabled) continue;

    // Direction filter
    if (slave.directionFilter) {
      const eventDir = event.direction === 'BUY' ? 'LONG' : 'SHORT';
      if (slave.directionFilter !== eventDir) {
        await logEvent(group.id, 'skipped_filter', null, group.masterAccountId, slave.accountId, { reason: 'direction_filter', filter: slave.directionFilter, direction: eventDir });
        continue;
      }
    }

    // Symbol mapping
    const symbolMap = slave.symbolMaps.get(event.symbol);
    if (!symbolMap || !symbolMap.isEnabled) {
      await logEvent(group.id, 'symbol_unmapped', null, group.masterAccountId, slave.accountId, { masterSymbol: event.symbol });
      continue;
    }

    // Max open positions check
    if (slave.maxOpenPositions != null) {
      const countResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(copyPositions)
        .where(and(eq(copyPositions.slaveId, slave.id), eq(copyPositions.status, 'open')));
      if (Number(countResult[0]?.count || 0) >= slave.maxOpenPositions) {
        await logEvent(group.id, 'skipped_filter', null, group.masterAccountId, slave.accountId, { reason: 'max_open_positions' });
        continue;
      }
    }

    await executeSlaveCopy(event, group, slave, symbolMap, tradeInterfaces);
  }
}

async function executeSlaveCopy(
  event: MasterPositionEvent,
  group: ResolvedCopyGroup,
  slave: ResolvedCopySlave,
  symbolMap: ResolvedSymbolMap,
  tradeInterfaces: TradeInterfaceMap,
): Promise<void> {
  const tradeInterface = tradeInterfaces.get(slave.accountId);
  if (!tradeInterface && !slave.dryRun) {
    console.error(`[copy] No trade interface for slave ${slave.accountId}`);
    return;
  }

  // Build sizing input (prefer symbol-level overrides)
  const sizingMode = symbolMap.sizingMode ?? slave.sizingMode;
  const sizingInput: CopySizingInput = {
    masterLots: event.lots,
    masterEntryPrice: event.entryPrice,
    masterStopLoss: event.stopLoss ?? null,
    slaveSymbol: symbolMap.slaveSymbol,
    sizingMode,
    multiplier: symbolMap.multiplier ?? slave.multiplier,
    riskPercent: symbolMap.riskPercent ?? slave.riskPercent,
    riskBase: slave.riskBase as 'balance' | 'equity',
    maxRiskPercent: slave.maxRiskPercent,
    fixedLots: symbolMap.fixedLots ?? slave.fixedLots,
    pipValuePerLot: symbolMap.pipValuePerLot,
    minLotSize: symbolMap.minLotSize,
    lotStep: symbolMap.lotStep,
    maxLotSize: slave.maxLotSize,
    maxLotsPerOrder: slave.maxLotsPerOrder,
  };

  let sizing;
  try {
    const accountInfo = slave.dryRun
      ? { balance: 10000, equity: 10000, freeMargin: 10000 }
      : await tradeInterface!.getAccountInfo();
    sizing = calculateCopyLotSize(sizingInput, accountInfo);
  } catch (err) {
    await logEvent(group.id, 'sizing_error', null, group.masterAccountId, slave.accountId, { error: String(err) });
    return;
  }

  // Insert copy_positions row
  const startTime = Date.now();
  const [copyPos] = await db.insert(copyPositions).values({
    groupId: group.id,
    slaveId: slave.id,
    symbolMapId: symbolMap.id,
    masterAccountId: group.masterAccountId,
    masterPositionId: event.positionId,
    masterSymbol: event.symbol,
    masterDirection: event.direction,
    masterLots: event.lots,
    masterEntryPrice: event.entryPrice,
    masterSl: event.stopLoss,
    masterTp: event.takeProfit,
    slaveAccountId: slave.accountId,
    slaveSymbol: symbolMap.slaveSymbol,
    slaveDirection: event.direction,
    slaveLots: sizing.lots,
    slaveSl: symbolMap.copySl ? event.stopLoss : null,
    slaveTp: symbolMap.copyTp ? event.takeProfit : null,
    sizingMode: sizing.mode,
    sizingDetail: sizing.detail,
    status: 'pending',
    masterOpenedAt: event.timestamp,
    isDryRun: slave.dryRun,
  }).returning();

  await logEvent(group.id, 'master_open', copyPos.id, group.masterAccountId, slave.accountId, {
    masterPositionId: event.positionId, symbol: event.symbol, direction: event.direction, lots: event.lots,
  });

  if (slave.dryRun) {
    await db.update(copyPositions).set({ status: 'dry_run' }).where(eq(copyPositions.id, copyPos.id));
    console.log(`[copy] DRY RUN: ${event.symbol} ${event.direction} ${sizing.lots} lots → ${symbolMap.slaveSymbol} (${sizing.detail})`);
    return;
  }

  // Execute on slave
  try {
    await db.update(copyPositions).set({ status: 'opening' }).where(eq(copyPositions.id, copyPos.id));
    await logEvent(group.id, 'slave_open_sent', copyPos.id, group.masterAccountId, slave.accountId);

    const result = await tradeInterface!.openPosition({
      symbol: symbolMap.slaveSymbol,
      direction: event.direction,
      volume: sizing.lots,
      stopLoss: symbolMap.copySl ? event.stopLoss : undefined,
      takeProfit: symbolMap.copyTp ? event.takeProfit : undefined,
      comment: `copy-${group.id.slice(0, 8)}`,
      slippage: slave.maxSlippage,
    });

    await db.update(copyPositions).set({
      status: 'open',
      slavePositionId: result.positionId,
      slaveOpenedAt: new Date(),
      openLatencyMs: Date.now() - startTime,
    }).where(eq(copyPositions.id, copyPos.id));

    await logEvent(group.id, 'slave_open_filled', copyPos.id, group.masterAccountId, slave.accountId, {
      slavePositionId: result.positionId, lots: sizing.lots, latencyMs: Date.now() - startTime,
    });

    console.log(`[copy] OPEN: ${event.symbol} ${event.direction} → ${symbolMap.slaveSymbol} ${sizing.lots} lots (${Date.now() - startTime}ms)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(copyPositions).set({ status: 'error', errorMessage: message }).where(eq(copyPositions.id, copyPos.id));
    await logEvent(group.id, 'slave_open_error', copyPos.id, group.masterAccountId, slave.accountId, { error: message });
    console.error(`[copy] ERROR opening ${symbolMap.slaveSymbol}: ${message}`);
  }
}

export async function dispatchClose(
  event: MasterPositionEvent,
  group: ResolvedCopyGroup,
  tradeInterfaces: TradeInterfaceMap,
): Promise<void> {
  const linkedPositions = await db.query.copyPositions.findMany({
    where: and(
      eq(copyPositions.masterAccountId, group.masterAccountId),
      eq(copyPositions.masterPositionId, event.positionId),
      eq(copyPositions.status, 'open'),
    ),
  });

  for (const pos of linkedPositions) {
    await logEvent(group.id, 'master_close', pos.id, group.masterAccountId, pos.slaveAccountId, {
      masterPositionId: event.positionId, closePrice: event.closePrice,
    });

    if (pos.isDryRun) {
      await db.update(copyPositions).set({
        status: 'closed',
        masterClosePrice: event.closePrice,
        masterClosedAt: event.timestamp,
      }).where(eq(copyPositions.id, pos.id));
      continue;
    }

    const tradeInterface = tradeInterfaces.get(pos.slaveAccountId);
    if (!tradeInterface || !pos.slavePositionId) {
      await db.update(copyPositions).set({ status: 'error', errorMessage: 'No trade interface or position ID' }).where(eq(copyPositions.id, pos.id));
      continue;
    }

    const startTime = Date.now();
    try {
      await db.update(copyPositions).set({ status: 'closing' }).where(eq(copyPositions.id, pos.id));
      await logEvent(group.id, 'slave_close_sent', pos.id, group.masterAccountId, pos.slaveAccountId);

      await tradeInterface.closePosition(pos.slavePositionId);

      await db.update(copyPositions).set({
        status: 'closed',
        masterClosePrice: event.closePrice,
        masterClosedAt: event.timestamp,
        slaveClosedAt: new Date(),
        closeLatencyMs: Date.now() - startTime,
      }).where(eq(copyPositions.id, pos.id));

      await logEvent(group.id, 'slave_close_filled', pos.id, group.masterAccountId, pos.slaveAccountId, {
        latencyMs: Date.now() - startTime,
      });

      console.log(`[copy] CLOSE: ${pos.slaveSymbol} position ${pos.slavePositionId} (${Date.now() - startTime}ms)`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.update(copyPositions).set({ status: 'error', errorMessage: message }).where(eq(copyPositions.id, pos.id));
      await logEvent(group.id, 'slave_close_error', pos.id, group.masterAccountId, pos.slaveAccountId, { error: message });
      console.error(`[copy] ERROR closing ${pos.slaveSymbol}: ${message}`);
    }
  }
}

export async function dispatchModify(
  event: MasterPositionEvent,
  group: ResolvedCopyGroup,
  tradeInterfaces: TradeInterfaceMap,
): Promise<void> {
  const linkedPositions = await db.query.copyPositions.findMany({
    where: and(
      eq(copyPositions.masterAccountId, group.masterAccountId),
      eq(copyPositions.masterPositionId, event.positionId),
      eq(copyPositions.status, 'open'),
    ),
  });

  for (const pos of linkedPositions) {
    const slave = group.slaves.find((s) => s.id === pos.slaveId);
    if (!slave) continue;

    const symbolMap = slave.symbolMaps.get(event.symbol);
    if (!symbolMap) continue;

    const newSl = symbolMap.copySl ? event.stopLoss : undefined;
    const newTp = symbolMap.copyTp ? event.takeProfit : undefined;
    if (newSl == null && newTp == null) continue;

    if (pos.isDryRun) {
      await db.update(copyPositions).set({
        masterSl: event.stopLoss, masterTp: event.takeProfit,
        slaveSl: newSl ?? pos.slaveSl, slaveTp: newTp ?? pos.slaveTp,
      }).where(eq(copyPositions.id, pos.id));
      continue;
    }

    const tradeInterface = tradeInterfaces.get(pos.slaveAccountId);
    if (!tradeInterface || !pos.slavePositionId) continue;

    try {
      await logEvent(group.id, 'slave_modify_sent', pos.id, group.masterAccountId, pos.slaveAccountId, { newSl, newTp });
      await tradeInterface.modifyPosition(pos.slavePositionId, { stopLoss: newSl, takeProfit: newTp });

      await db.update(copyPositions).set({
        masterSl: event.stopLoss, masterTp: event.takeProfit,
        slaveSl: newSl ?? pos.slaveSl, slaveTp: newTp ?? pos.slaveTp,
      }).where(eq(copyPositions.id, pos.id));

      await logEvent(group.id, 'slave_modify_filled', pos.id, group.masterAccountId, pos.slaveAccountId);
      console.log(`[copy] MODIFY: ${pos.slaveSymbol} SL=${newSl} TP=${newTp}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await logEvent(group.id, 'slave_modify_error', pos.id, group.masterAccountId, pos.slaveAccountId, { error: message });
      console.error(`[copy] ERROR modifying ${pos.slaveSymbol}: ${message}`);
    }
  }
}
