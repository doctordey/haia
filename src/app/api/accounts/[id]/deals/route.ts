import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { tradingAccounts, deals, balanceOps } from '@/lib/db/schema';
import { and, eq, desc } from 'drizzle-orm';

async function findOwned(userId: string, id: string) {
  return db.query.tradingAccounts.findFirst({
    where: and(eq(tradingAccounts.id, id), eq(tradingAccounts.userId, userId)),
  });
}

/**
 * GET /api/accounts/:id/deals — list the account's deal-ledger rows (captured
 * from statement imports), including excluded ones, for the Settings
 * exclusions manager. Each row carries `autoHidden`: true when the deal is
 * already omitted from the public API because its broker deal id matches an
 * excluded transaction (so the owner sees why it isn't transmitted even with
 * its own flag off).
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

  const [list, excludedOps] = await Promise.all([
    db.query.deals.findMany({
      where: eq(deals.accountId, id),
      orderBy: [desc(deals.time)],
      limit: 200,
    }),
    db.select({ dealId: balanceOps.dealId }).from(balanceOps)
      .where(and(eq(balanceOps.accountId, id), eq(balanceOps.isExcluded, true))),
  ]);

  const hiddenViaTransaction = new Set(excludedOps.map((o) => o.dealId));
  return NextResponse.json({
    deals: list.map((d) => ({ ...d, autoHidden: hiddenViaTransaction.has(d.dealId) })),
  });
}

/**
 * PATCH /api/accounts/:id/deals — toggle whether a deal row is transmitted via
 * the public API. Body: { dealId, isExcluded } where dealId is the row's id
 * (not the broker deal id). Transmission only — balances and stats never
 * derive from deals.
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
  if (typeof body.dealId !== 'string' || typeof body.isExcluded !== 'boolean') {
    return NextResponse.json({ error: 'dealId (string) and isExcluded (boolean) are required' }, { status: 400 });
  }

  const [updated] = await db
    .update(deals)
    .set({ isExcluded: body.isExcluded })
    .where(and(eq(deals.id, body.dealId), eq(deals.accountId, id)))
    .returning({ id: deals.id, isExcluded: deals.isExcluded });

  if (!updated) return NextResponse.json({ error: 'Deal not found' }, { status: 404 });

  return NextResponse.json({ success: true, ...updated });
}
