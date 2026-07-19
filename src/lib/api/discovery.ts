/**
 * Single source for the public API's self-description. Three views are
 * generated from the data here so they can never drift apart:
 *   • GET /api/v1              — machine-readable JSON index
 *   • GET /api/v1/docs         — human-readable HTML documentation
 *   • GET /api/v1/openapi.json — OpenAPI 3.0 spec (import into Postman etc.)
 */

export function apiName(): string {
  return process.env.API_NAME?.trim() || 'Haia REST API';
}

/**
 * Public base URL for this request. Behind a proxy (Railway/nginx) request.url
 * carries the internal bind address — prefer the forwarded headers. `depth`
 * strips trailing path segments (e.g. 1 turns …/v1/docs into …/v1).
 */
export function publicBase(request: Request, depth = 0): string {
  const url = new URL(request.url);
  const host =
    request.headers.get('x-forwarded-host')?.split(',')[0].trim() ||
    request.headers.get('host') ||
    url.host;
  const proto =
    request.headers.get('x-forwarded-proto')?.split(',')[0].trim() ||
    url.protocol.replace(':', '');
  let path = url.pathname.replace(/\/$/, '') || '/api/v1';
  for (let i = 0; i < depth; i++) path = path.replace(/\/[^/]*$/, '');
  return `${proto}://${host}${path}`;
}

export const ENDPOINTS = [
  { method: 'GET', path: '/accounts', desc: 'List accounts this key can access (with stats).', query: {} as Record<string, string> },
  { method: 'GET', path: '/accounts/{accountId}', desc: 'One account: identity + balance/equity + summary stats.', query: {} as Record<string, string> },
  {
    method: 'GET', path: '/accounts/{accountId}/trades', desc: 'Trade/execution history.',
    query: { status: 'open|closed|all', from: 'ISO 8601 or epoch', to: 'ISO 8601 or epoch', dateField: 'close|open (default close)', symbol: 'e.g. EURUSD', page: 'default 1', limit: 'default 100, max 500' },
  },
  {
    method: 'GET', path: '/accounts/{accountId}/orders', desc: 'Order history (market + pending orders, as on the statement’s Orders section).',
    query: { state: 'filled|canceled|all', from: 'ISO 8601 or epoch', to: 'ISO 8601 or epoch', dateField: 'setup|done (default setup)', symbol: 'e.g. EURUSD', page: 'default 1', limit: 'default 100, max 500' },
  },
  {
    method: 'GET', path: '/accounts/{accountId}/deals', desc: 'Raw deal ledger (entries, exits, balance operations), as on the statement’s Deals section.',
    query: { type: 'buy|sell|balance|…', from: 'ISO 8601 or epoch', to: 'ISO 8601 or epoch', symbol: 'e.g. EURUSD', page: 'default 1', limit: 'default 100, max 500' },
  },
  {
    method: 'GET', path: '/accounts/{accountId}/transactions', desc: 'Deposits/withdrawals (transfers).',
    query: { from: 'ISO 8601 or epoch', to: 'ISO 8601 or epoch' },
  },
];

export const DATA_DICTIONARY: Record<string, Record<string, string>> = {
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
  order: {
    id: 'string',
    ticket: 'string — broker order id',
    symbol: 'string — instrument',
    type: '"buy" | "sell" | "buy limit" | "sell limit" | "buy stop" | "sell stop" | …',
    lotsRequested: 'number | null — requested volume',
    lotsFilled: 'number | null — filled volume (0 for canceled orders)',
    price: 'number | null — order price (null for market orders)',
    stopLoss: 'number | null',
    takeProfit: 'number | null',
    setupTime: 'ISO 8601 — when the order was placed',
    doneTime: 'ISO 8601 | null — when it reached its final state',
    state: '"filled" | "canceled" | "expired" | …',
    comment: 'string | null',
  },
  deal: {
    id: 'string',
    ticket: 'string — broker deal id',
    orderTicket: 'string | null — originating order id',
    time: 'ISO 8601',
    symbol: 'string | null — null for balance/credit deals',
    type: '"buy" | "sell" | "balance" | "credit" | …',
    direction: '"in" | "out" | "in/out" | null',
    lots: 'number | null',
    price: 'number | null',
    commission: 'number | null',
    fee: 'number | null',
    swap: 'number | null',
    profit: 'number | null — realized PnL portion (transfer amount for balance deals)',
    comment: 'string | null',
  },
  transaction: {
    id: 'string',
    kind: '"deposit" | "withdrawal"',
    amount: 'number — signed (deposits +, withdrawals −)',
    time: 'ISO 8601',
    comment: 'string | null',
  },
};

export function discoveryDoc(base: string) {
  return {
    name: apiName(),
    version: 'v1',
    baseUrl: base,
    documentation: `${base}/docs`,
    openapi: `${base}/openapi.json`,
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
        read: 'fetch accounts, trades, orders, deals, transactions',
        write: 'also ingest trades, import history, edit labels',
      },
      errors: { '401': 'missing/invalid/revoked/expired key', '403': 'key lacks required scope', '404': 'account not visible to this key' },
    },
    endpoints: ENDPOINTS.map((e) => (Object.keys(e.query).length ? e : { method: e.method, path: e.path, desc: e.desc })),
    dataDictionary: DATA_DICTIONARY,
    examples: {
      listAccounts: `curl -H "Authorization: Token <key>" ${base}/accounts`,
      historyRange: `curl -H "Authorization: Token <key>" "${base}/accounts/{accountId}/trades?status=closed&from=2024-01-01T00:00:00Z&to=2024-02-01T00:00:00Z"`,
      openPositions: `curl -H "Authorization: Token <key>" "${base}/accounts/{accountId}/trades?status=open"`,
      orders: `curl -H "Authorization: Token <key>" "${base}/accounts/{accountId}/orders?state=filled"`,
      deals: `curl -H "Authorization: Token <key>" ${base}/accounts/{accountId}/deals`,
      transactions: `curl -H "Authorization: Token <key>" ${base}/accounts/{accountId}/transactions`,
    },
  };
}

// ── OpenAPI 3.0 ─────────────────────────────────────────────────────────────

const NUM = { type: 'number' } as const;
const NUM_N = { type: 'number', nullable: true } as const;
const STR = { type: 'string' } as const;
const STR_N = { type: 'string', nullable: true } as const;

export function openapiSpec(base: string) {
  return {
    openapi: '3.0.3',
    info: {
      title: apiName(),
      version: '1.0.0',
      description: 'Trading-account performance data: accounts, trade/execution history, order history, the raw deal ledger, and transfers. Authenticate every request with an API key (Authorization: Bearer <key>, Authorization: Token <key>, or X-API-Key: <key>).',
    },
    servers: [{ url: base }],
    security: [{ bearerAuth: [] }, { apiKeyHeader: [] }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'Authorization: Bearer <api_key> — the "Token <api_key>" scheme is also accepted on the same header.' },
        apiKeyHeader: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      },
      schemas: {
        Account: {
          type: 'object',
          properties: {
            id: STR, name: STR, accountNumber: STR,
            accountType: { type: 'string', enum: ['live', 'demo'], nullable: true },
            isDemo: { type: 'boolean', nullable: true },
            platform: { type: 'string', enum: ['MT4', 'MT5'] },
            server: STR, broker: STR_N, leverage: { type: 'integer', nullable: true },
            currency: STR, beginningDate: { type: 'string', format: 'date', nullable: true },
            isActive: { type: 'boolean' }, syncStatus: STR,
            lastSyncAt: { type: 'string', format: 'date-time', nullable: true },
            stats: {
              type: 'object', nullable: true,
              properties: {
                balance: NUM, equity: NUM, totalPnl: NUM, realizedPnl: NUM, unrealizedPnl: NUM,
                totalTrades: { type: 'integer' },
                lastCalculatedAt: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
        Trade: {
          type: 'object',
          properties: {
            id: STR, ticket: STR, symbol: STR,
            direction: { type: 'string', enum: ['BUY', 'SELL'] },
            lots: NUM, entryPrice: NUM, closePrice: NUM_N, stopLoss: NUM_N, takeProfit: NUM_N,
            openTime: { type: 'string', format: 'date-time' },
            closeTime: { type: 'string', format: 'date-time', nullable: true },
            profit: NUM, pips: NUM_N, commission: NUM, swap: NUM,
            isOpen: { type: 'boolean' },
            magicNumber: { type: 'integer', nullable: true }, comment: STR_N,
          },
        },
        Order: {
          type: 'object',
          properties: {
            id: STR, ticket: STR, symbol: STR,
            type: { type: 'string', description: '"buy", "sell", "buy limit", "sell stop", …' },
            lotsRequested: NUM_N, lotsFilled: NUM_N,
            price: { type: 'number', nullable: true, description: 'order price (null for market orders)' },
            stopLoss: NUM_N, takeProfit: NUM_N,
            setupTime: { type: 'string', format: 'date-time', description: 'when the order was placed' },
            doneTime: { type: 'string', format: 'date-time', nullable: true, description: 'when it reached its final state' },
            state: { type: 'string', description: '"filled", "canceled", "expired", …' },
            comment: STR_N,
          },
        },
        Deal: {
          type: 'object',
          properties: {
            id: STR,
            ticket: { type: 'string', description: 'broker deal id' },
            orderTicket: { type: 'string', nullable: true, description: 'originating order id' },
            time: { type: 'string', format: 'date-time' },
            symbol: { type: 'string', nullable: true, description: 'null for balance/credit deals' },
            type: { type: 'string', description: '"buy", "sell", "balance", "credit", …' },
            direction: { type: 'string', nullable: true, description: '"in", "out", "in/out"' },
            lots: NUM_N, price: NUM_N, commission: NUM_N, fee: NUM_N, swap: NUM_N,
            profit: { type: 'number', nullable: true, description: 'realized PnL portion (transfer amount for balance deals)' },
            comment: STR_N,
          },
        },
        Transaction: {
          type: 'object',
          properties: {
            id: STR,
            kind: { type: 'string', enum: ['deposit', 'withdrawal'] },
            amount: { type: 'number', description: 'signed: deposits +, withdrawals −' },
            time: { type: 'string', format: 'date-time' },
            comment: STR_N,
          },
        },
        Pagination: {
          type: 'object',
          properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, totalPages: { type: 'integer' } },
        },
        Error: { type: 'object', properties: { error: STR } },
      },
    },
    paths: {
      '/accounts': {
        get: {
          summary: 'List accounts this key can access',
          responses: {
            '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { accounts: { type: 'array', items: { $ref: '#/components/schemas/Account' } } } } } } },
            '401': { description: 'Missing/invalid key', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/accounts/{accountId}': {
        get: {
          summary: 'One account with balance/equity and summary stats',
          parameters: [{ name: 'accountId', in: 'path', required: true, schema: STR }],
          responses: {
            '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Account' } } } },
            '404': { description: 'Account not visible to this key', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/accounts/{accountId}/trades': {
        get: {
          summary: 'Trade/execution history (date-range filterable)',
          parameters: [
            { name: 'accountId', in: 'path', required: true, schema: STR },
            { name: 'status', in: 'query', schema: { type: 'string', enum: ['open', 'closed', 'all'], default: 'all' } },
            { name: 'from', in: 'query', schema: STR, description: 'ISO 8601 or epoch (ms; seconds if ≤10 digits)' },
            { name: 'to', in: 'query', schema: STR, description: 'ISO 8601 or epoch (ms; seconds if ≤10 digits)' },
            { name: 'dateField', in: 'query', schema: { type: 'string', enum: ['close', 'open'], default: 'close' } },
            { name: 'symbol', in: 'query', schema: STR },
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 100, maximum: 500 } },
          ],
          responses: {
            '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { trades: { type: 'array', items: { $ref: '#/components/schemas/Trade' } }, pagination: { $ref: '#/components/schemas/Pagination' } } } } } },
            '400': { description: 'Invalid from/to', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            '404': { description: 'Account not visible to this key', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/accounts/{accountId}/orders': {
        get: {
          summary: 'Order history (market + pending orders)',
          parameters: [
            { name: 'accountId', in: 'path', required: true, schema: STR },
            { name: 'state', in: 'query', schema: { type: 'string', enum: ['filled', 'canceled', 'all'], default: 'all' } },
            { name: 'from', in: 'query', schema: STR, description: 'ISO 8601 or epoch (ms; seconds if ≤10 digits)' },
            { name: 'to', in: 'query', schema: STR, description: 'ISO 8601 or epoch (ms; seconds if ≤10 digits)' },
            { name: 'dateField', in: 'query', schema: { type: 'string', enum: ['setup', 'done'], default: 'setup' } },
            { name: 'symbol', in: 'query', schema: STR },
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 100, maximum: 500 } },
          ],
          responses: {
            '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { orders: { type: 'array', items: { $ref: '#/components/schemas/Order' } }, pagination: { $ref: '#/components/schemas/Pagination' } } } } } },
            '400': { description: 'Invalid from/to', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            '404': { description: 'Account not visible to this key', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/accounts/{accountId}/deals': {
        get: {
          summary: 'Raw deal ledger (entries, exits, balance operations)',
          parameters: [
            { name: 'accountId', in: 'path', required: true, schema: STR },
            { name: 'type', in: 'query', schema: STR, description: 'buy | sell | balance | credit | … (default all)' },
            { name: 'from', in: 'query', schema: STR, description: 'ISO 8601 or epoch (ms; seconds if ≤10 digits)' },
            { name: 'to', in: 'query', schema: STR, description: 'ISO 8601 or epoch (ms; seconds if ≤10 digits)' },
            { name: 'symbol', in: 'query', schema: STR },
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 100, maximum: 500 } },
          ],
          responses: {
            '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { deals: { type: 'array', items: { $ref: '#/components/schemas/Deal' } }, pagination: { $ref: '#/components/schemas/Pagination' } } } } } },
            '400': { description: 'Invalid from/to', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            '404': { description: 'Account not visible to this key', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/accounts/{accountId}/transactions': {
        get: {
          summary: 'Deposits/withdrawals (transfers)',
          parameters: [
            { name: 'accountId', in: 'path', required: true, schema: STR },
            { name: 'from', in: 'query', schema: STR },
            { name: 'to', in: 'query', schema: STR },
          ],
          responses: {
            '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { transactions: { type: 'array', items: { $ref: '#/components/schemas/Transaction' } } } } } } },
            '404': { description: 'Account not visible to this key', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
    },
  };
}

// ── Human-readable docs page ────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderDocsHtml(base: string): string {
  const doc = discoveryDoc(base);
  const endpointRows = ENDPOINTS.map((e) => `
    <tr>
      <td><code>${e.method}</code></td>
      <td><code>${esc(e.path)}</code></td>
      <td>${esc(e.desc)}${Object.keys(e.query).length ? `<div class="q">${Object.entries(e.query).map(([k, v]) => `<code>${esc(k)}</code> ${esc(v)}`).join(' · ')}</div>` : ''}</td>
    </tr>`).join('');

  const dictSections = Object.entries(DATA_DICTIONARY).map(([name, fields]) => `
    <h3>${esc(name)}</h3>
    <table>${Object.entries(fields).map(([f, d]) => `<tr><td><code>${esc(f)}</code></td><td>${esc(d)}</td></tr>`).join('')}</table>`).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.name)} — Documentation</title>
<style>
  :root{color-scheme:dark}
  body{background:#0B0C10;color:#E6E8EE;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:0;padding:40px 20px}
  main{max-width:880px;margin:0 auto}
  h1{font-size:26px;margin:0 0 4px} h2{font-size:18px;margin:36px 0 10px;border-bottom:1px solid #23262F;padding-bottom:6px} h3{font-size:14px;margin:18px 0 6px;color:#9AA1B2;text-transform:uppercase;letter-spacing:.04em}
  .sub{color:#9AA1B2;margin:0 0 24px}
  code{font-family:"JetBrains Mono",ui-monospace,Menlo,monospace;font-size:13px;background:#1A1D26;border:1px solid #23262F;border-radius:4px;padding:1px 6px}
  pre{background:#12141A;border:1px solid #23262F;border-radius:8px;padding:14px;overflow-x:auto}
  pre code{background:none;border:none;padding:0}
  table{border-collapse:collapse;width:100%;margin:8px 0}
  td{border-top:1px solid #1A1D26;padding:7px 10px;vertical-align:top;font-size:14px}
  td:first-child{white-space:nowrap}
  .q{color:#9AA1B2;font-size:13px;margin-top:4px}
  a{color:#8B7CF7} .pill{display:inline-block;background:#1A1D26;border:1px solid #23262F;border-radius:999px;padding:2px 12px;font-size:13px;color:#9AA1B2;margin-right:8px}
</style></head><body><main>
  <h1>${esc(doc.name)}</h1>
  <p class="sub">REST API for trading-account performance data — accounts, trade history, orders, deals, and transfers.</p>
  <p><span class="pill">Base URL <code>${esc(base)}</code></span><span class="pill">JSON responses</span><span class="pill">Timestamps ISO 8601 UTC</span></p>

  <h2>Authentication</h2>
  <p>Every request needs an API key (format: <code>hk_</code> + 48 hex characters), sent via any of:</p>
  <pre><code>Authorization: Bearer &lt;api_key&gt;
Authorization: Token &lt;api_key&gt;
X-API-Key: &lt;api_key&gt;</code></pre>
  <p><code>401</code> missing/invalid key · <code>403</code> key lacks scope · <code>404</code> account not visible to this key.</p>

  <h2>Endpoints</h2>
  <table>${endpointRows}</table>
  <p>Date filters (<code>from</code>/<code>to</code>) accept ISO 8601 or epoch (milliseconds; seconds if ≤10 digits).</p>

  <h2>Examples</h2>
  <pre><code>${esc(doc.examples.listAccounts)}

${esc(doc.examples.historyRange)}

${esc(doc.examples.openPositions)}

${esc(doc.examples.orders)}

${esc(doc.examples.deals)}

${esc(doc.examples.transactions)}</code></pre>

  <h2>Data dictionary</h2>
  ${dictSections}

  <h2>Machine-readable</h2>
  <p>API index: <a href="${esc(base)}"><code>${esc(base)}</code></a> · OpenAPI 3.0 spec (import into Postman/Insomnia): <a href="${esc(doc.openapi)}"><code>${esc(doc.openapi)}</code></a></p>
</main></body></html>`;
}
