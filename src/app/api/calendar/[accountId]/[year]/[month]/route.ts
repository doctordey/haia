import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { tradingAccounts, dailySnapshots } from '@/lib/db/schema';
import { eq, and, gte, lte } from 'drizzle-orm';

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

  // Build date range for the month
  const startDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-01`;
  const lastDay = new Date(yearNum, monthNum, 0).getDate();
  const endDate = `${yearNum}-${String(monthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const snapshots = await db.query.dailySnapshots.findMany({
    where: and(
      eq(dailySnapshots.accountId, accountId),
      gte(dailySnapshots.date, startDate),
      lte(dailySnapshots.date, endDate)
    ),
    orderBy: (snap, { asc }) => [asc(snap.date)],
  });

  const days = snapshots.map((s) => ({
    date: s.date,
    pnl: s.pnl,
    tradeCount: s.tradeCount,
    winCount: s.winCount,
    lossCount: s.lossCount,
    pips: s.pips,
    volume: s.volume,
    commission: s.commission,
    swap: s.swap,
    balance: s.balance,
  }));

  return NextResponse.json(days);
}
