import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { tradingAccounts, balanceOps } from '@/lib/db/schema';
import { and, eq, desc } from 'drizzle-orm';

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
