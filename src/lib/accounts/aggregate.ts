import { db } from '@/lib/db';
import { trades, dailySnapshots, accountStats, balanceOps, tradingAccounts } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { calculateAccountStats } from '@/lib/calculations';
import { format } from 'date-fns';

/**
 * Rebuild a trading account's derived data — daily snapshots + account stats —
 * from its stored trades and balance operations. This is the single balance
 * authority: the MetaApi sync, imports, manual entry, and exclusion toggles all
 * call it after changing rows.
 *
 * Trades and balance operations flagged `isExcluded` are omitted entirely, so
 * the derived numbers always match what the API distributes:
 *
 *   balance(day) = openingBalance
 *                + Σ non-excluded deposits/withdrawals up to and incl. day
 *                + Σ non-excluded realized PnL up to and incl. day
 *
 * `openingBalance` lives on the account row (set by the import
 * ?openingBalance= param); broker accounts normally leave it at 0 because
 * their funding arrives as balance operations.
 */
export async function recomputeAccountAggregates(
  accountId: string,
): Promise<{ totalTrades: number; closedTrades: number; excludedTrades: number }> {
  const account = await db.query.tradingAccounts.findFirst({
    where: eq(tradingAccounts.id, accountId),
    columns: { openingBalance: true },
  });

  const allTrades = await db.query.trades.findMany({ where: eq(trades.accountId, accountId) });
  const included = allTrades.filter((t) => !t.isExcluded);
  const closedTrades = included.filter((t) => t.closeTime && !t.isOpen);

  const ops = await db.query.balanceOps.findMany({
    where: and(eq(balanceOps.accountId, accountId), eq(balanceOps.isExcluded, false)),
  });

  // Group by calendar day.
  const dailyMap = new Map<string, typeof closedTrades>();
  for (const trade of closedTrades) {
    const dateKey = format(trade.closeTime!, 'yyyy-MM-dd');
    if (!dailyMap.has(dateKey)) dailyMap.set(dateKey, []);
    dailyMap.get(dateKey)!.push(trade);
  }
  const balanceByDate = new Map<string, number>();
  for (const op of ops) {
    const dateKey = format(op.time, 'yyyy-MM-dd');
    balanceByDate.set(dateKey, (balanceByDate.get(dateKey) || 0) + op.amount);
  }

  // Full rebuild: exclusion toggles can empty out a day, so stale snapshot rows
  // must go rather than linger with old numbers.
  await db.delete(dailySnapshots).where(eq(dailySnapshots.accountId, accountId));

  const allDates = [...new Set([...dailyMap.keys(), ...balanceByDate.keys()])].sort();
  let runningBalance = account?.openingBalance ?? 0;

  for (const dateKey of allDates) {
    runningBalance += balanceByDate.get(dateKey) || 0;
    const dayTrades = dailyMap.get(dateKey) || [];
    const dayPnl = dayTrades.reduce((sum, t) => sum + t.profit, 0);
    runningBalance += dayPnl;

    await db.insert(dailySnapshots).values({
      accountId,
      date: dateKey,
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
    });
  }

  const stats = calculateAccountStats(
    included.map((t) => ({
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

  return {
    totalTrades: included.length,
    closedTrades: closedTrades.length,
    excludedTrades: allTrades.length - included.length,
  };
}
