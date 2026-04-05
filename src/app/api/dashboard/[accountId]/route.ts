import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { tradingAccounts, accountStats, trades } from '@/lib/db/schema';
import { eq, and, sql, gte } from 'drizzle-orm';
import { subDays, subYears } from 'date-fns';
import { calculateAccountStats } from '@/lib/calculations';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { accountId } = await params;
  const { searchParams } = new URL(request.url);
  const period = searchParams.get('period') || 'MAX';
  const dateFrom = searchParams.get('dateFrom');
  const dateTo = searchParams.get('dateTo');

  const account = await db.query.tradingAccounts.findFirst({
    where: and(eq(tradingAccounts.id, accountId), eq(tradingAccounts.userId, session.user.id)),
  });

  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  const openCountResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(trades)
    .where(and(eq(trades.accountId, accountId), eq(trades.isOpen, true)));
  const openTradesCount = Number(openCountResult[0]?.count || 0);

  // For MAX period (no filter), use pre-computed accountStats for speed
  if (period === 'MAX' && !dateFrom) {
    const stats = await db.query.accountStats.findFirst({
      where: eq(accountStats.accountId, accountId),
    });

    const startBalance = (stats?.balance || 0) - (stats?.totalPnl || 0);

    return NextResponse.json({
      balance: stats?.balance || 0,
      equity: stats?.equity || 0,
      totalPnl: stats?.totalPnl || 0,
      pnlPercent: startBalance > 0 ? ((stats?.totalPnl || 0) / startBalance) * 100 : 0,
      winRate: stats?.winRate || 0,
      winningTrades: stats?.winningTrades || 0,
      losingTrades: stats?.losingTrades || 0,
      openTradesCount,
      unrealizedPnl: stats?.unrealizedPnl || 0,
      profitFactor: stats?.profitFactor || 0,
      totalTrades: stats?.totalTrades || 0,
      realizedPnl: stats?.realizedPnl || 0,
      bestTrade: stats?.bestTrade || 0,
      worstTrade: stats?.worstTrade || 0,
      avgTradeDuration: stats?.avgTradeDuration || 0,
      longestWinStreak: stats?.longestWinStreak || 0,
      longestLossStreak: stats?.longestLossStreak || 0,
      maxDrawdownPct: stats?.maxDrawdownPct || 0,
      maxDrawdownAbs: stats?.maxDrawdownAbs || 0,
      sharpeRatio: stats?.sharpeRatio || 0,
      totalLots: stats?.totalLots || 0,
      totalCommission: stats?.totalCommission || 0,
      totalSwap: stats?.totalSwap || 0,
      totalPips: stats?.totalPips || 0,
      avgPipsPerTrade: stats?.avgPipsPerTrade || 0,
      bestTradePips: stats?.bestTradePips || 0,
      averageWin: stats?.averageWin || 0,
      averageLoss: stats?.averageLoss || 0,
    });
  }

  // Period-filtered: compute stats from trades table directly
  const now = new Date();
  let cutoffDate: Date | null = null;

  if (dateFrom) {
    cutoffDate = new Date(dateFrom);
  } else {
    switch (period) {
      case '1D': cutoffDate = subDays(now, 1); break;
      case '7D': cutoffDate = subDays(now, 7); break;
      case '30D': cutoffDate = subDays(now, 30); break;
      case '90D': cutoffDate = subDays(now, 90); break;
      case '1Y': cutoffDate = subYears(now, 1); break;
    }
  }

  const conditions = [eq(trades.accountId, accountId)];
  if (cutoffDate) {
    conditions.push(gte(trades.closeTime, cutoffDate));
  }

  const periodTrades = await db.query.trades.findMany({
    where: and(...conditions),
  });

  const stats = calculateAccountStats(
    periodTrades.map((t) => ({
      profit: t.profit, pips: t.pips, lots: t.lots, commission: t.commission,
      swap: t.swap, openTime: t.openTime, closeTime: t.closeTime, isOpen: t.isOpen,
      symbol: t.symbol, direction: t.direction, entryPrice: t.entryPrice, closePrice: t.closePrice,
    }))
  );

  // Get live balance from accountStats (not period-dependent)
  const liveStats = await db.query.accountStats.findFirst({
    where: eq(accountStats.accountId, accountId),
  });
  const balance = liveStats?.balance || 0;
  const startBalance = balance - stats.totalPnl;

  return NextResponse.json({
    balance,
    equity: liveStats?.equity || 0,
    totalPnl: stats.totalPnl,
    pnlPercent: startBalance > 0 ? (stats.totalPnl / startBalance) * 100 : 0,
    winRate: stats.winRate,
    winningTrades: stats.winningTrades,
    losingTrades: stats.losingTrades,
    openTradesCount,
    unrealizedPnl: stats.unrealizedPnl,
    profitFactor: stats.profitFactor,
    totalTrades: stats.totalTrades,
    realizedPnl: stats.realizedPnl,
    bestTrade: stats.bestTrade,
    worstTrade: stats.worstTrade,
    avgTradeDuration: stats.avgTradeDuration,
    longestWinStreak: stats.longestWinStreak,
    longestLossStreak: stats.longestLossStreak,
    maxDrawdownPct: stats.maxDrawdownPct,
    maxDrawdownAbs: stats.maxDrawdownAbs,
    sharpeRatio: stats.sharpeRatio,
    totalLots: stats.totalLots,
    totalCommission: stats.totalCommission,
    totalSwap: stats.totalSwap,
    totalPips: stats.totalPips,
    avgPipsPerTrade: stats.avgPipsPerTrade,
    bestTradePips: stats.bestTradePips,
    averageWin: stats.averageWin,
    averageLoss: stats.averageLoss,
  });
}
