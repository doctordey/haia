import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { tradingAccounts, trades } from '@/lib/db/schema';
import { eq, and, desc, asc, sql } from 'drizzle-orm';

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
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');
  const type = searchParams.get('type') || 'closed'; // 'open' | 'closed' | 'all'
  const offset = (page - 1) * limit;

  const account = await db.query.tradingAccounts.findFirst({
    where: and(eq(tradingAccounts.id, accountId), eq(tradingAccounts.userId, session.user.id)),
  });

  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  const conditions = [eq(trades.accountId, accountId)];
  if (type === 'open') conditions.push(eq(trades.isOpen, true));
  if (type === 'closed') conditions.push(eq(trades.isOpen, false));

  const [tradeList, countResult] = await Promise.all([
    db.query.trades.findMany({
      where: and(...conditions),
      orderBy: type === 'open' ? [desc(trades.openTime)] : [desc(trades.closeTime)],
      limit,
      offset,
    }),
    db.select({ count: sql<number>`count(*)` }).from(trades).where(and(...conditions)),
  ]);

  return NextResponse.json({
    trades: tradeList,
    pagination: {
      page,
      limit,
      total: Number(countResult[0].count),
      totalPages: Math.ceil(Number(countResult[0].count) / limit),
    },
  });
}
