import { NextResponse } from 'next/server';

/**
 * GET /api/v1  (also /v1 on an API-only host, and /haia/v1)
 * Self-describing API index / data dictionary. Public (no key required) so a
 * consumer can discover auth, endpoints, timestamp formats, and field meanings
 * before wiring anything up. This is the "documentation link" to hand out.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  // Behind a proxy (Railway/Vercel/nginx) request.url carries the internal bind
  // address — build the public base from the forwarded headers instead.
  const host =
    request.headers.get('x-forwarded-host')?.split(',')[0].trim() ||
    request.headers.get('host') ||
    url.host;
  const proto =
    request.headers.get('x-forwarded-proto')?.split(',')[0].trim() ||
    url.protocol.replace(':', '');
  // Prefer the bare /v1 base on a dedicated API host; else the /api/v1 path.
  const base = `${proto}://${host}${url.pathname.replace(/\/$/, '') || '/api/v1'}`;

  return NextResponse.json({
    // Branding: set API_NAME in the environment to publish under your own name.
    name: process.env.API_NAME?.trim() || 'Haia REST API',
    version: 'v1',
    baseUrl: base,
    responseFormat: 'application/json',
    timestamps: {
      output: 'ISO 8601 UTC, e.g. "2024-01-02T12:00:00.000Z"',
      input: 'from/to accept ISO 8601 or epoch (milliseconds; seconds if ≤10 digits)',
    },
    authentication: {
      schemes: [
        'Authorization: Bearer <api_key>',
        'Authorization: Token <api_key>',
        'X-API-Key: <api_key>',
      ],
      keyFormat: 'hk_ followed by 48 hex characters',
      scopes: {
        read: 'fetch accounts, trades, transactions',
        write: 'also ingest trades, import history, edit labels',
      },
      errors: { '401': 'missing/invalid/revoked/expired key', '403': 'key lacks required scope', '404': 'account not visible to this key' },
    },
    endpoints: [
      { method: 'GET', path: '/accounts', desc: 'List accounts this key can access (with stats).' },
      { method: 'GET', path: '/accounts/{accountId}', desc: 'One account: identity + balance/equity + summary stats.' },
      { method: 'GET', path: '/accounts/{accountId}/trades', desc: 'Trade/execution history.',
        query: { status: 'open|closed|all', from: 'ISO 8601 or epoch', to: 'ISO 8601 or epoch', dateField: 'close|open (default close)', symbol: 'e.g. EURUSD', page: 'default 1', limit: 'default 100, max 500' } },
      { method: 'GET', path: '/accounts/{accountId}/transactions', desc: 'Deposits/withdrawals (transfers).',
        query: { from: 'ISO 8601 or epoch', to: 'ISO 8601 or epoch' } },
    ],
    dataDictionary: {
      account: {
        id: 'string — account id used in all paths',
        name: 'string — display name',
        accountNumber: 'string — account/login number',
        accountType: '"live" | "demo" | null',
        isDemo: 'boolean | null',
        platform: '"MT4" | "MT5"',
        server: 'string — broker server',
        broker: 'string | null — broker name',
        leverage: 'integer | null',
        currency: 'string — ISO 4217, e.g. USD',
        beginningDate: 'string | null — inception / tracking-start date (YYYY-MM-DD)',
        'stats.balance': 'number — account balance',
        'stats.equity': 'number — balance + unrealized PnL',
        'stats.totalPnl': 'number — realized + unrealized PnL',
        'stats.realizedPnl': 'number',
        'stats.unrealizedPnl': 'number — PnL of open positions',
        'stats.totalTrades': 'integer — closed trades',
      },
      trade: {
        ticket: 'string — broker ticket / position id',
        symbol: 'string — instrument',
        direction: '"BUY" | "SELL"',
        lots: 'number — volume',
        entryPrice: 'number',
        closePrice: 'number | null (null while open)',
        stopLoss: 'number | null',
        takeProfit: 'number | null',
        openTime: 'ISO 8601',
        closeTime: 'ISO 8601 | null (null while open)',
        profit: 'number — realized PnL in account currency',
        pips: 'number | null',
        commission: 'number',
        swap: 'number',
        isOpen: 'boolean — true = open position',
      },
      transaction: {
        id: 'string',
        kind: '"deposit" | "withdrawal"',
        amount: 'number — signed (deposits +, withdrawals −)',
        time: 'ISO 8601',
        comment: 'string | null',
      },
    },
    examples: {
      listAccounts: `curl -H "Authorization: Token <key>" ${base}/accounts`,
      historyRange: `curl -H "Authorization: Token <key>" "${base}/accounts/{accountId}/trades?status=closed&from=2024-01-01T00:00:00Z&to=2024-02-01T00:00:00Z"`,
      openPositions: `curl -H "Authorization: Token <key>" "${base}/accounts/{accountId}/trades?status=open"`,
      transactions: `curl -H "Authorization: Token <key>" ${base}/accounts/{accountId}/transactions`,
    },
  });
}
