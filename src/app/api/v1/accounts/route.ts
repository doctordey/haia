import { NextResponse } from 'next/server';
import { authenticateApiKey } from '@/lib/api/auth';
import { db } from '@/lib/db';
import { tradingAccounts } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { exposeAccount } from '@/lib/api/serialize';

/**
 * GET /api/v1/accounts  (also /haia/v1/accounts)
 * Distribute: list the trading accounts this key may access (all of the owner's
 * accounts, or only the key's restricted set), with stats and label overrides
 * applied to the identifying fields.
 */
export async function GET(request: Request) {
  const auth = await authenticateApiKey(request, 'read');
  if (auth instanceof NextResponse) return auth;

  const accounts = await db.query.tradingAccounts.findMany({
    where: auth.accountIds
      ? and(eq(tradingAccounts.userId, auth.userId), inArray(tradingAccounts.id, auth.accountIds))
      : eq(tradingAccounts.userId, auth.userId),
    with: { accountStats: true },
    orderBy: (a, { desc }) => [desc(a.createdAt)],
  });

  return NextResponse.json({
    accounts: accounts.map((a) => exposeAccount(a, a.accountStats)),
  });
}
