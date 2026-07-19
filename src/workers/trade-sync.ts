/**
 * Trade Sync Worker
 *
 * Runs as a separate process: npm run worker
 * Syncs all active trading accounts every 5 minutes.
 */

import { db } from '../lib/db';
import { tradingAccounts, trades, balanceOps } from '../lib/db/schema';
import { eq, and, ne, or, lt } from 'drizzle-orm';
import { getMetaApi, withTimeout, SYNC_STEP_TIMEOUT_MS } from '../lib/metaapi';
import { reconcileManualDuplicates } from '../lib/trades/reconcile';
import { recomputeAccountAggregates } from '../lib/accounts/aggregate';
import { recordLiveDeals, recordLiveOrders } from '../lib/accounts/ledger';
import { installMetaApiLogFilter } from '../lib/log-filter';

// Drop MetaApi's engine.io reconnect spam before any connection is opened.
installMetaApiLogFilter();

// A "syncing" claim older than this is considered dead and can be reclaimed.
const STALE_SYNC_MS = 15 * 60_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function syncAccount(accountId: string) {
  const account = await db.query.tradingAccounts.findFirst({
    where: eq(tradingAccounts.id, accountId),
  });

  if (!account || !account.isActive) return;

  // Atomic claim — also reclaims a stale "syncing" (crashed/timed-out attempt).
  const staleBefore = new Date(Date.now() - STALE_SYNC_MS);
  const claimed = await db
    .update(tradingAccounts)
    .set({ syncStatus: 'syncing' })
    .where(and(
      eq(tradingAccounts.id, accountId),
      or(ne(tradingAccounts.syncStatus, 'syncing'), lt(tradingAccounts.updatedAt, staleBefore)),
    ))
    .returning({ id: tradingAccounts.id });

  if (claimed.length === 0) {
    console.log(`[sync] Skipping ${account.name} — already syncing`);
    return;
  }

  console.log(`[sync] Starting sync for account ${account.name} (${account.id})`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let connection: any = null;

  try {
    // Shared per-process SDK client — a new client per account per cycle
    // multiplies websocket connections and rate-limits us (429).
    const api = await getMetaApi();
    const metaAccount = await api.metatraderAccountApi.getAccount(account.metaApiId);

    if (metaAccount.state !== 'DEPLOYED') {
      await withTimeout(metaAccount.waitDeployed(), SYNC_STEP_TIMEOUT_MS, 'account deploy');
    }

    connection = metaAccount.getRPCConnection();
    await connection.connect();
    // Bound the slow RPC steps so one wedged account can't stall the serial loop.
    await withTimeout(connection.waitSynchronized(), SYNC_STEP_TIMEOUT_MS, 'history sync');

    const endDate = new Date();
    const startDate = account.lastSyncAt ? new Date(account.lastSyncAt) : new Date(Date.now() - 2 * 365 * 86400000);

    const deals = await withTimeout(connection.getDealsByTimeRange(startDate, endDate), SYNC_STEP_TIMEOUT_MS, 'deals fetch');

    // Ledger recording (orders/deals distribute endpoints) — best-effort: a
    // failure here must not stall the balance/trade sync below.
    try {
      const dealCount = await recordLiveDeals(accountId, deals);
      const historyOrders = await withTimeout(
        connection.getHistoryOrdersByTimeRange(startDate, endDate),
        SYNC_STEP_TIMEOUT_MS,
        'orders fetch',
      );
      const orderCount = await recordLiveOrders(accountId, historyOrders);
      if (dealCount || orderCount) {
        console.log(`[sync] Ledger for ${account.name}: ${orderCount} orders, ${dealCount} deals`);
      }
    } catch (e) {
      console.warn(`[sync] Ledger recording failed for ${account.name}:`, e instanceof Error ? e.message : e);
    }

    if (deals && Array.isArray(deals)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sortedDeals = [...deals].sort(
        (a: any, b: any) => new Date(a.time).getTime() - new Date(b.time).getTime()
      );

      for (const deal of sortedDeals) {
        const dealTime = new Date(deal.time);

        // Deposits/withdrawals become balance_ops rows — the shared recompute
        // derives the balance curve from them (same pipeline as the Re-sync route).
        if (deal.type === 'DEAL_TYPE_BALANCE') {
          const amount = deal.profit || 0;
          await db
            .insert(balanceOps)
            .values({
              accountId,
              dealId: String(deal.id || deal.orderId || `${deal.time}-${amount}`),
              kind: amount >= 0 ? 'deposit' : 'withdrawal',
              amount,
              time: dealTime,
              comment: deal.comment || null,
            })
            .onConflictDoUpdate({
              target: [balanceOps.accountId, balanceOps.dealId],
              set: { amount, time: dealTime, kind: amount >= 0 ? 'deposit' : 'withdrawal' },
            });
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
              set: { entryPrice: deal.price || 0, lots: deal.volume || 0, openTime: dealTime, commission: deal.commission || 0, source: 'live' },
            });
        } else if (isCloseDeal || isInOut) {
          const existingTrade = await db.query.trades.findFirst({
            where: and(eq(trades.accountId, accountId), eq(trades.ticket, ticket)),
          });

          if (existingTrade) {
            await db
              .update(trades)
              .set({
                closePrice: deal.price || null, closeTime: dealTime,
                profit: deal.profit || 0, pips: deal.pips || null,
                commission: (existingTrade.commission || 0) + (deal.commission || 0),
                swap: deal.swap || 0, isOpen: false, source: 'live',
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
                  source: 'live',
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
                profit: 0, pips: null, commission: 0, swap: 0, isOpen: true, source: 'live',
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
                source: 'live',
              },
            });
        }
      }
    }

    // Merge manual-backfill duplicates, then rebuild snapshots + stats via the
    // shared recompute (openingBalance + balance_ops + trade PnL) — the same
    // authority the Re-sync route and imports use. The old inline version here
    // seeded from the previous stats balance and re-added PnL every cycle,
    // silently inflating the balance every 5 minutes.
    await reconcileManualDuplicates(accountId);
    const agg = await recomputeAccountAggregates(accountId);

    await db
      .update(tradingAccounts)
      .set({ syncStatus: 'synced', lastSyncAt: new Date(), syncError: null })
      .where(eq(tradingAccounts.id, accountId));

    console.log(`[sync] Completed sync for ${account.name}: ${agg.closedTrades} trades`);
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
