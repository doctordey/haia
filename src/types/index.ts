export type Platform = 'MT4' | 'MT5';
export type Direction = 'BUY' | 'SELL';
export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'error';

export interface Trade {
  id: string;
  accountId: string;
  ticket: string;
  symbol: string;
  direction: Direction;
  lots: number;
  entryPrice: number;
  closePrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  openTime: Date;
  closeTime: Date | null;
  profit: number;
  pips: number | null;
  commission: number;
  swap: number;
  isOpen: boolean;
  magicNumber: number | null;
  comment: string | null;
}

export interface DailySnapshot {
  id: string;
  accountId: string;
  date: string;
  balance: number;
  equity: number;
  pnl: number;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  volume: number;
  pips: number;
  commission: number;
  swap: number;
}

export interface AccountStatsData {
  balance: number;
  equity: number;
  totalPnl: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  expectancy: number;
  averageWin: number;
  averageLoss: number;
  riskRewardRatio: number;
  maxDrawdownPct: number;
  maxDrawdownAbs: number;
  sharpeRatio: number;
  sortinoRatio: number;
  avgTradeDuration: number;
  bestTrade: number;
  worstTrade: number;
  longestWinStreak: number;
  longestLossStreak: number;
  totalLots: number;
  totalPips: number;
  avgPipsPerTrade: number;
  bestTradePips: number;
  worstTradePips: number;
  totalCommission: number;
  totalSwap: number;
}

export interface TradingAccount {
  id: string;
  userId: string;
  name: string;
  platform: Platform;
  metaApiId: string;
  server: string;
  login: string;
  broker: string | null;
  leverage: number | null;
  currency: string;
  isActive: boolean;
  lastSyncAt: Date | null;
  syncStatus: SyncStatus;
  syncError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EquityPoint {
  date: string;
  equity: number;
  balance: number;
}

export interface DashboardData {
  balance: number;
  equity: number;
  totalPnl: number;
  pnlPercent: number;
  winRate: number;
  winningTrades: number;
  losingTrades: number;
  openTradesCount: number;
  unrealizedPnl: number;
}
