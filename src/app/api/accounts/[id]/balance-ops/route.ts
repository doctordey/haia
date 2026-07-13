import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { tradingAccounts, balanceOps } from '@/lib/db/schema';
import { and, eq, desc } from 'drizzle-orm';
import { recomputeAccountAggregates } from '@/lib/accounts/aggregate';
import { parseManualTransaction } from '@/lib/accounts/transactions';

async function findOwned(userId: string, id: string) {
  return db.query.tradingAccounts.findFirst({
    where: and(eq(tradingAccounts.id, id), eq(tradingAccounts.userId, userId)),
  });
}

/**
 * GET /api/accounts/:id/balance-ops — list the account's deposits/withdrawals
 * (captured from broker sync), including excluded ones, for the Settings
 * exclusions manager.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const account = await findOwned(session.user.id, id);
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  const ops = await db.query.balanceOps.findMany({
    where: eq(balanceOps.accountId, id),
    orderBy: [desc(balanceOps.time)],
  });

  return NextResponse.json({ ops });
}

/**
 * PATCH /api/accounts/:id/balance-ops — toggle whether a transaction is
 * transmitted via the public API. Body: { opId, isExcluded }. Transmission
 * only: a hidden deposit still counts toward the balance — it just isn't sent.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const account = await findOwned(session.user.id, id);
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  if (typeof body.opId !== 'string' || typeof body.isExcluded !== 'boolean') {
    return NextResponse.json({ error: 'opId (string) and isExcluded (boolean) are required' }, { status: 400 });
  }

  const [updated] = await db
    .update(balanceOps)
    .set({ isExcluded: body.isExcluded })
    .where(and(eq(balanceOps.id, body.opId), eq(balanceOps.accountId, id)))
    .returning({ id: balanceOps.id, isExcluded: balanceOps.isExcluded });

  if (!updated) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });

  return NextResponse.json({ success: true, ...updated });
}

/**
 * POST /api/accounts/:id/balance-ops — manually record a deposit/withdrawal
 * (e.g. when the broker's deal history doesn't reach back far enough).
 * Body: { kind: "deposit"|"withdrawal", amount: number, time: date, comment? }.
 * Counts toward the balance like a synced transaction; aggregates recompute.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const account = await findOwned(session.user.id, id);
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const parsed = parseManualTransaction(body);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const [row] = await db.insert(balanceOps).values({ accountId: id, ...parsed.values }).returning();
  await recomputeAccountAggregates(id);

  return NextResponse.json({ success: true, op: row }, { status: 201 });
}

/**
 * DELETE /api/accounts/:id/balance-ops?opId=… — remove a transaction record.
 * Intended for manually entered ones; a broker-synced row may reappear on the
 * next full re-sync (same broker deal id). Aggregates recompute.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const account = await findOwned(session.user.id, id);
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  const opId = new URL(request.url).searchParams.get('opId');
  if (!opId) return NextResponse.json({ error: 'opId is required' }, { status: 400 });

  const deleted = await db
    .delete(balanceOps)
    .where(and(eq(balanceOps.id, opId), eq(balanceOps.accountId, id)))
    .returning({ id: balanceOps.id });

  if (deleted.length === 0) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });

  await recomputeAccountAggregates(id);
  return NextResponse.json({ success: true });
}
