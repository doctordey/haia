/**
 * BullMQ Trade Sync Worker
 *
 * Runs as a separate process: npm run worker
 * Processes sync jobs for all active trading accounts.
 *
 * Requires REDIS_URL and DATABASE_URL environment variables.
 */

import { db } from '../lib/db';
import { tradingAccounts, trades, dailySnapshots, accountStats } from '../lib/db/schema';
import { eq } from 'drizzle-orm';
import { calculateAccountStats } from '../lib/calculations';
import { format } from 'date-fns';

async function syncAccount(accountId: string) {
  const account = await db.query.tradingAccounts.findFirst({
    where: eq(tradingAccounts.id, accountId),
  });

  if (!account || !account.isActive) return;

  console.log(`[sync] Starting sync for account ${account.name} (${account.id})`);

  await db
    .update(tradingAccounts)
    .set({ syncStatus: 'syncing' })
    .where(eq(tradingAccounts.id, accountId));

  try {
    // Dynamic import to avoid ESM issues
    const MetaApi = require('metaapi.cloud-sdk').default;
    const api = new MetaApi(process.env.METAAPI_TOKEN);
    const metaAccount = await api.metatraderAccountApi.getAccount(account.metaApiId);

    if (metaAccount.state !== 'DEPLOYED') {
      await metaAccount.waitDeployed();
    }

    const connection = metaAccount.getRPCConnection();
    await connection.connect();
    await connection.waitSynchronized();

    // Fetch deals since last sync (or last 2 years if never synced)
    const endDate = new Date();
    const startDate = account.lastSyncAt ? new Date(account.lastSyncAt) : new Date(Date.now() - 2 * 365 * 86400000);

    const deals = await connection.getDealsByTimeRange(startDate, endDate);
    await connection.close();

    if (deals && Array.isArray(deals)) {
      for (const deal of deals) {
        if (deal.type === 'DEAL_TYPE_BALANCE') continue;

        const tradeData = {
          accountId,
          ticket: String(deal.id || deal.orderId),
          symbol: deal.symbol || 'UNKNOWN',
          direction: deal.type === 'DEAL_TYPE_BUY' ? 'BUY' : 'SELL',
          lots: deal.volume || 0,
          entryPrice: deal.price || 0,
          closePrice: deal.price || null,
          openTime: new Date(deal.time),
          closeTime: new Date(deal.time),
          profit: deal.profit || 0,
          pips: deal.pips || null,
          commission: deal.commission || 0,
          swap: deal.swap || 0,
          isOpen: false,
          magicNumber: deal.magic || null,
          comment: deal.comment || null,
        };

        await db
          .insert(trades)
          .values(tradeData)
          .onConflictDoUpdate({
            target: [trades.accountId, trades.ticket],
            set: { profit: tradeData.profit, closePrice: tradeData.closePrice, commission: tradeData.commission, swap: tradeData.swap, pips: tradeData.pips },
          });
      }
    }

    // Rebuild daily snapshots
    const allTrades = await db.query.trades.findMany({ where: eq(trades.accountId, accountId) });
    const closedTrades = allTrades.filter((t) => t.closeTime && !t.isOpen);
    const dailyMap = new Map<string, typeof closedTrades>();

    for (const trade of closedTrades) {
      const dateKey = format(trade.closeTime!, 'yyyy-MM-dd');
      if (!dailyMap.has(dateKey)) dailyMap.set(dateKey, []);
      dailyMap.get(dateKey)!.push(trade);
    }

    let runningBalance = 0;
    for (const dateKey of [...dailyMap.keys()].sort()) {
      const dayTrades = dailyMap.get(dateKey)!;
      const dayPnl = dayTrades.reduce((sum, t) => sum + t.profit, 0);
      runningBalance += dayPnl;

      await db
        .insert(dailySnapshots)
        .values({
          accountId, date: dateKey, balance: runningBalance, equity: runningBalance,
          pnl: dayPnl, tradeCount: dayTrades.length,
          winCount: dayTrades.filter((t) => t.profit > 0).length,
          lossCount: dayTrades.filter((t) => t.profit < 0).length,
          volume: dayTrades.reduce((sum, t) => sum + t.lots, 0),
          pips: dayTrades.reduce((sum, t) => sum + (t.pips || 0), 0),
          commission: dayTrades.reduce((sum, t) => sum + t.commission, 0),
          swap: dayTrades.reduce((sum, t) => sum + t.swap, 0),
        })
        .onConflictDoUpdate({
          target: [dailySnapshots.accountId, dailySnapshots.date],
          set: { balance: runningBalance, equity: runningBalance, pnl: dayPnl, tradeCount: dayTrades.length,
            winCount: dayTrades.filter((t) => t.profit > 0).length, lossCount: dayTrades.filter((t) => t.profit < 0).length,
            volume: dayTrades.reduce((sum, t) => sum + t.lots, 0), pips: dayTrades.reduce((sum, t) => sum + (t.pips || 0), 0),
            commission: dayTrades.reduce((sum, t) => sum + t.commission, 0), swap: dayTrades.reduce((sum, t) => sum + t.swap, 0),
          },
        });
    }

    // Recalculate stats
    const stats = calculateAccountStats(
      allTrades.map((t) => ({
        profit: t.profit, pips: t.pips, lots: t.lots, commission: t.commission,
        swap: t.swap, openTime: t.openTime, closeTime: t.closeTime, isOpen: t.isOpen,
        symbol: t.symbol, direction: t.direction, entryPrice: t.entryPrice, closePrice: t.closePrice,
      }))
    );

    await db
      .insert(accountStats)
      .values({ accountId, balance: runningBalance, equity: runningBalance, ...stats, lastCalculatedAt: new Date() })
      .onConflictDoUpdate({
        target: accountStats.accountId,
        set: { balance: runningBalance, equity: runningBalance, ...stats, lastCalculatedAt: new Date() },
      });

    await db
      .update(tradingAccounts)
      .set({ syncStatus: 'synced', lastSyncAt: new Date(), syncError: null })
      .where(eq(tradingAccounts.id, accountId));

    console.log(`[sync] Completed sync for ${account.name}: ${closedTrades.length} trades`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Sync failed';
    console.error(`[sync] Error syncing ${account.name}:`, message);

    await db
      .update(tradingAccounts)
      .set({ syncStatus: 'error', syncError: message })
      .where(eq(tradingAccounts.id, accountId));
  }
}

async function runSyncCycle() {
  console.log('[sync] Starting sync cycle...');
  const activeAccounts = await db.query.tradingAccounts.findMany({
    where: eq(tradingAccounts.isActive, true),
  });

  for (const account of activeAccounts) {
    try {
      await syncAccount(account.id);
    } catch (error) {
      console.error(`[sync] Failed to sync account ${account.id}:`, error);
    }
  }
  console.log('[sync] Sync cycle complete.');
}

// Run every 5 minutes
const INTERVAL = 5 * 60 * 1000;

async function main() {
  console.log('[worker] Trade sync worker started');
  console.log(`[worker] Sync interval: ${INTERVAL / 1000}s`);

  // Initial sync
  await runSyncCycle();

  // Schedule recurring syncs
  setInterval(runSyncCycle, INTERVAL);
}

main().catch((err) => {
  console.error('[worker] Fatal error:', err);
  process.exit(1);
});
