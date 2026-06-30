import type { TradeInput } from '@/lib/trades/ingest';

/**
 * Parse an MT5 (or MT4) trade-history export into `TradeInput` rows ready for
 * ingestion. Two shapes are supported:
 *
 *  • CSV — the "History → Report → CSV" / copy-paste of the History tab. Columns
 *    are matched by header name (case-insensitive), so broker column ordering
 *    doesn't matter. MT5's report repeats the `Time` and `Price` columns (open
 *    then close); the first occurrence is treated as open, the second as close.
 *
 *  • JSON — an array of trade objects already shaped like `TradeInput` (or close
 *    to it). Lightly normalized here; full validation happens in `normalizeTrade`.
 */

// ── CSV row/field splitting (handles quotes + comma/tab/semicolon delimiters) ──

function detectDelimiter(headerLine: string): string {
  if (headerLine.includes('\t')) return '\t';
  if (headerLine.includes(';') && !headerLine.includes(',')) return ';';
  return ',';
}

function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === delim && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

// Canonical field name for a header cell, or null if unrecognized.
function canon(header: string): string | null {
  const h = header.toLowerCase().replace(/[\s._/]+/g, '');
  const map: Record<string, string> = {
    time: 'time', opentime: 'opentime', openingtime: 'opentime', date: 'opentime',
    closetime: 'closetime', closingtime: 'closetime',
    symbol: 'symbol', instrument: 'symbol',
    type: 'type', side: 'type', direction: 'type', action: 'type',
    volume: 'lots', lots: 'lots', size: 'lots', qty: 'lots', quantity: 'lots',
    price: 'price', openprice: 'entryprice', entryprice: 'entryprice', entry: 'entryprice', open: 'entryprice',
    closeprice: 'closeprice', exitprice: 'closeprice', close: 'closeprice',
    sl: 'sl', stoploss: 'sl',
    tp: 'tp', takeprofit: 'tp',
    commission: 'commission', commissions: 'commission', fee: 'commission', fees: 'commission',
    swap: 'swap', rollover: 'swap',
    profit: 'profit', pnl: 'profit', netprofit: 'profit', gain: 'profit',
    pips: 'pips', points: 'pips',
    ticket: 'ticket', order: 'ticket', deal: 'ticket', position: 'ticket', id: 'ticket', positionid: 'ticket',
    comment: 'comment', notes: 'comment',
    magic: 'magic', magicnumber: 'magic',
  };
  return map[h] ?? null;
}

export interface Mt5ParseResult {
  rows: TradeInput[];
  skipped: number;     // non-trade / non-parseable data lines skipped
  warnings: string[];
}

export function parseMt5Csv(text: string): Mt5ParseResult {
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2) {
    return { rows: [], skipped: 0, warnings: ['No data rows found in CSV.'] };
  }

  const delim = detectDelimiter(lines[0]);
  const headerCells = splitCsvLine(lines[0], delim);

  // Build a column plan, disambiguating the repeated time/price columns.
  let timeSeen = 0;
  let priceSeen = 0;
  const plan: (string | null)[] = headerCells.map((cell) => {
    const c = canon(cell);
    if (c === 'time') return timeSeen++ === 0 ? 'opentime' : 'closetime';
    if (c === 'price') return priceSeen++ === 0 ? 'entryprice' : 'closeprice';
    return c;
  });

  if (!plan.includes('symbol') || !plan.includes('type')) {
    warnings.push('Could not find Symbol/Type columns — check this is an MT5 history export.');
  }

  const rows: TradeInput[] = [];
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i], delim);
    const rec: Record<string, string> = {};
    plan.forEach((field, idx) => { if (field) rec[field] = cells[idx] ?? ''; });

    // Skip summary/balance/empty rows.
    const type = (rec.type || '').toLowerCase();
    if (!rec.symbol || !type) { skipped++; continue; }
    if (!/buy|sell|long|short/.test(type)) { skipped++; continue; }  // skip balance/credit/etc.

    rows.push({
      ticket: rec.ticket || null,
      symbol: rec.symbol,
      direction: type,
      lots: Number(rec.lots),
      entryPrice: Number(rec.entryprice),
      closePrice: rec.closeprice ? Number(rec.closeprice) : null,
      stopLoss: rec.sl ? Number(rec.sl) : null,
      takeProfit: rec.tp ? Number(rec.tp) : null,
      openTime: rec.opentime,
      closeTime: rec.closetime || null,
      profit: rec.profit ? Number(rec.profit.replace(/\s/g, '')) : null,
      pips: rec.pips ? Number(rec.pips) : null,
      commission: rec.commission ? Number(rec.commission.replace(/\s/g, '')) : null,
      swap: rec.swap ? Number(rec.swap.replace(/\s/g, '')) : null,
      magicNumber: rec.magic ? Number(rec.magic) : null,
      comment: rec.comment || null,
    });
  }

  return { rows, skipped, warnings };
}

/** Coerce an arbitrary JSON value into a `TradeInput[]`. Throws on a non-array. */
export function parseTradesJson(input: unknown): TradeInput[] {
  const arr = Array.isArray(input)
    ? input
    : input && typeof input === 'object' && Array.isArray((input as { trades?: unknown }).trades)
      ? (input as { trades: unknown[] }).trades
      : null;
  if (!arr) throw new Error('Expected a JSON array of trades (or { "trades": [...] }).');
  return arr as TradeInput[];
}
