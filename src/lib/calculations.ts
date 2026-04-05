import { format, getDay, getHours } from 'date-fns';

// ─── Pip Calculations ────────────────────────────────

const JPY_PAIRS = ['USDJPY', 'EURJPY', 'GBPJPY', 'AUDJPY', 'NZDJPY', 'CADJPY', 'CHFJPY'];

export function getPipMultiplier(symbol: string): number {
  const upper = symbol.toUpperCase();
  if (JPY_PAIRS.some((p) => upper.includes(p.replace('/', '')))) return 100;
  return 10000;
}

export function calculatePips(
  symbol: string,
  direction: string,
  entryPrice: number,
  closePrice: number
): number {
  const multiplier = getPipMultiplier(symbol);
  const diff = direction === 'BUY' ? closePrice - entryPrice : entryPrice - closePrice;
  return Math.round(diff * multiplier * 10) / 10;
}

// ─── Trade Data Interface ────────────────────────────

interface TradeData {
  profit: number;
  pips: number | null;
  lots: number;
  commission: number;
  swap: number;
  openTime: Date;
  closeTime: Date | null;
  isOpen: boolean;
  symbol?: string;
  direction?: string;
  entryPrice?: number;
  closePrice?: number | null;
}

// ─── Account Stats ───────────────────────────────────

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

  const winRate = (winners.length / closedTrades.length) * 100;
  const lossRate = (losers.length / closedTrades.length) * 100;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;

  const averageWin = winners.length > 0 ? grossProfit / winners.length : 0;
  const averageLoss = losers.length > 0 ? grossLoss / losers.length : 0;
  const averageTrade = totalProfit / closedTrades.length;
  const expectancy = (winRate / 100) * averageWin - (lossRate / 100) * averageLoss;
  const riskRewardRatio = averageLoss > 0 ? averageWin / averageLoss : 0;

  // Drawdown
  const sortedTrades = [...closedTrades].sort(
    (a, b) => (a.closeTime?.getTime() || 0) - (b.closeTime?.getTime() || 0)
  );

  let peak = 0;
  let maxDrawdownAbs = 0;
  let maxDrawdownPct = 0;
  let runningPnl = 0;

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
  const avgTradeDuration =
    durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

  // Pips — compute from price if not provided
  const tradesWithPips = closedTrades.map((t) => {
    if (t.pips != null) return t.pips;
    if (t.symbol && t.direction && t.entryPrice && t.closePrice) {
      return calculatePips(t.symbol, t.direction, t.entryPrice, t.closePrice);
    }
    return 0;
  });
  const totalPips = tradesWithPips.reduce((sum, p) => sum + p, 0);
  const avgPipsPerTrade = tradesWithPips.length > 0 ? totalPips / tradesWithPips.length : 0;
  const bestTradePips = tradesWithPips.length > 0 ? Math.max(...tradesWithPips) : 0;
  const worstTradePips = tradesWithPips.length > 0 ? Math.min(...tradesWithPips) : 0;

  // Long/Short win rates
  const longTrades = closedTrades.filter((t) => t.direction === 'BUY');
  const shortTrades = closedTrades.filter((t) => t.direction === 'SELL');
  const longWinRate = longTrades.length > 0
    ? (longTrades.filter((t) => t.profit > 0).length / longTrades.length) * 100
    : 0;
  const shortWinRate = shortTrades.length > 0
    ? (shortTrades.filter((t) => t.profit > 0).length / shortTrades.length) * 100
    : 0;

  // Sharpe / Sortino
  const returns = closedTrades.map((t) => t.profit);
  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - meanReturn) ** 2, 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? meanReturn / stdDev : 0;

  const downsideReturns = returns.filter((r) => r < 0);
  const downsideVariance =
    downsideReturns.length > 0
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
    lossRate,
    profitFactor,
    expectancy,
    averageWin,
    averageLoss,
    averageTrade,
    riskRewardRatio,
    maxDrawdownPct,
    maxDrawdownAbs,
    sharpeRatio,
    sortinoRatio,
    avgTradeDuration,
    bestTrade: Math.max(...closedTrades.map((t) => t.profit)),
    worstTrade: Math.min(...closedTrades.map((t) => t.profit)),
    longestWinStreak,
    longestLossStreak,
    totalLots: closedTrades.reduce((sum, t) => sum + t.lots, 0),
    totalPips,
    avgPipsPerTrade,
    bestTradePips,
    worstTradePips,
    totalCommission: closedTrades.reduce((sum, t) => sum + t.commission, 0),
    totalSwap: closedTrades.reduce((sum, t) => sum + t.swap, 0),
    longWinRate,
    shortWinRate,
  };
}

// ─── Analytics Helpers ───────────────────────────────

interface AnalyticsTrade {
  symbol: string;
  direction: string;
  profit: number;
  pips: number | null;
  entryPrice: number;
  closePrice: number | null;
  closeTime: Date | null;
  openTime: Date;
  lots: number;
}

export function groupBySymbol(trades: AnalyticsTrade[]) {
  const map = new Map<string, { pnl: number; trades: number; wins: number; losses: number; pips: number }>();

  for (const t of trades) {
    if (!t.closeTime) continue;
    const entry = map.get(t.symbol) || { pnl: 0, trades: 0, wins: 0, losses: 0, pips: 0 };
    entry.pnl += t.profit;
    entry.trades++;
    if (t.profit > 0) entry.wins++;
    if (t.profit < 0) entry.losses++;
    entry.pips += t.pips ?? (t.closePrice ? calculatePips(t.symbol, t.direction, t.entryPrice, t.closePrice) : 0);
    map.set(t.symbol, entry);
  }

  return [...map.entries()]
    .map(([symbol, data]) => ({ symbol, ...data }))
    .sort((a, b) => b.pnl - a.pnl);
}

export function groupByDayOfWeek(trades: AnalyticsTrade[]) {
  // 0=Sun, 1=Mon, ..., 5=Fri
  const days: { day: string; pnl: number; count: number; avgPnl: number }[] = [
    { day: 'Mon', pnl: 0, count: 0, avgPnl: 0 },
    { day: 'Tue', pnl: 0, count: 0, avgPnl: 0 },
    { day: 'Wed', pnl: 0, count: 0, avgPnl: 0 },
    { day: 'Thu', pnl: 0, count: 0, avgPnl: 0 },
    { day: 'Fri', pnl: 0, count: 0, avgPnl: 0 },
  ];

  for (const t of trades) {
    if (!t.closeTime) continue;
    const dow = getDay(t.closeTime);
    // Map: 1=Mon→0, 2=Tue→1, ..., 5=Fri→4, 0=Sun skip, 6=Sat skip
    if (dow === 0 || dow === 6) continue;
    const idx = dow - 1;
    days[idx].pnl += t.profit;
    days[idx].count++;
  }

  for (const d of days) {
    d.avgPnl = d.count > 0 ? d.pnl / d.count : 0;
  }

  return days;
}

export function groupByHour(trades: AnalyticsTrade[]) {
  // 24 hours × 5 days grid
  const grid: { hour: number; day: number; dayName: string; pnl: number; count: number }[] = [];

  for (let d = 0; d < 5; d++) {
    for (let h = 0; h < 24; h++) {
      grid.push({
        hour: h,
        day: d,
        dayName: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'][d],
        pnl: 0,
        count: 0,
      });
    }
  }

  for (const t of trades) {
    if (!t.closeTime) continue;
    const dow = getDay(t.closeTime);
    if (dow === 0 || dow === 6) continue;
    const dayIdx = dow - 1;
    const hour = getHours(t.closeTime);
    const cell = grid[dayIdx * 24 + hour];
    cell.pnl += t.profit;
    cell.count++;
  }

  return grid;
}

export function groupByMonth(trades: AnalyticsTrade[], dailySnapshots: { date: string; balance: number }[]) {
  // Build a map of month → { startBalance, endBalance, pnl }
  const monthMap = new Map<string, { pnl: number; trades: number }>();

  for (const t of trades) {
    if (!t.closeTime) continue;
    const key = format(t.closeTime, 'yyyy-MM');
    const entry = monthMap.get(key) || { pnl: 0, trades: 0 };
    entry.pnl += t.profit;
    entry.trades++;
    monthMap.set(key, entry);
  }

  // Build balance timeline from snapshots
  const balanceByMonth = new Map<string, { start: number; end: number }>();
  const sortedSnaps = [...dailySnapshots].sort((a, b) => a.date.localeCompare(b.date));

  for (const snap of sortedSnaps) {
    const key = snap.date.slice(0, 7); // yyyy-MM
    const entry = balanceByMonth.get(key);
    if (!entry) {
      balanceByMonth.set(key, { start: snap.balance, end: snap.balance });
    } else {
      entry.end = snap.balance;
    }
  }

  const result: { year: number; month: number; monthName: string; pnl: number; pctReturn: number; trades: number }[] = [];

  for (const [key, data] of monthMap.entries()) {
    const [yearStr, monthStr] = key.split('-');
    const year = parseInt(yearStr);
    const month = parseInt(monthStr);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const balData = balanceByMonth.get(key);
    const startBal = balData ? balData.start - data.pnl : 0;
    const pctReturn = startBal > 0 ? (data.pnl / startBal) * 100 : 0;

    result.push({
      year,
      month,
      monthName: monthNames[month - 1],
      pnl: data.pnl,
      pctReturn,
      trades: data.trades,
    });
  }

  return result.sort((a, b) => a.year * 100 + a.month - (b.year * 100 + b.month));
}

export function calculateDrawdownSeries(trades: AnalyticsTrade[]) {
  const sorted = [...trades]
    .filter((t) => t.closeTime)
    .sort((a, b) => (a.closeTime?.getTime() || 0) - (b.closeTime?.getTime() || 0));

  let peak = 0;
  let runningPnl = 0;
  let maxDdPoint = { date: '', drawdown: 0, drawdownPct: 0 };

  const series: { date: string; drawdown: number; drawdownPct: number; equity: number }[] = [];

  for (const trade of sorted) {
    runningPnl += trade.profit;
    if (runningPnl > peak) peak = runningPnl;
    const drawdown = peak - runningPnl;
    const drawdownPct = peak > 0 ? (drawdown / peak) * 100 : 0;
    const dateStr = format(trade.closeTime!, 'yyyy-MM-dd');

    series.push({ date: dateStr, drawdown: -drawdown, drawdownPct, equity: runningPnl });

    if (drawdown > Math.abs(maxDdPoint.drawdown)) {
      maxDdPoint = { date: dateStr, drawdown: -drawdown, drawdownPct };
    }
  }

  return { series, maxDrawdownPoint: maxDdPoint };
}

// ─── Default Stats ───────────────────────────────────

function getDefaultStats() {
  return {
    totalPnl: 0, realizedPnl: 0, unrealizedPnl: 0,
    totalTrades: 0, winningTrades: 0, losingTrades: 0,
    winRate: 0, lossRate: 0, profitFactor: 0, expectancy: 0,
    averageWin: 0, averageLoss: 0, averageTrade: 0, riskRewardRatio: 0,
    maxDrawdownPct: 0, maxDrawdownAbs: 0,
    sharpeRatio: 0, sortinoRatio: 0, avgTradeDuration: 0,
    bestTrade: 0, worstTrade: 0,
    longestWinStreak: 0, longestLossStreak: 0,
    totalLots: 0, totalPips: 0, avgPipsPerTrade: 0,
    bestTradePips: 0, worstTradePips: 0,
    totalCommission: 0, totalSwap: 0,
    longWinRate: 0, shortWinRate: 0,
  };
}
