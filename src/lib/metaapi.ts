export interface ConnectAccountParams {
  platform: 'mt4' | 'mt5';
  server: string;
  login: string;
  password: string;
  name: string;
}

// ─── Singleton SDK Instances ─────────────────────────
// Each new MetaApi() opens its own websocket connections (london:0, london:1).
// Creating multiple instances rapidly triggers MetaAPI's 429 rate limit.
// Cache one instance per token to reuse websocket connections.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sdkCache = new Map<string, any>();

function getMetaApiSync(purpose: 'signals' | 'analytics' = 'analytics') {
  const token = purpose === 'signals'
    ? (process.env.METAAPI_TOKEN_SIGNALS || process.env.METAAPI_TOKEN)
    : (process.env.METAAPI_TOKEN_ANALYTICS || process.env.METAAPI_TOKEN);

  if (!token) {
    throw new Error(
      purpose === 'signals'
        ? 'METAAPI_TOKEN_SIGNALS (or METAAPI_TOKEN) environment variable is not set'
        : 'METAAPI_TOKEN_ANALYTICS (or METAAPI_TOKEN) environment variable is not set'
    );
  }

  if (!sdkCache.has(token)) {
    const MetaApi = require('metaapi.cloud-sdk').default;
    sdkCache.set(token, new MetaApi(token));
  }

  return sdkCache.get(token)!;
}

export async function connectMetaApiAccount(params: ConnectAccountParams) {
  const api = getMetaApiSync('signals');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const account = await api.metatraderAccountApi.createAccount({
    type: 'cloud',
    login: params.login,
    password: params.password,
    name: params.name,
    server: params.server,
    platform: params.platform,
    magic: 0,
  } as any);

  await account.waitDeployed();
  await account.waitConnected();

  return account;
}

export async function getAccountConnection(metaApiId: string) {
  const api = getMetaApiSync('signals');
  const account = await api.metatraderAccountApi.getAccount(metaApiId);

  if (account.state !== 'DEPLOYED') {
    await account.waitDeployed();
  }

  const connection = account.getStreamingConnection();
  await connection.connect();
  await connection.waitSynchronized();

  return { account, connection };
}

export async function fetchAccountInfo(metaApiId: string): Promise<{ balance: number; equity: number }> {
  const api = getMetaApiSync('analytics');
  const account = await api.metatraderAccountApi.getAccount(metaApiId);

  if (account.state !== 'DEPLOYED') {
    await account.waitDeployed();
  }

  const connection = account.getRPCConnection();
  await connection.connect();
  await connection.waitSynchronized();

  const info = await connection.getAccountInformation();
  await connection.close();

  return { balance: info.balance || 0, equity: info.equity || 0 };
}

export async function fetchHistoricalDeals(metaApiId: string, startDate: Date, endDate: Date) {
  const api = getMetaApiSync('analytics');
  const account = await api.metatraderAccountApi.getAccount(metaApiId);

  if (account.state !== 'DEPLOYED') {
    await account.waitDeployed();
  }

  const connection = account.getRPCConnection();
  await connection.connect();
  await connection.waitSynchronized();

  const response = await connection.getDealsByTimeRange(startDate, endDate);
  await connection.close();

  // MetaAPI SDK may return { deals: [...] } or a flat array depending on version
  if (Array.isArray(response)) return response;
  if (response && Array.isArray(response.deals)) return response.deals;
  return [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeDeals(response: any): any[] {
  if (Array.isArray(response)) return response;
  if (response && Array.isArray(response.deals)) return response.deals;
  return [];
}

/**
 * Opens a single RPC connection and fetches both account info and deals.
 * Avoids opening multiple connections per sync (which triggers 429 rate limits).
 */
export async function fetchSyncData(metaApiId: string, startDate: Date, endDate: Date) {
  const api = getMetaApiSync('analytics');
  const account = await api.metatraderAccountApi.getAccount(metaApiId);

  if (account.state !== 'DEPLOYED') {
    await account.waitDeployed();
  }

  const connection = account.getRPCConnection();
  await connection.connect();
  await connection.waitSynchronized();

  try {
    const [info, dealsResponse] = await Promise.all([
      connection.getAccountInformation(),
      connection.getDealsByTimeRange(startDate, endDate),
    ]);

    return {
      balance: info.balance || 0,
      equity: info.equity || 0,
      deals: normalizeDeals(dealsResponse),
    };
  } finally {
    try { await connection.close(); } catch {}
  }
}

export async function removeMetaApiAccount(metaApiId: string) {
  const api = getMetaApiSync('analytics');
  const account = await api.metatraderAccountApi.getAccount(metaApiId);
  await account.remove();
}

/**
 * Returns the singleton MetaApi SDK instance for use in workers
 * that manage their own connections (e.g. signal-listener, trade-sync).
 */
export function getMetaApiInstance(purpose: 'signals' | 'analytics' = 'analytics') {
  return getMetaApiSync(purpose);
}
