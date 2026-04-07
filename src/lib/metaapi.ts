export interface ConnectAccountParams {
  platform: 'mt4' | 'mt5';
  server: string;
  login: string;
  password: string;
  name: string;
}

async function getMetaApi() {
  if (!process.env.METAAPI_TOKEN) {
    throw new Error('METAAPI_TOKEN environment variable is not set');
  }

  // Use the CJS entry point to avoid ESM issues in Next.js server runtime
  const MetaApi = require('metaapi.cloud-sdk').default;
  return new MetaApi(process.env.METAAPI_TOKEN);
}

export async function connectMetaApiAccount(params: ConnectAccountParams) {
  const api = await getMetaApi();

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
  const api = await getMetaApi();
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
  const api = await getMetaApi();
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
  const api = await getMetaApi();
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
  const api = await getMetaApi();
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
  const api = await getMetaApi();
  const account = await api.metatraderAccountApi.getAccount(metaApiId);
  await account.remove();
}
