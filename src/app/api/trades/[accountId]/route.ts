import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { tradingAccounts, trades } from '@/lib/db/schema';
import { eq, and, desc, gte, lte, sql, like, or } from 'drizzle-orm';

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
  const type = searchParams.get('type') || 'closed';
  const sortBy = searchParams.get('sortBy') || 'closeTime';
  const sortDir = searchParams.get('sortDir') || 'desc';
  const offset = (page - 1) * limit;

  // Filters
  const symbol = searchParams.get('symbol');
  const direction = searchParams.get('direction');
  const result = searchParams.get('result');
  const dateFrom = searchParams.get('dateFrom');
  const dateTo = searchParams.get('dateTo');
  const minPnl = searchParams.get('minPnl');
  const maxPnl = searchParams.get('maxPnl');
  const exportCsv = searchParams.get('export') === 'csv';

  const account = await db.query.tradingAccounts.findFirst({
    where: and(eq(tradingAccounts.id, accountId), eq(tradingAccounts.userId, session.user.id)),
  });

  if (!account) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 });
  }

  const conditions: ReturnType<typeof eq>[] = [eq(trades.accountId, accountId)];
  if (type === 'open') conditions.push(eq(trades.isOpen, true));
  if (type === 'closed') conditions.push(eq(trades.isOpen, false));

  // Symbol filter (comma-separated list)
  if (symbol) {
    const symbols = symbol.split(',').map((s) => s.trim().toUpperCase());
    if (symbols.length === 1) {
      conditions.push(eq(trades.symbol, symbols[0]));
    } else {
      conditions.push(or(...symbols.map((s) => eq(trades.symbol, s)))!);
    }
  }

  if (direction && direction !== 'all') {
    conditions.push(eq(trades.direction, direction.toUpperCase()));
  }

  if (result === 'win') {
    conditions.push(sql`${trades.profit} > 0`);
  } else if (result === 'loss') {
    conditions.push(sql`${trades.profit} < 0`);
  }

  if (dateFrom) {
    conditions.push(gte(trades.closeTime, new Date(dateFrom)));
  }
  if (dateTo) {
    conditions.push(lte(trades.closeTime, new Date(dateTo)));
  }

  if (minPnl) {
    conditions.push(gte(trades.profit, parseFloat(minPnl)));
  }
  if (maxPnl) {
    conditions.push(lte(trades.profit, parseFloat(maxPnl)));
  }

  // Sort column mapping
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sortColumnMap: Record<string, any> = {
    closeTime: trades.closeTime,
    openTime: trades.openTime,
    symbol: trades.symbol,
    profit: trades.profit,
    lots: trades.lots,
    pips: trades.pips,
  };
  const sortColumn = sortColumnMap[sortBy] || trades.closeTime;
  const orderFn = sortDir === 'asc'
    ? sql`${sortColumn} asc nulls last`
    : sql`${sortColumn} desc nulls last`;

  if (exportCsv) {
    // Return all matching trades for CSV export (no pagination)
    const allTrades = await db.query.trades.findMany({
      where: and(...conditions),
      orderBy: () => [orderFn],
    });

    const headers = ['Ticket', 'Open Time', 'Close Time', 'Symbol', 'Direction', 'Lots', 'Entry Price', 'Close Price', 'SL', 'TP', 'Commission', 'Swap', 'PNL ($)', 'PNL (pips)', 'Duration (min)'];
    const rows = allTrades.map((t) => {
      const duration = t.closeTime && t.openTime
        ? Math.round((new Date(t.closeTime).getTime() - new Date(t.openTime).getTime()) / 60000)
        : '';
      return [
        t.ticket, t.openTime, t.closeTime || '', t.symbol, t.direction, t.lots,
        t.entryPrice, t.closePrice || '', t.stopLoss || '', t.takeProfit || '',
        t.commission, t.swap, t.profit, t.pips || '', duration,
      ].join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="trades-${accountId}.csv"`,
      },
    });
  }

  const [tradeList, countResult] = await Promise.all([
    db.query.trades.findMany({
      where: and(...conditions),
      orderBy: () => [orderFn],
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
