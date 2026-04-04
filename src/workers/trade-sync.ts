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
import { eq, and } from 'drizzle-orm';
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

    // Track balance deposits/withdrawals for accurate account balance
    let initialBalance = 0;

    if (deals && Array.isArray(deals)) {
      // Sort deals chronologically
      const sortedDeals = [...deals].sort(
        (a: { time: string }, b: { time: string }) => new Date(a.time).getTime() - new Date(b.time).getTime()
      );

      for (const deal of sortedDeals) {
        // Capture balance operations (deposits/withdrawals) for balance tracking
        if (deal.type === 'DEAL_TYPE_BALANCE') {
          initialBalance += deal.profit || 0;
          continue;
        }

        // Skip deals without a symbol (non-trade deals)
        if (!deal.symbol) continue;

        const ticket = String(deal.positionId || deal.orderId || deal.id);
        const dealTime = new Date(deal.time);

        // Determine if this is an opening or closing deal
        // MetaApi deal entry types: DEAL_ENTRY_IN (open), DEAL_ENTRY_OUT (close), DEAL_ENTRY_INOUT (close+open)
        const isOpenDeal = deal.entryType === 'DEAL_ENTRY_IN';
        const isCloseDeal = deal.entryType === 'DEAL_ENTRY_OUT' || deal.entryType === 'DEAL_ENTRY_INOUT';

        if (isOpenDeal) {
          // Opening deal — create a new trade record as open
          await db
            .insert(trades)
            .values({
              accountId,
              ticket,
              symbol: deal.symbol,
              direction: deal.type === 'DEAL_TYPE_BUY' ? 'BUY' : 'SELL',
              lots: deal.volume || 0,
              entryPrice: deal.price || 0,
              closePrice: null,
              openTime: dealTime,
              closeTime: null,
              profit: 0,
              pips: null,
              commission: deal.commission || 0,
              swap: 0,
              isOpen: true,
              magicNumber: deal.magic || null,
              comment: deal.comment || null,
            })
            .onConflictDoUpdate({
              target: [trades.accountId, trades.ticket],
              set: {
                entryPrice: deal.price || 0,
                lots: deal.volume || 0,
                openTime: dealTime,
                commission: deal.commission || 0,
              },
            });
        } else if (isCloseDeal) {
          // Closing deal — find and update the existing open trade
          const existingTrade = await db.query.trades.findFirst({
            where: and(eq(trades.accountId, accountId), eq(trades.ticket, ticket)),
          });

          if (existingTrade) {
            // Update existing trade with close data
            await db
              .update(trades)
              .set({
                closePrice: deal.price || null,
                closeTime: dealTime,
                profit: deal.profit || 0,
                pips: deal.pips || null,
                commission: (existingTrade.commission || 0) + (deal.commission || 0),
                swap: deal.swap || 0,
                isOpen: false,
              })
              .where(and(eq(trades.accountId, accountId), eq(trades.ticket, ticket)));
          } else {
            // No matching open trade found — insert as a completed trade
            await db
              .insert(trades)
              .values({
                accountId,
                ticket,
                symbol: deal.symbol,
                direction: deal.type === 'DEAL_TYPE_BUY' ? 'BUY' : 'SELL',
                lots: deal.volume || 0,
                entryPrice: deal.price || 0,
                closePrice: deal.price || null,
                openTime: dealTime,
                closeTime: dealTime,
                profit: deal.profit || 0,
                pips: deal.pips || null,
                commission: deal.commission || 0,
                swap: deal.swap || 0,
                isOpen: false,
                magicNumber: deal.magic || null,
                comment: deal.comment || null,
              })
              .onConflictDoUpdate({
                target: [trades.accountId, trades.ticket],
                set: {
                  profit: deal.profit || 0,
                  closePrice: deal.price || null,
                  closeTime: dealTime,
                  commission: deal.commission || 0,
                  swap: deal.swap || 0,
                  pips: deal.pips || null,
                  isOpen: false,
                },
              });
          }
        } else {
          // Unknown entry type — treat as a completed trade (fallback)
          await db
            .insert(trades)
            .values({
              accountId,
              ticket,
              symbol: deal.symbol,
              direction: deal.type === 'DEAL_TYPE_BUY' ? 'BUY' : 'SELL',
              lots: deal.volume || 0,
              entryPrice: deal.price || 0,
              closePrice: deal.price || null,
              openTime: dealTime,
              closeTime: dealTime,
              profit: deal.profit || 0,
              pips: deal.pips || null,
              commission: deal.commission || 0,
              swap: deal.swap || 0,
              isOpen: false,
              magicNumber: deal.magic || null,
              comment: deal.comment || null,
            })
            .onConflictDoUpdate({
              target: [trades.accountId, trades.ticket],
              set: {
                profit: deal.profit || 0,
                closePrice: deal.price || null,
                commission: deal.commission || 0,
                swap: deal.swap || 0,
                pips: deal.pips || null,
              },
            });
        }
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

    // Start balance from deposits/withdrawals, then accumulate PNL
    let runningBalance = initialBalance;
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

    console.log(`[sync] Completed sync for ${account.name}: ${closedTrades.length} trades, balance: ${runningBalance}`);
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

  await runSyncCycle();
  setInterval(runSyncCycle, INTERVAL);
}

main().catch((err) => {
  console.error('[worker] Fatal error:', err);
  process.exit(1);
});
