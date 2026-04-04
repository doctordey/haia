import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { tradingAccounts, trades, dailySnapshots, accountStats } from '@/lib/db/schema';
import { eq, and, ne, sql } from 'drizzle-orm';
import { fetchHistoricalDeals } from '@/lib/metaapi';
import { calculateAccountStats } from '@/lib/calculations';
import { format } from 'date-fns';

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

    // Track balance events by date for accurate daily snapshots
    const balanceByDate = new Map<string, number>();

    if (deals && Array.isArray(deals)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sortedDeals = [...deals].sort(
        (a: any, b: any) => new Date(a.time).getTime() - new Date(b.time).getTime()
      );

      for (const deal of sortedDeals) {
        const dealTime = new Date(deal.time);
        const dateKey = format(dealTime, 'yyyy-MM-dd');

        // Track balance operations (deposits/withdrawals) by date
        if (deal.type === 'DEAL_TYPE_BALANCE') {
          balanceByDate.set(dateKey, (balanceByDate.get(dateKey) || 0) + (deal.profit || 0));
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
              set: { entryPrice: deal.price || 0, lots: deal.volume || 0, openTime: dealTime, commission: deal.commission || 0 },
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
                swap: deal.swap || 0, isOpen: false,
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
                },
              });
          }

          // INOUT: also open a new position in the opposite direction
          if (isInOut) {
            const newTicket = `${ticket}_inout_${dealTime.getTime()}`;
            await db
              .insert(trades)
              .values({
                accountId: id, ticket: newTicket, symbol: deal.symbol,
                direction: deal.type === 'DEAL_TYPE_BUY' ? 'BUY' : 'SELL',
                lots: deal.volume || 0, entryPrice: deal.price || 0,
                closePrice: null, openTime: dealTime, closeTime: null,
                profit: 0, pips: null, commission: 0, swap: 0,
                isOpen: true, magicNumber: deal.magic || null, comment: deal.comment || null,
              })
              .onConflictDoNothing();
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
              },
            });
        }
      }
    }

    // Aggregate daily snapshots
    const allTrades = await db.query.trades.findMany({ where: eq(trades.accountId, id) });
    const closedTrades = allTrades.filter((t) => t.closeTime && !t.isOpen);
    const dailyMap = new Map<string, typeof closedTrades>();

    for (const trade of closedTrades) {
      const dateKey = format(trade.closeTime!, 'yyyy-MM-dd');
      if (!dailyMap.has(dateKey)) dailyMap.set(dateKey, []);
      dailyMap.get(dateKey)!.push(trade);
    }

    // Collect all dates that have either trades or balance events
    const allDates = new Set([...dailyMap.keys(), ...balanceByDate.keys()]);
    let runningBalance = 0;

    for (const dateKey of [...allDates].sort()) {
      // Apply balance deposits/withdrawals for this date
      const balanceChange = balanceByDate.get(dateKey) || 0;
      runningBalance += balanceChange;

      // Apply trade PNL for this date
      const dayTrades = dailyMap.get(dateKey) || [];
      const dayPnl = dayTrades.reduce((sum, t) => sum + t.profit, 0);
      runningBalance += dayPnl;

      await db
        .insert(dailySnapshots)
        .values({
          accountId: id, date: dateKey, balance: runningBalance, equity: runningBalance,
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

    // Calculate and store account stats
    const stats = calculateAccountStats(
      allTrades.map((t) => ({
        profit: t.profit, pips: t.pips, lots: t.lots, commission: t.commission,
        swap: t.swap, openTime: t.openTime, closeTime: t.closeTime, isOpen: t.isOpen,
        symbol: t.symbol, direction: t.direction, entryPrice: t.entryPrice, closePrice: t.closePrice,
      }))
    );

    await db
      .insert(accountStats)
      .values({ accountId: id, balance: runningBalance, equity: runningBalance, ...stats, lastCalculatedAt: new Date() })
      .onConflictDoUpdate({
        target: accountStats.accountId,
        set: { balance: runningBalance, equity: runningBalance, ...stats, lastCalculatedAt: new Date() },
      });

    await db
      .update(tradingAccounts)
      .set({ syncStatus: 'synced', lastSyncAt: new Date(), syncError: null })
      .where(eq(tradingAccounts.id, id));

    return NextResponse.json({ success: true, tradesImported: closedTrades.length });
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
