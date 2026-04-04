import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { tradingAccounts, trades, dailySnapshots, accountStats } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
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

  const account = await db.query.tradingAccounts.findFirst({
    where: and(eq(tradingAccounts.id, id), eq(tradingAccounts.userId, session.user.id)),
  });

  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  // Update sync status
  await db
    .update(tradingAccounts)
    .set({ syncStatus: 'syncing' })
    .where(eq(tradingAccounts.id, id));

  try {
    // Fetch deals from MetaApi (last 2 years)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 2);

    const deals = await fetchHistoricalDeals(account.metaApiId, startDate, endDate);

    // Map deals to trades and upsert
    if (deals && Array.isArray(deals)) {
      for (const deal of deals) {
        if (deal.type === 'DEAL_TYPE_BALANCE') continue;

        const tradeData = {
          accountId: id,
          ticket: String(deal.id || deal.orderId),
          symbol: deal.symbol || 'UNKNOWN',
          direction: deal.type === 'DEAL_TYPE_BUY' ? 'BUY' : 'SELL',
          lots: deal.volume || 0,
          entryPrice: deal.price || 0,
          closePrice: deal.price || null,
          openTime: new Date(deal.time),
          closeTime: deal.type === 'DEAL_TYPE_BUY' || deal.type === 'DEAL_TYPE_SELL' ? null : new Date(deal.time),
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
            set: {
              profit: tradeData.profit,
              closePrice: tradeData.closePrice,
              closeTime: tradeData.closeTime,
              commission: tradeData.commission,
              swap: tradeData.swap,
              pips: tradeData.pips,
            },
          });
      }
    }

    // Aggregate daily snapshots
    const allTrades = await db.query.trades.findMany({
      where: eq(trades.accountId, id),
    });

    const closedTrades = allTrades.filter((t) => t.closeTime && !t.isOpen);
    const dailyMap = new Map<string, typeof closedTrades>();

    for (const trade of closedTrades) {
      const dateKey = format(trade.closeTime!, 'yyyy-MM-dd');
      if (!dailyMap.has(dateKey)) dailyMap.set(dateKey, []);
      dailyMap.get(dateKey)!.push(trade);
    }

    let runningBalance = 0;
    const sortedDates = [...dailyMap.keys()].sort();

    for (const dateKey of sortedDates) {
      const dayTrades = dailyMap.get(dateKey)!;
      const dayPnl = dayTrades.reduce((sum, t) => sum + t.profit, 0);
      const dayWins = dayTrades.filter((t) => t.profit > 0).length;
      const dayLosses = dayTrades.filter((t) => t.profit < 0).length;
      const dayVolume = dayTrades.reduce((sum, t) => sum + t.lots, 0);
      const dayPips = dayTrades.reduce((sum, t) => sum + (t.pips || 0), 0);
      const dayCommission = dayTrades.reduce((sum, t) => sum + t.commission, 0);
      const daySwap = dayTrades.reduce((sum, t) => sum + t.swap, 0);
      runningBalance += dayPnl;

      await db
        .insert(dailySnapshots)
        .values({
          accountId: id,
          date: dateKey,
          balance: runningBalance,
          equity: runningBalance,
          pnl: dayPnl,
          tradeCount: dayTrades.length,
          winCount: dayWins,
          lossCount: dayLosses,
          volume: dayVolume,
          pips: dayPips,
          commission: dayCommission,
          swap: daySwap,
        })
        .onConflictDoUpdate({
          target: [dailySnapshots.accountId, dailySnapshots.date],
          set: {
            balance: runningBalance,
            equity: runningBalance,
            pnl: dayPnl,
            tradeCount: dayTrades.length,
            winCount: dayWins,
            lossCount: dayLosses,
            volume: dayVolume,
            pips: dayPips,
            commission: dayCommission,
            swap: daySwap,
          },
        });
    }

    // Calculate and store account stats
    const stats = calculateAccountStats(
      allTrades.map((t) => ({
        profit: t.profit,
        pips: t.pips,
        lots: t.lots,
        commission: t.commission,
        swap: t.swap,
        openTime: t.openTime,
        closeTime: t.closeTime,
        isOpen: t.isOpen,
      }))
    );

    await db
      .insert(accountStats)
      .values({
        accountId: id,
        balance: runningBalance,
        equity: runningBalance,
        ...stats,
        lastCalculatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: accountStats.accountId,
        set: {
          balance: runningBalance,
          equity: runningBalance,
          ...stats,
          lastCalculatedAt: new Date(),
        },
      });

    // Update sync status
    await db
      .update(tradingAccounts)
      .set({ syncStatus: 'synced', lastSyncAt: new Date(), syncError: null })
      .where(eq(tradingAccounts.id, id));

    return NextResponse.json({ success: true, tradesImported: closedTrades.length });
  } catch (error: unknown) {
    console.error('Sync error:', error);
    const message = error instanceof Error ? error.message : 'Sync failed';

    await db
      .update(tradingAccounts)
      .set({ syncStatus: 'error', syncError: message })
      .where(eq(tradingAccounts.id, id));

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
