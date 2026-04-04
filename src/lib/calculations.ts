interface TradeData {
  profit: number;
  pips: number | null;
  lots: number;
  commission: number;
  swap: number;
  openTime: Date;
  closeTime: Date | null;
  isOpen: boolean;
}

export function calculateAccountStats(trades: TradeData[]) {
  const closedTrades = trades.filter((t) => !t.isOpen && t.closeTime);
  const openTrades = trades.filter((t) => t.isOpen);

  if (closedTrades.length === 0) {
    return getDefaultStats();
  }

  const winners = closedTrades.filter((t) => t.profit > 0);
  const losers = closedTrades.filter((t) => t.profit < 0);

  const totalProfit = closedTrades.reduce((sum, t) => sum + t.profit, 0);
  const grossProfit = winners.reduce((sum, t) => sum + t.profit, 0);
  const grossLoss = Math.abs(losers.reduce((sum, t) => sum + t.profit, 0));
  const unrealizedPnl = openTrades.reduce((sum, t) => sum + t.profit, 0);

  const winRate = closedTrades.length > 0 ? (winners.length / closedTrades.length) * 100 : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  const averageWin = winners.length > 0 ? grossProfit / winners.length : 0;
  const averageLoss = losers.length > 0 ? grossLoss / losers.length : 0;
  const expectancy = (winRate / 100) * averageWin - ((100 - winRate) / 100) * averageLoss;
  const riskRewardRatio = averageLoss > 0 ? averageWin / averageLoss : 0;

  // Drawdown calculation
  let peak = 0;
  let maxDrawdownAbs = 0;
  let maxDrawdownPct = 0;
  let runningPnl = 0;

  const sortedTrades = [...closedTrades].sort(
    (a, b) => (a.closeTime?.getTime() || 0) - (b.closeTime?.getTime() || 0)
  );

  for (const trade of sortedTrades) {
    runningPnl += trade.profit;
    if (runningPnl > peak) peak = runningPnl;
    const drawdown = peak - runningPnl;
    if (drawdown > maxDrawdownAbs) {
      maxDrawdownAbs = drawdown;
      maxDrawdownPct = peak > 0 ? (drawdown / peak) * 100 : 0;
    }
  }

  // Streaks
  let currentStreak = 0;
  let longestWinStreak = 0;
  let longestLossStreak = 0;
  let currentWinStreak = 0;
  let currentLossStreak = 0;

  for (const trade of sortedTrades) {
    if (trade.profit > 0) {
      currentWinStreak++;
      currentLossStreak = 0;
      longestWinStreak = Math.max(longestWinStreak, currentWinStreak);
    } else if (trade.profit < 0) {
      currentLossStreak++;
      currentWinStreak = 0;
      longestLossStreak = Math.max(longestLossStreak, currentLossStreak);
    }
  }

  // Duration
  const durations = closedTrades
    .filter((t) => t.closeTime)
    .map((t) => (t.closeTime!.getTime() - t.openTime.getTime()) / 60000);
  const avgTradeDuration = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

  // Pips
  const tradeWithPips = closedTrades.filter((t) => t.pips != null);
  const totalPips = tradeWithPips.reduce((sum, t) => sum + (t.pips || 0), 0);
  const avgPipsPerTrade = tradeWithPips.length > 0 ? totalPips / tradeWithPips.length : 0;
  const bestTradePips = tradeWithPips.length > 0 ? Math.max(...tradeWithPips.map((t) => t.pips || 0)) : 0;
  const worstTradePips = tradeWithPips.length > 0 ? Math.min(...tradeWithPips.map((t) => t.pips || 0)) : 0;

  // Returns for Sharpe/Sortino
  const returns = closedTrades.map((t) => t.profit);
  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - meanReturn) ** 2, 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? meanReturn / stdDev : 0;

  const downsideReturns = returns.filter((r) => r < 0);
  const downsideVariance = downsideReturns.length > 0
    ? downsideReturns.reduce((sum, r) => sum + r ** 2, 0) / downsideReturns.length
    : 0;
  const downsideDev = Math.sqrt(downsideVariance);
  const sortinoRatio = downsideDev > 0 ? meanReturn / downsideDev : 0;

  return {
    totalPnl: totalProfit,
    realizedPnl: totalProfit,
    unrealizedPnl,
    totalTrades: closedTrades.length,
    winningTrades: winners.length,
    losingTrades: losers.length,
    winRate,
    profitFactor: profitFactor === Infinity ? 999 : profitFactor,
    expectancy,
    averageWin,
    averageLoss,
    riskRewardRatio,
    maxDrawdownPct,
    maxDrawdownAbs,
    sharpeRatio,
    sortinoRatio,
    avgTradeDuration,
    bestTrade: closedTrades.length > 0 ? Math.max(...closedTrades.map((t) => t.profit)) : 0,
    worstTrade: closedTrades.length > 0 ? Math.min(...closedTrades.map((t) => t.profit)) : 0,
    longestWinStreak,
    longestLossStreak,
    totalLots: closedTrades.reduce((sum, t) => sum + t.lots, 0),
    totalPips,
    avgPipsPerTrade,
    bestTradePips,
    worstTradePips,
    totalCommission: closedTrades.reduce((sum, t) => sum + t.commission, 0),
    totalSwap: closedTrades.reduce((sum, t) => sum + t.swap, 0),
  };
}

function getDefaultStats() {
  return {
    totalPnl: 0, realizedPnl: 0, unrealizedPnl: 0,
    totalTrades: 0, winningTrades: 0, losingTrades: 0,
    winRate: 0, profitFactor: 0, expectancy: 0,
    averageWin: 0, averageLoss: 0, riskRewardRatio: 0,
    maxDrawdownPct: 0, maxDrawdownAbs: 0,
    sharpeRatio: 0, sortinoRatio: 0, avgTradeDuration: 0,
    bestTrade: 0, worstTrade: 0,
    longestWinStreak: 0, longestLossStreak: 0,
    totalLots: 0, totalPips: 0, avgPipsPerTrade: 0,
    bestTradePips: 0, worstTradePips: 0,
    totalCommission: 0, totalSwap: 0,
  };
}
