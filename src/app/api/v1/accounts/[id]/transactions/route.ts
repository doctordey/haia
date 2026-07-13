import { NextResponse } from 'next/server';
import { authenticateApiKey, keyAllowsAccount } from '@/lib/api/auth';
import { db } from '@/lib/db';
import { tradingAccounts, balanceOps } from '@/lib/db/schema';
import { and, eq, desc } from 'drizzle-orm';

/**
 * GET /api/v1/accounts/:id/transactions — distribute the account's
 * deposits/withdrawals. Excluded transactions are omitted with no trace, and
 * nothing in the payload indicates that exclusions exist.
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

  const ops = await db.query.balanceOps.findMany({
    where: and(eq(balanceOps.accountId, id), eq(balanceOps.isExcluded, false)),
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
