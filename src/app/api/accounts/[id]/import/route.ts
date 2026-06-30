import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { tradingAccounts } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { normalizeTrade, upsertTrades, type TradeInput } from '@/lib/trades/ingest';
import { parseMt5Csv, parseTradesJson } from '@/lib/import/mt5';
import { recomputeAccountAggregates } from '@/lib/accounts/aggregate';

/**
 * POST /api/accounts/:id/import — web-app history backfill. Accepts the MT5
 * history CSV (text/csv or text/plain) or a JSON array of trades. Imported rows
 * are stored with source="manual". Mirrors POST /api/v1/accounts/:id/import.
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

  const { searchParams } = new URL(request.url);
  const obRaw = searchParams.get('openingBalance');
  const openingBalance = obRaw != null && obRaw !== '' && Number.isFinite(Number(obRaw)) ? Number(obRaw) : undefined;

  const contentType = request.headers.get('content-type') || '';
  const warnings: string[] = [];
  let inputs: TradeInput[] = [];
  let skipped = 0;

  try {
    if (contentType.includes('application/json')) {
      inputs = parseTradesJson(await request.json());
    } else {
      const text = await request.text();
      if (!text.trim()) return NextResponse.json({ error: 'Empty file' }, { status: 400 });
      const result = parseMt5Csv(text);
      inputs = result.rows;
      skipped = result.skipped;
      warnings.push(...result.warnings);
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to parse import' }, { status: 400 });
  }

  if (inputs.length === 0) {
    return NextResponse.json({ error: 'No importable trades found in file', skipped, warnings }, { status: 400 });
  }

  const normalized = [];
  const errors: { index: number; error: string }[] = [];
  for (let i = 0; i < inputs.length; i++) {
    try {
      normalized.push(normalizeTrade(id, inputs[i], 'manual'));
    } catch (e) {
      errors.push({ index: i, error: e instanceof Error ? e.message : 'invalid trade' });
    }
  }

  if (normalized.length === 0) {
    return NextResponse.json({ error: 'No valid trades to import', details: errors.slice(0, 20) }, { status: 400 });
  }

  const inserted = await upsertTrades(normalized);
  const agg = await recomputeAccountAggregates(id, { openingBalance });

  return NextResponse.json({
    success: true,
    imported: inserted,
    skipped,
    failed: errors.length,
    warnings,
    totals: agg,
  }, { status: 201 });
}
