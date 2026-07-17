import type { TradeInput } from '@/lib/trades/ingest';

/**
 * Parse an MT5 (or MT4) trade-history export into `TradeInput` rows ready for
 * ingestion. Three shapes are supported:
 *
 *  • CSV — the "History → Report → CSV" / copy-paste of the History tab. Columns
 *    are matched by header name (case-insensitive), so broker column ordering
 *    doesn't matter. MT5's report repeats the `Time` and `Price` columns (open
 *    then close); the first occurrence is treated as open, the second as close.
 *
 *  • HTML — the "History → Report → HTML" statement (also the MT4 statement).
 *    The Positions table is located by its header row (same header matching as
 *    CSV); section titles, pending orders, deals, and summary rows are skipped.
 *    MT5 saves these files as UTF-16 — the NUL bytes that survive a UTF-8 read
 *    are stripped so the upload works regardless of how it was decoded.
 *
 *  • JSON — an array of trade objects already shaped like `TradeInput` (or close
 *    to it). Lightly normalized here; full validation happens in `normalizeTrade`.
 */

export interface Mt5BalanceOp {
  dealId: string;         // broker deal id (idempotent upsert key)
  amount: number;         // signed: deposits +, withdrawals −
  time: string;           // normalized date string
  comment: string | null;
}

export interface Mt5ParseResult {
  rows: TradeInput[];
  skipped: number;     // non-trade / non-parseable data lines skipped
  warnings: string[];
  /** Deposits/withdrawals found in the report's Deals section (HTML) or balance rows (CSV). */
  balanceOps: Mt5BalanceOp[];
}

// ── Text cleanup ────────────────────────────────────────────────────────────

/**
 * Remove artifacts of reading an MT5 UTF-16 export as UTF-8 (NUL bytes between
 * every character, mangled BOM) so format sniffing and parsing see clean text.
 */
export function cleanImportText(raw: string): string {
  return raw.replace(/\u0000/g, '').replace(/^[\uFEFF\uFFFD\s]+/, '');
}

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

// ── Header mapping (shared by CSV and HTML) ────────────────────────────────

// Canonical field name for a header cell, or null if unrecognized.
function canon(header: string): string | null {
  const h = header.toLowerCase().replace(/[\s._/]+/g, '');
  const map: Record<string, string> = {
    time: 'time', opentime: 'opentime', openingtime: 'opentime', date: 'opentime',
    closetime: 'closetime', closingtime: 'closetime',
    symbol: 'symbol', instrument: 'symbol', item: 'symbol',
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

// Column plan for a header row, disambiguating the repeated time/price columns
// (MT5 reports the open pair first, then the close pair).
function buildPlan(headerCells: string[]): (string | null)[] {
  let timeSeen = 0;
  let priceSeen = 0;
  return headerCells.map((cell) => {
    const c = canon(cell);
    if (c === 'time') return timeSeen++ === 0 ? 'opentime' : 'closetime';
    if (c === 'price') return priceSeen++ === 0 ? 'entryprice' : 'closeprice';
    return c;
  });
}

// ── Value coercion ─────────────────────────────────────────────────────────

// Broker-tolerant numeric parsing: strips space/nbsp/apostrophe thousand
// separators; accepts a single decimal comma when no dot is present.
function parseNum(raw: string | undefined): number | null {
  if (raw == null) return null;
  let s = String(raw).replace(/[\s\u00A0\u202F']/g, '');
  if (!s) return null;
  if (s.includes('.') && s.includes(',')) s = s.replace(/,/g, '');
  else if (s.includes(',')) {
    const parts = s.split(',');
    s = parts.length === 2 ? parts.join('.') : s.replace(/,/g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// MT5 writes dates as "2024.01.02 10:00:45" — dots aren't reliably parseable
// by Date, so rewrite the date part to ISO-style dashes.
function normDate(s: string | undefined): string | null {
  if (!s) return null;
  const t = s.trim().replace(/^(\d{4})\.(\d{2})\.(\d{2})/, '$1-$2-$3');
  return t || null;
}

// A balance operation (deposit/withdrawal/credit) from a canonical-field
// record, or null if the row isn't one. The amount lives in the Profit column;
// the Deal/Ticket column carries the broker's real deal id.
function balanceOpFromRec(rec: Record<string, string>): Mt5BalanceOp | null {
  const type = (rec.type || '').toLowerCase();
  if (!/^(balance|credit|deposit|withdrawal)/.test(type)) return null;
  const amount = parseNum(rec.profit);
  const time = normDate(rec.opentime);
  if (amount == null || amount === 0 || !time || !rec.ticket) return null;
  return { dealId: rec.ticket, amount, time, comment: rec.comment || null };
}

// Scan every table section for balance operations. Each header row that maps
// ticket + type + profit starts a section; its data rows are mapped
// first-occurrence-wins (the Deals section has both Type and Direction, which
// canonicalize to the same field — the first, real Type must win).
function collectBalanceOps(allRows: string[][]): Mt5BalanceOp[] {
  const ops: Mt5BalanceOp[] = [];
  let plan: (string | null)[] | null = null;
  for (const cells of allRows) {
    const p = buildPlan(cells);
    if (p.filter(Boolean).length >= 4 && p.includes('ticket') && p.includes('type') && p.includes('profit')) {
      plan = p;
      continue;
    }
    if (!plan || cells.length < 4) continue;
    const rec: Record<string, string> = {};
    plan.forEach((field, idx) => { if (field && !(field in rec)) rec[field] = cells[idx] ?? ''; });
    const op = balanceOpFromRec(rec);
    if (op) ops.push(op);
  }
  return ops;
}

// Build a TradeInput from a canonical-field record. Returns null for rows that
// aren't trades (balance/credit operations, summaries, blank lines).
function recordToTrade(rec: Record<string, string>): TradeInput | null {
  const type = (rec.type || '').toLowerCase();
  if (!rec.symbol || !type) return null;
  if (!/buy|sell|long|short/.test(type)) return null;   // skip balance/credit/etc.

  // Some reports show volume as "filled / total" — take the filled part.
  const lotsRaw = (rec.lots || '').split('/')[0];

  return {
    ticket: rec.ticket || null,
    symbol: rec.symbol,
    direction: type,
    lots: parseNum(lotsRaw) as number,
    entryPrice: parseNum(rec.entryprice) as number,
    closePrice: parseNum(rec.closeprice),
    stopLoss: parseNum(rec.sl),
    takeProfit: parseNum(rec.tp),
    openTime: normDate(rec.opentime) as string,
    closeTime: normDate(rec.closetime),
    profit: parseNum(rec.profit),
    pips: parseNum(rec.pips),
    commission: parseNum(rec.commission),
    swap: parseNum(rec.swap),
    magicNumber: rec.magic ? Number(rec.magic) : null,
    comment: rec.comment || null,
  };
}

// ── CSV ────────────────────────────────────────────────────────────────────

export function parseMt5Csv(text: string): Mt5ParseResult {
  const warnings: string[] = [];
  const lines = cleanImportText(text).split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2) {
    return { rows: [], skipped: 0, warnings: ['No data rows found in CSV.'], balanceOps: [] };
  }

  const delim = detectDelimiter(lines[0]);
  const plan = buildPlan(splitCsvLine(lines[0], delim));

  if (!plan.includes('symbol') || !plan.includes('type')) {
    warnings.push('Could not find Symbol/Type columns — check this is an MT5 history export.');
  }

  const rows: TradeInput[] = [];
  const balanceOps: Mt5BalanceOp[] = [];
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i], delim);
    const rec: Record<string, string> = {};
    const recFirst: Record<string, string> = {};
    plan.forEach((field, idx) => {
      if (!field) return;
      rec[field] = cells[idx] ?? '';
      if (!(field in recFirst)) recFirst[field] = cells[idx] ?? '';
    });

    const trade = recordToTrade(rec);
    if (trade) { rows.push(trade); continue; }
    const op = balanceOpFromRec(recFirst);
    if (op) balanceOps.push(op);
    else skipped++;
  }

  return { rows, skipped, warnings, balanceOps };
}

// ── HTML (MT5 "Report → HTML" / MT4 statement) ─────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&');
}

// Every <tr> in the document as an array of plain-text cells.
function extractRows(html: string): string[][] {
  const rows: string[][] = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRe = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let tr: RegExpExecArray | null;
  while ((tr = trRe.exec(html))) {
    const cells: string[] = [];
    let cell: RegExpExecArray | null;
    cellRe.lastIndex = 0;
    while ((cell = cellRe.exec(tr[1]))) {
      cells.push(decodeEntities(cell[1].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim());
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

export function parseMt5Html(html: string): Mt5ParseResult {
  const allRows = extractRows(cleanImportText(html));

  // Deposits/withdrawals live in the report's Deals section — collect them
  // across every table section, independent of the Positions parse below.
  const balanceOps = collectBalanceOps(allRows);

  // Locate the trade table by scoring candidate header rows. The Positions
  // table (what we want) has both open and close time/price pairs, which
  // outranks the Orders/Deals sections' headers.
  let best: { idx: number; plan: (string | null)[]; score: number } | null = null;
  for (let i = 0; i < allRows.length; i++) {
    const plan = buildPlan(allRows[i]);
    if (!plan.includes('symbol') || !plan.includes('type') || !plan.includes('entryprice')) continue;
    let score = 1;
    if (plan.includes('closeprice')) score += 2;
    if (plan.includes('closetime')) score += 2;
    if (plan.includes('ticket')) score += 1;
    if (plan.includes('profit')) score += 1;
    if (!best || score > best.score) best = { idx: i, plan, score };
  }

  if (!best) {
    return {
      rows: [], skipped: 0, balanceOps,
      warnings: balanceOps.length
        ? []
        : ['No recognizable trade table found in HTML — expected an MT5/MT4 report with Symbol/Type/Price columns.'],
    };
  }

  const rows: TradeInput[] = [];
  let skipped = 0;

  for (let i = best.idx + 1; i < allRows.length; i++) {
    let cells = allRows[i];

    // A short row (section title like "Orders", colspan summary) or another
    // header row marks the end of the trade table once we have data.
    if (cells.length < 4) {
      if (rows.length) break;
      skipped++;
      continue;
    }
    const planHere = buildPlan(cells);
    if (planHere.filter(Boolean).length >= 4 && planHere.includes('symbol') && planHere.includes('type')) {
      if (rows.length) break;
      continue;
    }

    // Real MT5 reports emit MORE cells in data rows than in the header (the
    // header uses colspan; data rows add an empty spacer cell after Type),
    // which shifts every column from Volume onward. Realign by dropping empty
    // cells — leftmost first — until the row width matches the header plan.
    if (cells.length > best.plan.length) {
      let excess = cells.length - best.plan.length;
      cells = cells.filter((cell) => {
        if (excess > 0 && cell === '') { excess--; return false; }
        return true;
      });
    }

    const rec: Record<string, string> = {};
    best.plan.forEach((field, idx) => { if (field) rec[field] = cells[idx] ?? ''; });

    const trade = recordToTrade(rec);
    if (trade) rows.push(trade);
    else skipped++;
  }

  return { rows, skipped, warnings: [], balanceOps };
}

// ── JSON ───────────────────────────────────────────────────────────────────

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
