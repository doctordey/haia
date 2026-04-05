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
    await account.waitDeployed();
  }

  const connection = account.getRPCConnection();
  await connection.connect();
  await connection.waitSynchronized();

  const response = await connection.getDealsByTimeRange(startDate, endDate);
  await connection.close();

  // MetaAPI returns { deals: [...], synchronizing: boolean }, extract the array
  return response?.deals || response || [];
}

export async function removeMetaApiAccount(metaApiId: string) {
  const api = await getMetaApi();
  const account = await api.metatraderAccountApi.getAccount(metaApiId);
  await account.remove();
}
