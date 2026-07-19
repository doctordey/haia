import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { tradingAccounts, orders } from '@/lib/db/schema';
import { and, eq, desc } from 'drizzle-orm';

async function findOwned(userId: string, id: string) {
  return db.query.tradingAccounts.findFirst({
    where: and(eq(tradingAccounts.id, id), eq(tradingAccounts.userId, userId)),
  });
}

/**
 * GET /api/accounts/:id/orders — list the account's order-history rows
 * (captured from statement imports), including excluded ones, for the
 * Settings exclusions manager.
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

  const list = await db.query.orders.findMany({
    where: eq(orders.accountId, id),
    orderBy: [desc(orders.setupTime)],
    limit: 200,
  });

  return NextResponse.json({ orders: list });
}

/**
 * PATCH /api/accounts/:id/orders — toggle whether an order is transmitted via
 * the public API. Body: { orderId, isExcluded } where orderId is the row's id
 * (not the broker order ticket). Transmission only — balances and stats never
 * derive from orders.
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
  if (typeof body.orderId !== 'string' || typeof body.isExcluded !== 'boolean') {
    return NextResponse.json({ error: 'orderId (string) and isExcluded (boolean) are required' }, { status: 400 });
  }

  const [updated] = await db
    .update(orders)
    .set({ isExcluded: body.isExcluded })
    .where(and(eq(orders.id, body.orderId), eq(orders.accountId, id)))
    .returning({ id: orders.id, isExcluded: orders.isExcluded });

  if (!updated) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

  return NextResponse.json({ success: true, ...updated });
}
