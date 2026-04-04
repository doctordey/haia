import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { tradingAccounts, accountStats, trades } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { accountId } = await params;

  const account = await db.query.tradingAccounts.findFirst({
    where: and(eq(tradingAccounts.id, accountId), eq(tradingAccounts.userId, session.user.id)),
  });

  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

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
