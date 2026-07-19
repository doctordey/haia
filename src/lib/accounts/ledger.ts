import { db } from '@/lib/db';
import { orders, deals } from '@/lib/db/schema';

/**
 * Record MetaApi history into the orders/deals ledger tables — the live
 * counterpart of the statement import's Orders/Deals capture. Rows upsert by
 * the broker's real order/deal id, so live sync and statement imports merge
 * instead of duplicating. Purely distribution data: balances and stats never
 * derive from these tables, and `isExcluded` is never touched here so an
 * operator's visibility choices survive every sync.
 */

// MetaApi enum value → statement vocabulary: "DEAL_TYPE_BUY" → "buy",
// "ORDER_STATE_FILLED" → "filled", "ORDER_TYPE_SELL_LIMIT" → "sell limit",
// "DEAL_ENTRY_INOUT" → "in/out".
function fromEnum(value: unknown, prefix: string): string | null {
  if (typeof value !== 'string' || !value.startsWith(prefix)) return null;
  const bare = value.slice(prefix.length).toLowerCase().replace(/_/g, ' ');
  return bare === 'inout' ? 'in/out' : bare;
}

// RPC methods have returned both bare arrays and wrapper objects across SDK
// versions — accept either.
function asArray(raw: unknown, key: 'deals' | 'historyOrders'): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw;
  const wrapped = (raw as Record<string, unknown> | null | undefined)?.[key];
  return Array.isArray(wrapped) ? wrapped : [];
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v));

/** A MetaApi deal mapped to a `deals` row, or null if the object isn't one. */
export function mapLiveDeal(deal: Record<string, unknown>) {
  const dealId = str(deal.id);
  const type = fromEnum(deal.type, 'DEAL_TYPE_');
  const time = deal.time ? new Date(deal.time as string | number | Date) : null;
  if (!dealId || !type || !time || Number.isNaN(time.getTime())) return null;

  return {
    dealId,
    values: {
      orderTicket: str(deal.orderId),
      time,
      symbol: str(deal.symbol),
      type,
      direction: fromEnum(deal.entryType, 'DEAL_ENTRY_'),
      lots: num(deal.volume),
      price: num(deal.price),
      commission: num(deal.commission),
      fee: num(deal.fee),
      swap: num(deal.swap),
      profit: num(deal.profit),
      comment: str(deal.comment),
    },
  };
}

/** A MetaApi history order mapped to an `orders` row, or null if it isn't one. */
export function mapLiveOrder(order: Record<string, unknown>) {
  const ticket = str(order.id);
  const symbol = str(order.symbol);
  const type = fromEnum(order.type, 'ORDER_TYPE_');
  const setupTime = order.time ? new Date(order.time as string | number | Date) : null;
  if (!ticket || !symbol || !type || !setupTime || Number.isNaN(setupTime.getTime())) return null;

  const state = fromEnum(order.state, 'ORDER_STATE_') ?? 'unknown';
  const requested = num(order.volume);
  const remaining = num(order.currentVolume);
  return {
    ticket,
    values: {
      symbol,
      type,
      lotsRequested: requested,
      // currentVolume is the unfilled remainder; absent, trust a filled state.
      lotsFilled: requested != null && remaining != null
        ? requested - remaining
        : state === 'filled' ? requested : null,
      price: num(order.openPrice),
      stopLoss: num(order.stopLoss),
      takeProfit: num(order.takeProfit),
      setupTime,
      doneTime: order.doneTime ? new Date(order.doneTime as string | number | Date) : null,
      state,
      comment: str(order.comment),
    },
  };
}

/** Upsert raw MetaApi deals (every type, including balance operations). */
export async function recordLiveDeals(accountId: string, rawDeals: unknown): Promise<number> {
  let recorded = 0;
  for (const deal of asArray(rawDeals, 'deals')) {
    const mapped = mapLiveDeal(deal);
    if (!mapped) continue;
    await db
      .insert(deals)
      .values({ accountId, dealId: mapped.dealId, ...mapped.values })
      // `balance` (running balance) is left alone: live deals don't carry it,
      // and a statement import may already have stored it.
      .onConflictDoUpdate({ target: [deals.accountId, deals.dealId], set: mapped.values });
    recorded++;
  }
  return recorded;
}

/** Upsert raw MetaApi history orders (terminal states: filled/canceled/expired…). */
export async function recordLiveOrders(accountId: string, rawOrders: unknown): Promise<number> {
  let recorded = 0;
  for (const order of asArray(rawOrders, 'historyOrders')) {
    const mapped = mapLiveOrder(order);
    if (!mapped) continue;
    await db
      .insert(orders)
      .values({ accountId, ticket: mapped.ticket, ...mapped.values })
      .onConflictDoUpdate({ target: [orders.accountId, orders.ticket], set: mapped.values });
    recorded++;
  }
  return recorded;
}
