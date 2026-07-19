import type { tradingAccounts, accountStats, trades, orders, deals } from '@/lib/db/schema';

type AccountRow = typeof tradingAccounts.$inferSelect;
type StatsRow = typeof accountStats.$inferSelect;
type TradeRow = typeof trades.$inferSelect;
type OrderRow = typeof orders.$inferSelect;
type DealRow = typeof deals.$inferSelect;

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

/**
 * Public deal shape — the statement's Deals section, one row per ledger entry.
 * The running `balance` column is deliberately never exposed: a balance jump
 * would betray transactions that are excluded from transmission.
 */
export function exposeDeal(d: DealRow) {
  return {
    id: d.id,
    ticket: d.dealId,
    orderTicket: d.orderTicket,
    time: d.time,
    symbol: d.symbol,
    type: d.type,
    direction: d.direction,
    lots: d.lots,
    price: d.price,
    commission: d.commission,
    fee: d.fee,
    swap: d.swap,
    profit: d.profit,
    comment: d.comment,
  };
}

/** Public order shape — the statement's Orders section, one row per order. */
export function exposeOrder(o: OrderRow) {
  return {
    id: o.id,
    ticket: o.ticket,
    symbol: o.symbol,
    type: o.type,
    lotsRequested: o.lotsRequested,
    lotsFilled: o.lotsFilled,
    price: o.price,
    stopLoss: o.stopLoss,
    takeProfit: o.takeProfit,
    setupTime: o.setupTime,
    doneTime: o.doneTime,
    state: o.state,
    comment: o.comment,
  };
}
