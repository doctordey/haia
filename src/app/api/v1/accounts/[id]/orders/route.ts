import { NextResponse } from 'next/server';
import { authenticateApiKey, keyAllowsAccount } from '@/lib/api/auth';
import { db } from '@/lib/db';
import { tradingAccounts, orders } from '@/lib/db/schema';
import { and, eq, sql, gte, lte } from 'drizzle-orm';
import { exposeOrder } from '@/lib/api/serialize';
import { parseTimeParam } from '@/lib/api/time';

/**
 * GET /api/v1/accounts/:id/orders — distribute the statement's Orders section
 * (market + pending order records, captured from history imports).
 * Query: state=filled|canceled|all (default all), symbol=EURUSD,
 *        from/to (ISO 8601 or epoch, filter on setup time),
 *        dateField=setup|done (default setup), page, limit (max 500).
 * Excluded orders are omitted with no trace, matching trades/transactions.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiKey(request, 'read');
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const account = keyAllowsAccount(auth, id)
    ? await db.query.tradingAccounts.findFirst({
        where: and(eq(tradingAccounts.id, id), eq(tradingAccounts.userId, auth.userId)),
      })
    : undefined;
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  const { searchParams } = new URL(request.url);
  const state = searchParams.get('state') || 'all';
  const symbol = searchParams.get('symbol');
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') || '100')));
  const offset = (page - 1) * limit;

  const from = parseTimeParam(searchParams.get('from'));
  const to = parseTimeParam(searchParams.get('to'));
  if (from === 'invalid' || to === 'invalid') {
    return NextResponse.json({ error: 'Invalid from/to — use ISO 8601 (2024-01-02T00:00:00Z) or epoch ms' }, { status: 400 });
  }
  const dateCol = searchParams.get('dateField') === 'done' ? orders.doneTime : orders.setupTime;

  const conditions = [eq(orders.accountId, id), eq(orders.isExcluded, false)];
  if (state !== 'all') conditions.push(eq(orders.state, state));
  if (symbol) conditions.push(eq(orders.symbol, symbol.toUpperCase()));
  if (from) conditions.push(gte(dateCol, from));
  if (to) conditions.push(lte(dateCol, to));

  const [list, countResult] = await Promise.all([
    db.query.orders.findMany({
      where: and(...conditions),
      orderBy: () => [sql`${orders.setupTime} desc`],
      limit,
      offset,
    }),
    db.select({ count: sql<number>`count(*)` }).from(orders).where(and(...conditions)),
  ]);

  const total = Number(countResult[0].count);
  return NextResponse.json({
    orders: list.map(exposeOrder),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}
