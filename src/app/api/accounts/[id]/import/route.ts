import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { tradingAccounts } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { runHistoryImport } from '@/lib/import/run';

/**
 * POST /api/accounts/:id/import — web-app history backfill. Accepts the MT5
 * HTML report, history CSV, or a JSON array of trades (auto-detected). Mirrors
 * POST /api/v1/accounts/:id/import — see src/lib/import/run.ts for behavior.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const account = await db.query.tradingAccounts.findFirst({
    where: and(eq(tradingAccounts.id, id), eq(tradingAccounts.userId, session.user.id)),
  });
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  return runHistoryImport(id, request);
}
