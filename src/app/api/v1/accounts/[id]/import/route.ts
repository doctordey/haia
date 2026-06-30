import { NextResponse } from 'next/server';
import { authenticateApiKey } from '@/lib/api/auth';
import { db } from '@/lib/db';
import { tradingAccounts } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { normalizeTrade, upsertTrades, type TradeInput } from '@/lib/trades/ingest';
import { parseMt5Csv, parseTradesJson } from '@/lib/import/mt5';
import { recomputeAccountAggregates } from '@/lib/accounts/aggregate';

/**
 * POST /api/v1/accounts/:id/import — backfill an account with an MT5 history
 * export. Send either:
 *   • Content-Type: text/csv  (or text/plain) — the raw MT5 history CSV
 *   • Content-Type: application/json — a JSON array of trades (or { trades: [...] })
 *
 * Imported rows are recorded with source="manual". Optional `?openingBalance=`
 * anchors the rebuilt equity/balance curve (defaults to the account's current
 * pre-PnL balance, or 0 for a fresh account).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiKey(request, 'write');
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const account = await db.query.tradingAccounts.findFirst({
    where: and(eq(tradingAccounts.id, id), eq(tradingAccounts.userId, auth.userId)),
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
      if (!text.trim()) return NextResponse.json({ error: 'Empty body' }, { status: 400 });
      const result = parseMt5Csv(text);
      inputs = result.rows;
      skipped = result.skipped;
      warnings.push(...result.warnings);
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to parse import' }, { status: 400 });
  }

  if (inputs.length === 0) {
    return NextResponse.json({ error: 'No importable trades found', skipped, warnings }, { status: 400 });
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
    ...(errors.length ? { errors: errors.slice(0, 20) } : {}),
    warnings,
    totals: agg,
  }, { status: 201 });
}
