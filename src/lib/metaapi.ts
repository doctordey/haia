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

  // Fetch account info (balance/equity)
  const accountInfo = await connection.getAccountInformation().catch(() => null);

  // Paginate through all deals (SDK defaults to 1000 per page)
  const PAGE_SIZE = 1000;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allDeals: any[] = [];
  let offset = 0;

  while (true) {
    const response = await connection.getDealsByTimeRange(startDate, endDate, offset, PAGE_SIZE);
    const pageDels = response?.deals || [];
    if (!Array.isArray(pageDels) || pageDels.length === 0) break;
    allDeals.push(...pageDels);
    if (pageDels.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  await connection.close();

  console.log(`[metaapi] Fetched ${allDeals.length} deals (${Math.ceil(allDeals.length / PAGE_SIZE)} pages)`);

  return { deals: allDeals, accountInfo };
}

export async function removeMetaApiAccount(metaApiId: string) {
  const api = await getMetaApi();
  const account = await api.metatraderAccountApi.getAccount(metaApiId);
  await account.remove();
}
