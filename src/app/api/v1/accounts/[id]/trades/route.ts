import { NextResponse } from 'next/server';
import { authenticateApiKey, keyAllowsAccount, type ApiIdentity } from '@/lib/api/auth';
import { db } from '@/lib/db';
import { tradingAccounts, trades } from '@/lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { exposeTrade } from '@/lib/api/serialize';
import { normalizeTrade, upsertTrades, type TradeInput } from '@/lib/trades/ingest';
import { recomputeAccountAggregates } from '@/lib/accounts/aggregate';

// Ownership + key account-restriction; restricted keys 404 like a missing account.
async function findAllowed(identity: ApiIdentity, id: string) {
  if (!keyAllowsAccount(identity, id)) return undefined;
  return db.query.tradingAccounts.findFirst({
    where: and(eq(tradingAccounts.id, id), eq(tradingAccounts.userId, identity.userId)),
  });
}

/**
 * GET /api/v1/accounts/:id/trades — distribute trades.
 * Query: status=open|closed|all (default all), source=live|manual|all,
 *        symbol=EURUSD, page, limit (max 500).
 * `source` is ignored unless the account has distinguishManual enabled.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiKey(request, 'read');
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const account = await findAllowed(auth, id);
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || 'all';
  const source = searchParams.get('source') || 'all';
  const symbol = searchParams.get('symbol');
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') || '100')));
  const offset = (page - 1) * limit;

  // Excluded trades never leave the system via the public API.
  const conditions = [eq(trades.accountId, id), eq(trades.isExcluded, false)];
  if (status === 'open') conditions.push(eq(trades.isOpen, true));
  else if (status === 'closed') conditions.push(eq(trades.isOpen, false));
  if (account.distinguishManual && (source === 'live' || source === 'manual')) {
    conditions.push(eq(trades.source, source));
  }
  if (symbol) conditions.push(eq(trades.symbol, symbol.toUpperCase()));

  const [list, countResult] = await Promise.all([
    db.query.trades.findMany({
      where: and(...conditions),
      orderBy: () => [sql`${trades.closeTime} desc nulls first`],
      limit,
      offset,
    }),
    db.select({ count: sql<number>`count(*)` }).from(trades).where(and(...conditions)),
  ]);

  const total = Number(countResult[0].count);
  return NextResponse.json({
    trades: list.map((t) => exposeTrade(t, account.distinguishManual)),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}

/**
 * POST /api/v1/accounts/:id/trades — ingest one or many trades (source=manual).
 * Body: a single trade object, an array of them, or { trades: [...] }.
 * Aggregates (snapshots + stats) are recomputed after a successful insert.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiKey(request, 'write');
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const account = await findAllowed(auth, id);
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

  const inputs: TradeInput[] = Array.isArray(body)
    ? body
    : Array.isArray(body.trades)
      ? body.trades
      : [body];

  if (inputs.length === 0) return NextResponse.json({ error: 'No trades provided' }, { status: 400 });
  if (inputs.length > 5000) return NextResponse.json({ error: 'Too many trades in one request (max 5000)' }, { status: 400 });

  const normalized = [];
  const errors: { index: number; error: string }[] = [];
  for (let i = 0; i < inputs.length; i++) {
    try {
      normalized.push(normalizeTrade(id, inputs[i], 'manual'));
    } catch (e) {
      errors.push({ index: i, error: e instanceof Error ? e.message : 'invalid trade' });
    }
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 });
  }

  const inserted = await upsertTrades(normalized);
  await recomputeAccountAggregates(id);

  return NextResponse.json({ success: true, ingested: inserted }, { status: 201 });
}
