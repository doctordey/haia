import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { tradingAccounts, accountStats, trades } from '@/lib/db/schema';
import { eq, and, sql, gte, lte, isNotNull } from 'drizzle-orm';
import { subDays, subMonths, subYears } from 'date-fns';
import { calculatePips } from '@/lib/calculations';

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
  const period = searchParams.get('period');
  const customFrom = searchParams.get('from');
  const customTo = searchParams.get('to');

  const account = await db.query.tradingAccounts.findFirst({
    where: and(eq(tradingAccounts.id, accountId), eq(tradingAccounts.userId, session.user.id)),
  });

  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  // Determine date range
  let startDate: Date | null = null;
  let endDate: Date | null = null;
  const now = new Date();

  if (customFrom) {
    startDate = new Date(customFrom);
    endDate = customTo ? new Date(customTo + 'T23:59:59.999Z') : null;
  } else if (period && period !== 'MAX') {
    switch (period) {
      case '1D': startDate = subDays(now, 1); break;
      case '7D': startDate = subDays(now, 7); break;
      case '30D': startDate = subDays(now, 30); break;
      case '90D': startDate = subMonths(now, 3); break;
      case '1Y': startDate = subYears(now, 1); break;
    }
  }

  // If no period filter, return all-time stats from accountStats table
  if (!startDate) {
    const stats = await db.query.accountStats.findFirst({
      where: eq(accountStats.accountId, accountId),
    });

    const openCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(trades)
      .where(and(eq(trades.accountId, accountId), eq(trades.isOpen, true)));
    const openTradesCount = Number(openCountResult[0]?.count || 0);

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

  // Period-filtered: compute stats from trades within the date range
  const conditions = [
    eq(trades.accountId, accountId),
    eq(trades.isOpen, false),
    isNotNull(trades.closeTime),
    gte(trades.closeTime, startDate),
  ];
  if (endDate) {
    conditions.push(lte(trades.closeTime, endDate));
  }

  const filteredTrades = await db.query.trades.findMany({
    where: and(...conditions),
  });

  const totalTrades = filteredTrades.length;
  const winningTrades = filteredTrades.filter((t) => t.profit > 0).length;
  const losingTrades = filteredTrades.filter((t) => t.profit < 0).length;
  const totalPnl = filteredTrades.reduce((sum, t) => sum + t.profit, 0);

  // Calculate pips from prices since MetaAPI doesn't return pips on deals
  const tradePips = filteredTrades.map((t) => {
    if (t.pips != null) return t.pips;
    if (t.symbol && t.direction && t.entryPrice && t.closePrice) {
      return calculatePips(t.symbol, t.direction, t.entryPrice, t.closePrice);
    }
    return 0;
  });
  const totalPips = tradePips.reduce((sum, p) => sum + p, 0);
  const totalLots = filteredTrades.reduce((sum, t) => sum + t.lots, 0);
  const totalCommission = filteredTrades.reduce((sum, t) => sum + t.commission, 0);
  const totalSwap = filteredTrades.reduce((sum, t) => sum + t.swap, 0);

  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

  const wins = filteredTrades.filter((t) => t.profit > 0);
  const losses = filteredTrades.filter((t) => t.profit < 0);
  const grossProfit = wins.reduce((sum, t) => sum + t.profit, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.profit, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const averageWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const averageLoss = losses.length > 0 ? grossLoss / losses.length : 0;

  const bestTrade = totalTrades > 0 ? Math.max(...filteredTrades.map((t) => t.profit)) : 0;
  const worstTrade = totalTrades > 0 ? Math.min(...filteredTrades.map((t) => t.profit)) : 0;
  const bestTradePips = tradePips.length > 0 ? Math.max(...tradePips) : 0;
  const avgPipsPerTrade = tradePips.length > 0 ? totalPips / tradePips.length : 0;

  // Streaks
  let longestWinStreak = 0, longestLossStreak = 0, curWin = 0, curLoss = 0;
  const sorted = [...filteredTrades].sort((a, b) => (a.closeTime!.getTime() - b.closeTime!.getTime()));
  for (const t of sorted) {
    if (t.profit > 0) { curWin++; curLoss = 0; longestWinStreak = Math.max(longestWinStreak, curWin); }
    else if (t.profit < 0) { curLoss++; curWin = 0; longestLossStreak = Math.max(longestLossStreak, curLoss); }
    else { curWin = 0; curLoss = 0; }
  }

  // Avg trade duration
  let totalDuration = 0;
  let durationCount = 0;
  for (const t of filteredTrades) {
    if (t.closeTime && t.openTime) {
      totalDuration += t.closeTime.getTime() - t.openTime.getTime();
      durationCount++;
    }
  }
  const avgTradeDuration = durationCount > 0 ? Math.round(totalDuration / durationCount / 1000) : 0;

  // Sharpe ratio (daily returns)
  const dailyPnlMap = new Map<string, number>();
  for (const t of filteredTrades) {
    if (t.closeTime) {
      const day = t.closeTime.toISOString().slice(0, 10);
      dailyPnlMap.set(day, (dailyPnlMap.get(day) || 0) + t.profit);
    }
  }
  const dailyReturns = Array.from(dailyPnlMap.values());
  const meanReturn = dailyReturns.length > 0 ? dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length : 0;
  const variance = dailyReturns.length > 1
    ? dailyReturns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / (dailyReturns.length - 1)
    : 0;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(252) : 0;

  // Balance / pnlPercent — use current account stats for balance context
  const currentStats = await db.query.accountStats.findFirst({
    where: eq(accountStats.accountId, accountId),
  });
  const balance = currentStats?.balance || 0;
  const equity = currentStats?.equity || 0;
  const periodStartBalance = balance - totalPnl;
  const pnlPercent = periodStartBalance > 0 ? (totalPnl / periodStartBalance) * 100 : 0;

  return NextResponse.json({
    balance,
    equity,
    totalPnl,
    pnlPercent,
    winRate,
    winningTrades,
    losingTrades,
    openTradesCount: 0,
    unrealizedPnl: currentStats?.unrealizedPnl || 0,
    profitFactor: profitFactor === Infinity ? 999 : profitFactor,
    totalTrades,
    realizedPnl: totalPnl,
    bestTrade,
    worstTrade,
    avgTradeDuration,
    longestWinStreak,
    longestLossStreak,
    maxDrawdownPct: 0,
    maxDrawdownAbs: 0,
    sharpeRatio: isFinite(sharpeRatio) ? Math.round(sharpeRatio * 100) / 100 : 0,
    totalLots,
    totalCommission,
    totalSwap,
    totalPips,
    avgPipsPerTrade: Math.round(avgPipsPerTrade * 100) / 100,
    bestTradePips,
    averageWin: Math.round(averageWin * 100) / 100,
    averageLoss: Math.round(averageLoss * 100) / 100,
  });
}
