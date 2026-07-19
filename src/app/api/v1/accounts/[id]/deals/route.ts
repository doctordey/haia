import { NextResponse } from 'next/server';
import { authenticateApiKey, keyAllowsAccount } from '@/lib/api/auth';
import { db } from '@/lib/db';
import { tradingAccounts, deals, balanceOps } from '@/lib/db/schema';
import { and, eq, sql, gte, lte, notInArray } from 'drizzle-orm';
import { exposeDeal } from '@/lib/api/serialize';
import { parseTimeParam } from '@/lib/api/time';

/**
 * GET /api/v1/accounts/:id/deals — distribute the statement's Deals section
 * (the broker's raw execution/balance ledger, captured from history imports).
 * Query: type=buy|sell|balance|... (default all), symbol=EURUSD,
 *        from/to (ISO 8601 or epoch), page, limit (max 500).
 * Exclusions leave no trace: excluded deals are omitted, as are deals whose
 * deal id matches a transaction excluded from the transactions endpoint — and
 * the report's running-balance column is never part of the payload, so hidden
 * rows can't be inferred from balance jumps.
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
  const type = searchParams.get('type');
  const symbol = searchParams.get('symbol');
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') || '100')));
  const offset = (page - 1) * limit;

  const from = parseTimeParam(searchParams.get('from'));
  const to = parseTimeParam(searchParams.get('to'));
  if (from === 'invalid' || to === 'invalid') {
    return NextResponse.json({ error: 'Invalid from/to — use ISO 8601 (2024-01-02T00:00:00Z) or epoch ms' }, { status: 400 });
  }

  const excludedOpDealIds = db
    .select({ dealId: balanceOps.dealId })
    .from(balanceOps)
    .where(and(eq(balanceOps.accountId, id), eq(balanceOps.isExcluded, true)));

  const conditions = [
    eq(deals.accountId, id),
    eq(deals.isExcluded, false),
    notInArray(deals.dealId, excludedOpDealIds),
  ];
  if (type && type !== 'all') conditions.push(eq(deals.type, type.toLowerCase()));
  if (symbol) conditions.push(eq(deals.symbol, symbol.toUpperCase()));
  if (from) conditions.push(gte(deals.time, from));
  if (to) conditions.push(lte(deals.time, to));

  const [list, countResult] = await Promise.all([
    db.query.deals.findMany({
      where: and(...conditions),
      orderBy: () => [sql`${deals.time} desc`],
      limit,
      offset,
    }),
    db.select({ count: sql<number>`count(*)` }).from(deals).where(and(...conditions)),
  ]);

  const total = Number(countResult[0].count);
  return NextResponse.json({
    deals: list.map(exposeDeal),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}
