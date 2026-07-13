import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { tradingAccounts, trades } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { calculateDrawdownSeries } from '@/lib/calculations';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ accountId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { accountId } = await params;

  const account = await db.query.tradingAccounts.findFirst({
    where: and(eq(tradingAccounts.id, accountId), eq(tradingAccounts.userId, session.user.id)),
  });

  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  const allTrades = await db.query.trades.findMany({
    where: and(eq(trades.accountId, accountId), eq(trades.isOpen, false)),
  });

  const result = calculateDrawdownSeries(
    allTrades.map((t) => ({
      symbol: t.symbol,
      direction: t.direction,
      profit: t.profit,
      pips: t.pips,
      entryPrice: t.entryPrice,
      closePrice: t.closePrice,
      closeTime: t.closeTime,
      openTime: t.openTime,
      lots: t.lots,
    }))
  );

  return NextResponse.json(result);
}
