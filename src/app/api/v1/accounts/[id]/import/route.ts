import { NextResponse } from 'next/server';
import { authenticateApiKey } from '@/lib/api/auth';
import { db } from '@/lib/db';
import { tradingAccounts } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { runHistoryImport } from '@/lib/import/run';

/**
 * POST /api/v1/accounts/:id/import — backfill an account with an MT5 history
 * export: the HTML report (History → Report → HTML), the CSV export, or a JSON
 * array of trades. Format is auto-detected. Imported rows are recorded with
 * source="manual"; duplicates of already-synced live trades are removed; the
 * live-sync cursor advances to the end of the backfill (?advanceSync=false to
 * keep it). Optional `?openingBalance=` anchors the rebuilt equity curve.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiKey(request, 'write');
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const account = await db.query.tradingAccounts.findFirst({
    where: and(eq(tradingAccounts.id, id), eq(tradingAccounts.userId, auth.userId)),
  });
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  return runHistoryImport(id, request);
}
