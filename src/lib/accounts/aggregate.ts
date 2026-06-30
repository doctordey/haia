import { db } from '@/lib/db';
import { trades, dailySnapshots, accountStats } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { calculateAccountStats } from '@/lib/calculations';
import { format } from 'date-fns';

/**
 * Rebuild a trading account's derived data (daily snapshots + account stats)
 * from its stored trades. Used after manual entry or a history import, so the
 * dashboard / calendar / analytics reflect the new rows immediately.
 *
 * Unlike the MetaApi sync (which folds in deposit/withdrawal balance events),
 * this derives balance purely from realized PnL:
 *   balance(day) = openingBalance + cumulative realized PnL up to and incl. day
 *
 * `openingBalance` defaults to the account's existing pre-PnL balance so the
 * ending balance stays anchored to the broker balance when one is known; for a
 * fresh manual account it is 0 unless overridden.
 */
export async function recomputeAccountAggregates(
  accountId: string,
  opts: { openingBalance?: number } = {},
): Promise<{ totalTrades: number; closedTrades: number }> {
  const allTrades = await db.query.trades.findMany({ where: eq(trades.accountId, accountId) });
  const closedTrades = allTrades.filter((t) => t.closeTime && !t.isOpen);

  // Determine the opening (pre-PnL) balance.
  let openingBalance = opts.openingBalance;
  if (openingBalance == null) {
    const existing = await db.query.accountStats.findFirst({ where: eq(accountStats.accountId, accountId) });
    openingBalance = existing ? existing.balance - existing.totalPnl : 0;
  }

  // Group closed trades by close date.
  const dailyMap = new Map<string, typeof closedTrades>();
  for (const trade of closedTrades) {
    const dateKey = format(trade.closeTime!, 'yyyy-MM-dd');
    if (!dailyMap.has(dateKey)) dailyMap.set(dateKey, []);
    dailyMap.get(dateKey)!.push(trade);
  }

  // Rebuild snapshots in date order with a running balance.
  let runningBalance = openingBalance;
  for (const dateKey of [...dailyMap.keys()].sort()) {
    const dayTrades = dailyMap.get(dateKey)!;
    const dayPnl = dayTrades.reduce((sum, t) => sum + t.profit, 0);
    runningBalance += dayPnl;

    const row = {
      balance: runningBalance,
      equity: runningBalance,
      pnl: dayPnl,
      tradeCount: dayTrades.length,
      winCount: dayTrades.filter((t) => t.profit > 0).length,
      lossCount: dayTrades.filter((t) => t.profit < 0).length,
      volume: dayTrades.reduce((sum, t) => sum + t.lots, 0),
      pips: dayTrades.reduce((sum, t) => sum + (t.pips || 0), 0),
      commission: dayTrades.reduce((sum, t) => sum + t.commission, 0),
      swap: dayTrades.reduce((sum, t) => sum + t.swap, 0),
    };

    await db
      .insert(dailySnapshots)
      .values({ accountId, date: dateKey, ...row })
      .onConflictDoUpdate({ target: [dailySnapshots.accountId, dailySnapshots.date], set: row });
  }

  const stats = calculateAccountStats(
    allTrades.map((t) => ({
      profit: t.profit, pips: t.pips, lots: t.lots, commission: t.commission,
      swap: t.swap, openTime: t.openTime, closeTime: t.closeTime, isOpen: t.isOpen,
      symbol: t.symbol, direction: t.direction, entryPrice: t.entryPrice, closePrice: t.closePrice,
    })),
  );

  await db
    .insert(accountStats)
    .values({ accountId, balance: runningBalance, equity: runningBalance, ...stats, lastCalculatedAt: new Date() })
    .onConflictDoUpdate({
      target: accountStats.accountId,
      set: { balance: runningBalance, equity: runningBalance, ...stats, lastCalculatedAt: new Date() },
    });

  return { totalTrades: allTrades.length, closedTrades: closedTrades.length };
}
