import { NextResponse } from 'next/server';
import { authenticateApiKey } from '@/lib/api/auth';
import { db } from '@/lib/db';
import { tradingAccounts } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { exposeAccount } from '@/lib/api/serialize';

/**
 * GET /api/v1/accounts  (also /haia/v1/accounts)
 * Distribute: list the authenticated key's trading accounts with stats, applying
 * label overrides to the identifying fields.
 */
export async function GET(request: Request) {
  const auth = await authenticateApiKey(request, 'read');
  if (auth instanceof NextResponse) return auth;

  const accounts = await db.query.tradingAccounts.findMany({
    where: eq(tradingAccounts.userId, auth.userId),
    with: { accountStats: true },
    orderBy: (a, { desc }) => [desc(a.createdAt)],
  });

  return NextResponse.json({
    accounts: accounts.map((a) => exposeAccount(a, a.accountStats)),
  });
}
