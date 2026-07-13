import { NextResponse } from 'next/server';
import { authenticateApiKey, keyAllowsAccount } from '@/lib/api/auth';
import { db } from '@/lib/db';
import { tradingAccounts, balanceOps } from '@/lib/db/schema';
import { and, eq, desc, gte, lte } from 'drizzle-orm';
import { parseTimeParam } from '@/lib/api/time';
import { recomputeAccountAggregates } from '@/lib/accounts/aggregate';
import { parseManualTransaction } from '@/lib/accounts/transactions';

/**
 * GET /api/v1/accounts/:id/transactions — distribute the account's
 * deposits/withdrawals (transfers). Optional `from`/`to` (ISO 8601 or epoch ms)
 * filter by time. Excluded transactions are omitted with no trace, and nothing
 * in the payload indicates that exclusions exist.
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
  const from = parseTimeParam(searchParams.get('from'));
  const to = parseTimeParam(searchParams.get('to'));
  if (from === 'invalid' || to === 'invalid') {
    return NextResponse.json({ error: 'Invalid from/to — use ISO 8601 (2024-01-02T00:00:00Z) or epoch ms' }, { status: 400 });
  }

  const conditions = [eq(balanceOps.accountId, id), eq(balanceOps.isExcluded, false)];
  if (from) conditions.push(gte(balanceOps.time, from));
  if (to) conditions.push(lte(balanceOps.time, to));

  const ops = await db.query.balanceOps.findMany({
    where: and(...conditions),
    orderBy: [desc(balanceOps.time)],
  });

  return NextResponse.json({
    transactions: ops.map((op) => ({
      id: op.id,
      kind: op.kind,          // "deposit" | "withdrawal"
      amount: op.amount,      // signed: deposits +, withdrawals −
      time: op.time,
      comment: op.comment,
    })),
  });
}

/**
 * POST /api/v1/accounts/:id/transactions — record a deposit/withdrawal
 * (write scope). Body: { kind: "deposit"|"withdrawal", amount, time?, comment? }.
 * Counts toward the balance like a broker-synced transaction.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiKey(request, 'write');
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const account = keyAllowsAccount(auth, id)
    ? await db.query.tradingAccounts.findFirst({
        where: and(eq(tradingAccounts.id, id), eq(tradingAccounts.userId, auth.userId)),
      })
    : undefined;
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const parsed = parseManualTransaction(body);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const [row] = await db.insert(balanceOps).values({ accountId: id, ...parsed.values }).returning();
  await recomputeAccountAggregates(id);

  return NextResponse.json(
    { success: true, transaction: { id: row.id, kind: row.kind, amount: row.amount, time: row.time, comment: row.comment } },
    { status: 201 },
  );
}
