import type { tradingAccounts, accountStats, trades } from '@/lib/db/schema';

type AccountRow = typeof tradingAccounts.$inferSelect;
type StatsRow = typeof accountStats.$inferSelect;
type TradeRow = typeof trades.$inferSelect;

/**
 * Shape a trading account for the public distribute endpoints, applying the
 * operator's label overrides to the identifying fields. Consumers see the
 * override when set, otherwise the real value — with nothing in the payload
 * revealing whether a value is real or overridden. The underlying broker
 * credentials (metaApiId, raw login) are never exposed here, and neither is
 * any labeling/manual-entry configuration.
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
    server: acc.labelServer ?? acc.server,
    broker: acc.labelBroker ?? acc.broker,
    leverage: acc.labelLeverage ?? acc.leverage,
    currency: acc.currency,
    beginningDate: acc.beginningDate,               // inception / tracking-start date (YYYY-MM-DD or null)
    isActive: acc.isActive,
    syncStatus: acc.syncStatus,
    lastSyncAt: acc.lastSyncAt,
    stats: stats
      ? {
          balance: stats.balance,
          equity: stats.equity,
          totalPnl: stats.totalPnl,
          realizedPnl: stats.realizedPnl,
          unrealizedPnl: stats.unrealizedPnl,
          totalTrades: stats.totalTrades,
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
