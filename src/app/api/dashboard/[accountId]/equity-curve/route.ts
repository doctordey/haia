import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { tradingAccounts, dailySnapshots } from '@/lib/db/schema';
import { eq, and, gte } from 'drizzle-orm';
import { subDays, subMonths, subYears, format } from 'date-fns';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { accountId } = await params;
  const { searchParams } = new URL(request.url);
  const range = searchParams.get('range') || 'MAX';

  const account = await db.query.tradingAccounts.findFirst({
    where: and(eq(tradingAccounts.id, accountId), eq(tradingAccounts.userId, session.user.id)),
  });

  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  let startDate: Date | null = null;
  const now = new Date();

  switch (range) {
    case '1D': startDate = subDays(now, 1); break;
    case '7D': startDate = subDays(now, 7); break;
    case '30D': startDate = subDays(now, 30); break;
    case '90D': startDate = subDays(now, 90); break;
    case '1Y': startDate = subYears(now, 1); break;
    default: startDate = null;
  }

  const conditions = [eq(dailySnapshots.accountId, accountId)];
  if (startDate) {
    conditions.push(gte(dailySnapshots.date, format(startDate, 'yyyy-MM-dd')));
  }

  const snapshots = await db.query.dailySnapshots.findMany({
    where: and(...conditions),
    orderBy: (snap, { asc }) => [asc(snap.date)],
  });

  const equityData = snapshots.map((s) => ({
    date: s.date,
    equity: s.equity,
    balance: s.balance,
  }));

  return NextResponse.json(equityData);
}
