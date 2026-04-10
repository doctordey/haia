import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { tradingAccounts, trades, users } from '@/lib/db/schema';
import { eq, and, gte, lte, isNotNull } from 'drizzle-orm';

/**
 * Format a Date into YYYY-MM-DD in a specific IANA timezone.
 * Uses Intl.DateTimeFormat to avoid needing date-fns-tz.
 */
function formatDateInTimezone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')!.value;
  const month = parts.find((p) => p.type === 'month')!.value;
  const day = parts.find((p) => p.type === 'day')!.value;
  return `${year}-${month}-${day}`;
}

/**
 * Compute the UTC start and end of a month in a specific timezone.
 * Returns the UTC range that covers all local days in that month.
 */
function monthRangeInTimezone(year: number, month: number, timeZone: string): { start: Date; end: Date } {
  // Start: first moment of day 1 in the given timezone, expressed as UTC.
  // End: last moment of the last day of the month.
  // We compute by trying a few candidate UTC times and picking the boundary.
  // Simplest approach: pick a broad UTC range (previous day → next day after last day)
  // to guarantee all local-day trades are included, then filter by local date.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month - 1, lastDay, 23, 59, 59, 999));
  // Pad by 1 day on each side to handle any timezone offset (up to ±14h)
  start.setUTCDate(start.getUTCDate() - 1);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ accountId: string; year: string; month: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { accountId, year, month } = await params;
  const yearNum = parseInt(year);
  const monthNum = parseInt(month);

  const account = await db.query.tradingAccounts.findFirst({
    where: and(eq(tradingAccounts.id, accountId), eq(tradingAccounts.userId, session.user.id)),
  });

  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  // Fetch user's timezone preference for daily bucketing
  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { timezone: true },
  });
  const timeZone = user?.timezone || 'UTC';

  // Query all closed trades in a padded UTC range covering the target month
  const { start, end } = monthRangeInTimezone(yearNum, monthNum, timeZone);

  const closedTrades = await db.query.trades.findMany({
    where: and(
      eq(trades.accountId, accountId),
      eq(trades.isOpen, false),
      isNotNull(trades.closeTime),
      gte(trades.closeTime, start),
      lte(trades.closeTime, end),
    ),
  });

  // Bucket trades by local date in the user's timezone
  const monthPrefix = `${yearNum}-${String(monthNum).padStart(2, '0')}`;
  const buckets = new Map<string, {
    pnl: number;
    tradeCount: number;
    winCount: number;
    lossCount: number;
    pips: number;
    volume: number;
    commission: number;
    swap: number;
  }>();

  for (const trade of closedTrades) {
    if (!trade.closeTime) continue;
    const localDate = formatDateInTimezone(trade.closeTime, timeZone);
    // Only include trades whose local date falls in the requested month
    if (!localDate.startsWith(monthPrefix)) continue;

    let bucket = buckets.get(localDate);
    if (!bucket) {
      bucket = { pnl: 0, tradeCount: 0, winCount: 0, lossCount: 0, pips: 0, volume: 0, commission: 0, swap: 0 };
      buckets.set(localDate, bucket);
    }
    bucket.pnl += trade.profit;
    bucket.tradeCount += 1;
    if (trade.profit > 0) bucket.winCount += 1;
    else if (trade.profit < 0) bucket.lossCount += 1;
    bucket.pips += trade.pips || 0;
    bucket.volume += trade.lots;
    bucket.commission += trade.commission;
    bucket.swap += trade.swap;
  }

  const days = Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, b]) => ({
      date,
      pnl: b.pnl,
      tradeCount: b.tradeCount,
      winCount: b.winCount,
      lossCount: b.lossCount,
      pips: b.pips,
      volume: b.volume,
      commission: b.commission,
      swap: b.swap,
      balance: 0, // balance tracking removed — not meaningful per-day without running total
    }));

  return NextResponse.json(days);
}
