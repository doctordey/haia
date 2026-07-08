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

export async function fetchHistoricalDeals(metaApiId: string, startDate: Date, endDate: Date) {
  const api = await getMetaApi();
  const account = await api.metatraderAccountApi.getAccount(metaApiId);

  if (account.state !== 'DEPLOYED') {
    await withTimeout(account.waitDeployed(), SYNC_STEP_TIMEOUT_MS, 'account deploy');
  }

  const connection = account.getRPCConnection();
  try {
    await connection.connect();
    await withTimeout(connection.waitSynchronized(), SYNC_STEP_TIMEOUT_MS, 'history sync');
    return await withTimeout(connection.getDealsByTimeRange(startDate, endDate), SYNC_STEP_TIMEOUT_MS, 'deals fetch');
  } finally {
    try { await connection.close(); } catch {}
  }
}

/** Reject if `p` doesn't settle within `ms` — bounds slow MetaApi RPC steps so a
 *  sync can't hang forever (which would leave the account stuck "syncing"). */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms),
    ),
  ]);
}

/** Max wait for any single history-sync RPC step. */
export const SYNC_STEP_TIMEOUT_MS = 4 * 60_000;

/** All tradable symbol names on the account (RPC; used for "did you mean" hints). */
export async function fetchBrokerSymbols(metaApiId: string): Promise<string[]> {
  const api = await getMetaApi();
  const account = await api.metatraderAccountApi.getAccount(metaApiId);

  if (account.state !== 'DEPLOYED') {
    await account.waitDeployed();
  }

  const connection = account.getRPCConnection();
  try {
    await connection.connect();
    await withTimeout(connection.waitSynchronized(), SYNC_STEP_TIMEOUT_MS, 'symbol sync');
    const symbols = await connection.getSymbols();
    return Array.isArray(symbols) ? (symbols as string[]) : [];
  } finally {
    // Always close — a leaked RPC connection keeps retrying and adds to MetaApi load.
    try { await connection.close(); } catch { /* ignore */ }
  }
}

export async function removeMetaApiAccount(metaApiId: string) {
  const api = await getMetaApi();
  const account = await api.metatraderAccountApi.getAccount(metaApiId);
  await account.remove();
}
