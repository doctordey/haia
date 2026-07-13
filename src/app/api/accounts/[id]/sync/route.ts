import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { tradingAccounts, trades, balanceOps } from '@/lib/db/schema';
import { eq, and, ne } from 'drizzle-orm';
import { fetchHistoricalDeals } from '@/lib/metaapi';
import { reconcileManualDuplicates } from '@/lib/trades/reconcile';
import { recomputeAccountAggregates } from '@/lib/accounts/aggregate';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  // Atomic claim: only set syncing if not already syncing
  const claimed = await db
    .update(tradingAccounts)
    .set({ syncStatus: 'syncing' })
    .where(and(
      eq(tradingAccounts.id, id),
      eq(tradingAccounts.userId, session.user.id),
      ne(tradingAccounts.syncStatus, 'syncing')
    ))
    .returning({ id: tradingAccounts.id });

  if (claimed.length === 0) {
    // Either account doesn't exist, wrong user, or already syncing
    const account = await db.query.tradingAccounts.findFirst({
      where: and(eq(tradingAccounts.id, id), eq(tradingAccounts.userId, session.user.id)),
    });
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    return NextResponse.json({ error: 'Sync already in progress' }, { status: 409 });
  }

  const account = await db.query.tradingAccounts.findFirst({
    where: eq(tradingAccounts.id, id),
  });

  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  try {
    const endDate = new Date();
    const startDate = account.lastSyncAt ? new Date(account.lastSyncAt) : new Date(Date.now() - 2 * 365 * 86400000);

    const deals = await fetchHistoricalDeals(account.metaApiId, startDate, endDate);

    if (deals && Array.isArray(deals)) {
      const sortedDeals = [...deals].sort(
        (a: { time: string }, b: { time: string }) => new Date(a.time).getTime() - new Date(b.time).getTime()
      );

      for (const deal of sortedDeals) {
        const dealTime = new Date(deal.time);

        // Deposits/withdrawals become balance_ops rows, so individual
        // transactions can be excluded from the derived balance curve.
        if (deal.type === 'DEAL_TYPE_BALANCE') {
          const amount = deal.profit || 0;
          await db
            .insert(balanceOps)
            .values({
              accountId: id,
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

        const ticket = String(deal.positionId || deal.orderId || deal.id);

        const isOpenDeal = deal.entryType === 'DEAL_ENTRY_IN';
        const isCloseDeal = deal.entryType === 'DEAL_ENTRY_OUT';
        const isInOut = deal.entryType === 'DEAL_ENTRY_INOUT';

        if (isOpenDeal) {
          await db
            .insert(trades)
            .values({
              accountId: id, ticket, symbol: deal.symbol,
              direction: deal.type === 'DEAL_TYPE_BUY' ? 'BUY' : 'SELL',
              lots: deal.volume || 0, entryPrice: deal.price || 0,
              closePrice: null, openTime: dealTime, closeTime: null,
              profit: 0, pips: null, commission: deal.commission || 0, swap: 0,
              isOpen: true, magicNumber: deal.magic || null, comment: deal.comment || null,
            })
            .onConflictDoUpdate({
              target: [trades.accountId, trades.ticket],
              // source: broker confirmation converts a backfilled manual row to live
              set: { entryPrice: deal.price || 0, lots: deal.volume || 0, openTime: dealTime, commission: deal.commission || 0, source: 'live' },
            });
        } else if (isCloseDeal || isInOut) {
          // Close the existing position
          const existingTrade = await db.query.trades.findFirst({
            where: and(eq(trades.accountId, id), eq(trades.ticket, ticket)),
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
              .where(and(eq(trades.accountId, id), eq(trades.ticket, ticket)));
          } else {
            // No matching open trade — insert as completed, invert direction
            await db
              .insert(trades)
              .values({
                accountId: id, ticket, symbol: deal.symbol,
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
              .where(and(eq(trades.accountId, id), eq(trades.ticket, ticket)));
          }
        } else {
          // Fallback for unknown entry types
          await db
            .insert(trades)
            .values({
              accountId: id, ticket, symbol: deal.symbol,
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

    // Backfill handoff: the upserts above only merge manual rows whose tickets
    // match the broker's. Sweep the rest — manual rows duplicating a live row
    // on symbol/direction/lots/open-time — so pooled history stays clean.
    const manualReconciled = await reconcileManualDuplicates(id);

    // Snapshots + stats rebuild from trades and balance_ops, honoring
    // exclusions — same authority every write path uses.
    const agg = await recomputeAccountAggregates(id);

    await db
      .update(tradingAccounts)
      .set({ syncStatus: 'synced', lastSyncAt: new Date(), syncError: null })
      .where(eq(tradingAccounts.id, id));

    return NextResponse.json({ success: true, tradesImported: agg.closedTrades, manualReconciled });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Sync failed';
    console.error(`Sync error for account ${id}:`, message);

    await db
      .update(tradingAccounts)
      .set({ syncStatus: 'error', syncError: message })
      .where(eq(tradingAccounts.id, id));

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
