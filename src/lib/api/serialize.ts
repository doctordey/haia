import type { tradingAccounts, accountStats, trades } from '@/lib/db/schema';

type AccountRow = typeof tradingAccounts.$inferSelect;
type StatsRow = typeof accountStats.$inferSelect;
type TradeRow = typeof trades.$inferSelect;

/**
 * Shape a trading account for the public distribute endpoints, applying the
 * operator's label overrides to the identifying fields. Consumers see the
 * override when set, otherwise the real value. The underlying broker
 * credentials (metaApiId, raw login) are never exposed here.
 */
export function exposeAccount(acc: AccountRow, stats?: StatsRow | null) {
  const accountType = acc.labelType ?? acc.accountType ?? null;
  return {
    id: acc.id,
    name: acc.labelName ?? acc.name,
    accountNumber: acc.labelLogin ?? acc.login,
    accountType,                                    // "live" | "demo" | null
    isDemo: accountType ? accountType === 'demo' : null,
    platform: acc.platform,
    server: acc.server,
    broker: acc.broker,
    leverage: acc.leverage,
    currency: acc.currency,
    distinguishManual: acc.distinguishManual,
    isActive: acc.isActive,
    syncStatus: acc.syncStatus,
    lastSyncAt: acc.lastSyncAt,
    createdAt: acc.createdAt,
    // Whether any identifying field is currently pseudonymized.
    labeled: Boolean(acc.labelName || acc.labelLogin || acc.labelType),
    stats: stats
      ? {
          balance: stats.balance,
          equity: stats.equity,
          totalPnl: stats.totalPnl,
          realizedPnl: stats.realizedPnl,
          unrealizedPnl: stats.unrealizedPnl,
          totalTrades: stats.totalTrades,
          winRate: stats.winRate,
          profitFactor: stats.profitFactor,
          maxDrawdownPct: stats.maxDrawdownPct,
          lastCalculatedAt: stats.lastCalculatedAt,
        }
      : null,
  };
}

/** Public trade shape — drops the manual `source` field when distinction is off. */
export function exposeTrade(t: TradeRow, distinguishManual: boolean) {
  return {
    id: t.id,
    ticket: t.ticket,
    symbol: t.symbol,
    direction: t.direction,
    lots: t.lots,
    entryPrice: t.entryPrice,
    closePrice: t.closePrice,
    stopLoss: t.stopLoss,
    takeProfit: t.takeProfit,
    openTime: t.openTime,
    closeTime: t.closeTime,
    profit: t.profit,
    pips: t.pips,
    commission: t.commission,
    swap: t.swap,
    isOpen: t.isOpen,
    magicNumber: t.magicNumber,
    comment: t.comment,
    ...(distinguishManual ? { source: t.source } : {}),
  };
}
