import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tradingAccounts } from '@/lib/db/schema';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { normalizeTrade, upsertTrades, type TradeInput, type NormalizedTrade } from '@/lib/trades/ingest';
import { cleanImportText, parseMt5Csv, parseMt5Html, parseTradesJson } from '@/lib/import/mt5';
import { reconcileManualDuplicates } from '@/lib/trades/reconcile';
import { recomputeAccountAggregates } from '@/lib/accounts/aggregate';

/**
 * Shared history-import pipeline, used by both the public v1 route and the
 * session-authed web route (callers do their own auth + ownership checks).
 *
 * Format is detected from Content-Type and body sniffing:
 *   • application/json                  → JSON array (or { trades: [...] })
 *   • text/html, or body starts with < → MT5/MT4 HTML report
 *   • body starts with [ or {          → JSON (pasted with a text header)
 *   • otherwise                         → MT5 history CSV
 *
 * After ingesting (source="manual") it:
 *   1. removes manual rows that duplicate existing live rows (reconcile),
 *   2. advances the account's live-sync cursor (`lastSyncAt`) forward-only to
 *      the last imported trade, so the next MetaApi sync continues
 *      chronologically after the backfill instead of re-pulling that period
 *      (disable with ?advanceSync=false),
 *   3. rebuilds daily snapshots + account stats
 *      (?openingBalance= anchors the equity curve).
 */
export async function runHistoryImport(accountId: string, request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const obRaw = searchParams.get('openingBalance');
  const openingBalance = obRaw != null && obRaw !== '' && Number.isFinite(Number(obRaw)) ? Number(obRaw) : undefined;
  const advanceSync = searchParams.get('advanceSync') !== 'false';

  const contentType = request.headers.get('content-type') || '';
  const warnings: string[] = [];
  let inputs: TradeInput[] = [];
  let skipped = 0;
  let format: 'json' | 'html' | 'csv' = 'csv';

  try {
    if (contentType.includes('application/json')) {
      format = 'json';
      inputs = parseTradesJson(await request.json());
    } else {
      const text = cleanImportText(await request.text());
      if (!text.trim()) return NextResponse.json({ error: 'Empty body' }, { status: 400 });

      if (contentType.includes('html') || text.startsWith('<')) {
        format = 'html';
        const result = parseMt5Html(text);
        inputs = result.rows; skipped = result.skipped; warnings.push(...result.warnings);
      } else if (text.startsWith('[') || text.startsWith('{')) {
        format = 'json';
        inputs = parseTradesJson(JSON.parse(text));
      } else {
        const result = parseMt5Csv(text);
        inputs = result.rows; skipped = result.skipped; warnings.push(...result.warnings);
      }
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to parse import' }, { status: 400 });
  }

  if (inputs.length === 0) {
    return NextResponse.json({ error: 'No importable trades found', format, skipped, warnings }, { status: 400 });
  }

  const normalized: NormalizedTrade[] = [];
  const errors: { index: number; error: string }[] = [];
  for (let i = 0; i < inputs.length; i++) {
    try {
      normalized.push(normalizeTrade(accountId, inputs[i], 'manual'));
    } catch (e) {
      errors.push({ index: i, error: e instanceof Error ? e.message : 'invalid trade' });
    }
  }

  if (normalized.length === 0) {
    return NextResponse.json({ error: 'No valid trades to import', format, details: errors.slice(0, 20) }, { status: 400 });
  }

  const inserted = await upsertTrades(normalized);

  // If part of the imported window was already live-synced under different
  // tickets, drop the redundant manual copies.
  const deduplicated = await reconcileManualDuplicates(accountId);

  // Advance the live-sync cursor to the end of the backfill (forward-only), so
  // the next sync picks up exactly where the upload ended.
  let syncCursorAdvancedTo: Date | null = null;
  if (advanceSync) {
    const latest = normalized.reduce<Date | null>((max, t) => {
      const ts = t.closeTime ?? t.openTime;
      return !max || ts > max ? ts : max;
    }, null);
    if (latest) {
      const moved = await db
        .update(tradingAccounts)
        .set({ lastSyncAt: latest })
        .where(and(
          eq(tradingAccounts.id, accountId),
          or(isNull(tradingAccounts.lastSyncAt), lt(tradingAccounts.lastSyncAt, latest)),
        ))
        .returning({ id: tradingAccounts.id });
      if (moved.length > 0) syncCursorAdvancedTo = latest;
    }
  }

  const agg = await recomputeAccountAggregates(accountId, { openingBalance });

  return NextResponse.json({
    success: true,
    format,
    imported: inserted,
    deduplicated,
    skipped,
    failed: errors.length,
    ...(errors.length ? { errors: errors.slice(0, 20) } : {}),
    warnings,
    syncCursorAdvancedTo,
    totals: agg,
  }, { status: 201 });
}
