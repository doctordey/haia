import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { tradingAccounts, trades } from '@/lib/db/schema';
import { eq, and, desc, gte, lte, sql, like, or } from 'drizzle-orm';
import { normalizeTrade, upsertTrades } from '@/lib/trades/ingest';
import { recomputeAccountAggregates } from '@/lib/accounts/aggregate';

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
  // Excluded trades are hidden from listings too (coherent with stats/API);
  // the Settings exclusions manager passes includeExcluded=1 to see them.
  if (searchParams.get('includeExcluded') !== '1') {
    conditions.push(eq(trades.isExcluded, false));
  }
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

// Manually enter a trade/position (source = "manual"). Web-app counterpart of
// the public POST /api/v1/accounts/:id/trades endpoint.
export async function POST(
  request: Request,
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
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

  try {
    const normalized = normalizeTrade(accountId, body, 'manual');
    await upsertTrades([normalized]);
    await recomputeAccountAggregates(accountId);
    return NextResponse.json({ success: true, ticket: normalized.ticket }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Invalid trade' }, { status: 400 });
  }
}

// Toggle a trade's exclusion. Excluded trades vanish from API output, stats,
// snapshots, and listings (any source — works for live trades too, unlike DELETE).
export async function PATCH(
  request: Request,
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
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  if (typeof body.tradeId !== 'string' || typeof body.isExcluded !== 'boolean') {
    return NextResponse.json({ error: 'tradeId (string) and isExcluded (boolean) are required' }, { status: 400 });
  }

  const [updated] = await db
    .update(trades)
    .set({ isExcluded: body.isExcluded })
    .where(and(eq(trades.id, body.tradeId), eq(trades.accountId, accountId)))
    .returning({ id: trades.id, isExcluded: trades.isExcluded });

  if (!updated) return NextResponse.json({ error: 'Trade not found' }, { status: 404 });

  await recomputeAccountAggregates(accountId);
  return NextResponse.json({ success: true, ...updated });
}

// Delete a manual trade by id (?tradeId=). Only manual entries can be removed —
// live (broker-synced) rows are owned by the sync and would just reappear.
export async function DELETE(
  request: Request,
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
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  const tradeId = new URL(request.url).searchParams.get('tradeId');
  if (!tradeId) return NextResponse.json({ error: 'tradeId is required' }, { status: 400 });

  const deleted = await db
    .delete(trades)
    .where(and(eq(trades.id, tradeId), eq(trades.accountId, accountId), eq(trades.source, 'manual')))
    .returning({ id: trades.id });

  if (deleted.length === 0) {
    return NextResponse.json({ error: 'Manual trade not found (live trades cannot be deleted)' }, { status: 404 });
  }

  await recomputeAccountAggregates(accountId);
  return NextResponse.json({ success: true });
}
