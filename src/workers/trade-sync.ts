/**
 * Trade Sync Worker
 *
 * Runs as a separate process: npm run worker
 * Syncs all active trading accounts every 5 minutes.
 */

import { db } from '../lib/db';
import { tradingAccounts, trades, dailySnapshots, accountStats } from '../lib/db/schema';
import { eq, and, ne, lt, or, isNull, sql } from 'drizzle-orm';
import { calculateAccountStats, calculatePips } from '../lib/calculations';
import { format } from 'date-fns';

const STALE_SYNC_MS = 15 * 60 * 1000; // 15 minutes

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function syncAccount(accountId: string) {
  const account = await db.query.tradingAccounts.findFirst({
    where: eq(tradingAccounts.id, accountId),
  });

  if (!account || !account.isActive) return;

  // Recover stale syncs that have been stuck for over 15 minutes
  const staleThreshold = new Date(Date.now() - STALE_SYNC_MS);
  await db
    .update(tradingAccounts)
    .set({ syncStatus: 'error', syncError: 'Sync timed out' })
    .where(and(
      eq(tradingAccounts.id, accountId),
      eq(tradingAccounts.syncStatus, 'syncing'),
      or(lt(tradingAccounts.lastSyncAt, staleThreshold), isNull(tradingAccounts.lastSyncAt))
    ));

  // Atomic claim — don't touch lastSyncAt here; it's used to compute the fetch window
  const claimed = await db
    .update(tradingAccounts)
    .set({ syncStatus: 'syncing' })
    .where(and(eq(tradingAccounts.id, accountId), ne(tradingAccounts.syncStatus, 'syncing')))
    .returning({ id: tradingAccounts.id });

  if (claimed.length === 0) {
    console.log(`[sync] Skipping ${account.name} — already syncing`);
    return;
  }

  console.log(`[sync] Starting sync for account ${account.name} (${account.id})`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let connection: any = null;

  try {
    const MetaApi = require('metaapi.cloud-sdk').default;
    const api = new MetaApi(process.env.METAAPI_TOKEN);
    const metaAccount = await api.metatraderAccountApi.getAccount(account.metaApiId);

    if (metaAccount.state !== 'DEPLOYED') {
      await metaAccount.waitDeployed();
    }

    connection = metaAccount.getRPCConnection();
    await connection.connect();
    await connection.waitSynchronized();

    // Fetch the real account balance/equity from the broker
    const brokerAccountInfo = await connection.getAccountInformation();
    const currentBalance = brokerAccountInfo.balance || 0;
    const currentEquity = brokerAccountInfo.equity || 0;

    const endDate = new Date();
    const fullHistoryStart = new Date(Date.now() - 2 * 365 * 86400000);

    // Auto-detect broken syncs: if lastSyncAt is set but no trades exist, do full sync
    let startDate: Date;
    if (!account.lastSyncAt) {
      startDate = fullHistoryStart;
    } else {
      const tradeCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(trades)
        .where(eq(trades.accountId, accountId));
      const hasTradesInDb = Number(tradeCount[0]?.count || 0) > 0;
      startDate = hasTradesInDb ? new Date(account.lastSyncAt) : fullHistoryStart;
    }

    const dealsResponse = await connection.getDealsByTimeRange(startDate, endDate);
    // MetaAPI SDK may return { deals: [...] } or a flat array depending on version
    const deals = Array.isArray(dealsResponse) ? dealsResponse
      : (dealsResponse && Array.isArray(dealsResponse.deals)) ? dealsResponse.deals
      : [];

    console.log(`[sync] Fetched ${deals.length} deals for ${account.name} (${startDate.toISOString()} to ${endDate.toISOString()})`);

    // Track balance events by date
    const balanceByDate = new Map<string, number>();

    if (deals.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sortedDeals = [...deals].sort(
        (a: any, b: any) => new Date(a.time).getTime() - new Date(b.time).getTime()
      );

      for (const deal of sortedDeals) {
        const dealTime = new Date(deal.time);
        const dateKey = format(dealTime, 'yyyy-MM-dd');

        if (deal.type === 'DEAL_TYPE_BALANCE') {
          balanceByDate.set(dateKey, (balanceByDate.get(dateKey) || 0) + (deal.profit || 0));
          continue;
        }

        if (!deal.symbol) continue;

        // Use canonical position ID as ticket — no suffixes
        const ticket = String(deal.positionId || deal.orderId || deal.id);

        const isOpenDeal = deal.entryType === 'DEAL_ENTRY_IN';
        const isCloseDeal = deal.entryType === 'DEAL_ENTRY_OUT';
        const isInOut = deal.entryType === 'DEAL_ENTRY_INOUT';

        if (isOpenDeal) {
          await db
            .insert(trades)
            .values({
              accountId, ticket, symbol: deal.symbol,
              direction: deal.type === 'DEAL_TYPE_BUY' ? 'BUY' : 'SELL',
              lots: deal.volume || 0, entryPrice: deal.price || 0,
              closePrice: null, openTime: dealTime, closeTime: null,
              profit: 0, pips: null, commission: deal.commission || 0, swap: 0,
              isOpen: true, magicNumber: deal.magic || null, comment: deal.comment || null,
            })
            .onConflictDoUpdate({
              target: [trades.accountId, trades.ticket],
              set: { entryPrice: deal.price || 0, lots: deal.volume || 0, openTime: dealTime, commission: deal.commission || 0 },
            });
        } else if (isCloseDeal || isInOut) {
          const existingTrade = await db.query.trades.findFirst({
            where: and(eq(trades.accountId, accountId), eq(trades.ticket, ticket)),
          });

          if (existingTrade) {
            const closePips = deal.pips ?? (deal.price && existingTrade.entryPrice
              ? calculatePips(deal.symbol, existingTrade.direction, existingTrade.entryPrice, deal.price)
              : null);
            await db
              .update(trades)
              .set({
                closePrice: deal.price || null, closeTime: dealTime,
                profit: deal.profit || 0, pips: closePips,
                commission: (existingTrade.commission || 0) + (deal.commission || 0),
                swap: deal.swap || 0, isOpen: false,
              })
              .where(and(eq(trades.accountId, accountId), eq(trades.ticket, ticket)));
          } else {
            await db
              .insert(trades)
              .values({
                accountId, ticket, symbol: deal.symbol,
                direction: deal.type === 'DEAL_TYPE_BUY' ? 'SELL' : 'BUY',
                lots: deal.volume || 0, entryPrice: deal.price || 0,
                closePrice: deal.price || null, openTime: dealTime, closeTime: dealTime,
                profit: deal.profit || 0, pips: deal.pips || null,
                commission: deal.commission || 0, swap: deal.swap || 0,
                isOpen: false, magicNumber: deal.magic || null, comment: deal.comment || null,
              })
              .onConflictDoUpdate({
                target: [trades.accountId, trades.ticket],
                set: {
                  profit: deal.profit || 0, closePrice: deal.price || null,
                  closeTime: dealTime, isOpen: false,
                  commission: deal.commission || 0, swap: deal.swap || 0, pips: deal.pips || null,
                },
              });
          }

          // INOUT: reopen position — update the same ticket row back to open
          if (isInOut) {
            await db
              .update(trades)
              .set({
                direction: deal.type === 'DEAL_TYPE_BUY' ? 'BUY' : 'SELL',
                entryPrice: deal.price || 0, openTime: dealTime,
                closePrice: null, closeTime: null,
                profit: 0, pips: null, commission: 0, swap: 0, isOpen: true,
              })
              .where(and(eq(trades.accountId, accountId), eq(trades.ticket, ticket)));
          }
        } else {
          console.warn(`[sync] Unknown entry type for deal ${deal.id}, treating as close`);
          await db
            .insert(trades)
            .values({
              accountId, ticket, symbol: deal.symbol,
              direction: deal.type === 'DEAL_TYPE_BUY' ? 'SELL' : 'BUY',
              lots: deal.volume || 0, entryPrice: deal.price || 0,
              closePrice: deal.price || null, openTime: dealTime, closeTime: dealTime,
              profit: deal.profit || 0, pips: deal.pips || null,
              commission: deal.commission || 0, swap: deal.swap || 0,
              isOpen: false, magicNumber: deal.magic || null, comment: deal.comment || null,
            })
            .onConflictDoUpdate({
              target: [trades.accountId, trades.ticket],
              set: {
                profit: deal.profit || 0, closePrice: deal.price || null,
                closeTime: dealTime, isOpen: false,
                commission: deal.commission || 0, swap: deal.swap || 0, pips: deal.pips || null,
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

    // Use broker-reported balance as the source of truth
    // Work backwards from the current balance to find the starting balance
    const totalClosedPnl = closedTrades.reduce((sum, t) => sum + t.profit, 0);
    const totalBalanceEvents = Array.from(balanceByDate.values()).reduce((sum, v) => sum + v, 0);
    const startingBalance = currentBalance - totalClosedPnl - totalBalanceEvents;

    const allDates = new Set([...dailyMap.keys(), ...balanceByDate.keys()]);
    let runningBalance = startingBalance;

    for (const dateKey of [...allDates].sort()) {
      const balanceChange = balanceByDate.get(dateKey) || 0;
      runningBalance += balanceChange;

      const dayTrades = dailyMap.get(dateKey) || [];
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
          set: {
            balance: runningBalance, equity: runningBalance, pnl: dayPnl,
            tradeCount: dayTrades.length,
            winCount: dayTrades.filter((t) => t.profit > 0).length,
            lossCount: dayTrades.filter((t) => t.profit < 0).length,
            volume: dayTrades.reduce((sum, t) => sum + t.lots, 0),
            pips: dayTrades.reduce((sum, t) => sum + (t.pips || 0), 0),
            commission: dayTrades.reduce((sum, t) => sum + t.commission, 0),
            swap: dayTrades.reduce((sum, t) => sum + t.swap, 0),
          },
        });
    }

    const stats = calculateAccountStats(
      allTrades.map((t) => ({
        profit: t.profit, pips: t.pips, lots: t.lots, commission: t.commission,
        swap: t.swap, openTime: t.openTime, closeTime: t.closeTime, isOpen: t.isOpen,
        symbol: t.symbol, direction: t.direction, entryPrice: t.entryPrice, closePrice: t.closePrice,
      }))
    );

    await db
      .insert(accountStats)
      .values({ accountId, balance: currentBalance, equity: currentEquity, ...stats, lastCalculatedAt: new Date() })
      .onConflictDoUpdate({
        target: accountStats.accountId,
        set: { balance: currentBalance, equity: currentEquity, ...stats, lastCalculatedAt: new Date() },
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
  } finally {
    // Always close the connection
    if (connection) {
      try { await connection.close(); } catch {}
    }
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

const INTERVAL = 5 * 60 * 1000;

async function main() {
  console.log('[worker] Trade sync worker started');
  console.log(`[worker] Sync interval: ${INTERVAL / 1000}s`);

  // Serial loop: await cycle completion before waiting for next interval
  while (true) {
    await runSyncCycle();
    await sleep(INTERVAL);
  }
}

main().catch((err) => {
  console.error('[worker] Fatal error:', err);
  process.exit(1);
});
