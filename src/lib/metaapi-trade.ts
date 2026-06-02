// On-demand MetaApi RPC trade interface. The signal-listener worker keeps a
// persistent streaming connection per account; this helper is for callers
// (like the TradingView webhook) that need to place a single order without
// requiring the worker to be running. RPC connections open quickly, place
// the order, and close.

import type { MetaApiTradeInterface } from '@/types/signals';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getRpcConnection(metaApiId: string): Promise<{ connection: any; close: () => Promise<void> }> {
  if (!process.env.METAAPI_TOKEN) {
    throw new Error('METAAPI_TOKEN environment variable is not set');
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const MetaApi = require('metaapi.cloud-sdk').default;
  const api = new MetaApi(process.env.METAAPI_TOKEN);
  const account = await api.metatraderAccountApi.getAccount(metaApiId);

  if (account.state !== 'DEPLOYED') {
    await account.waitDeployed();
  }

  const connection = account.getRPCConnection();
  await connection.connect();
  await connection.waitSynchronized();

  return {
    connection,
    close: async () => {
      try {
        await connection.close();
      } catch {
        // Best-effort close — RPC connections clean up on idle anyway.
      }
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildInterface(connection: any): MetaApiTradeInterface {
  return {
    async createOrder(params) {
      const { symbol, type, volume, openPrice, stopLoss, takeProfit, comment, slippage } = params;
      const opts = { comment, slippage };
      let result;
      switch (type) {
        case 'ORDER_TYPE_BUY':
          result = await connection.createMarketBuyOrder(symbol, volume, stopLoss, takeProfit, opts);
          break;
        case 'ORDER_TYPE_SELL':
          result = await connection.createMarketSellOrder(symbol, volume, stopLoss, takeProfit, opts);
          break;
        case 'ORDER_TYPE_BUY_LIMIT':
          result = await connection.createLimitBuyOrder(symbol, volume, openPrice, stopLoss, takeProfit, opts);
          break;
        case 'ORDER_TYPE_SELL_LIMIT':
          result = await connection.createLimitSellOrder(symbol, volume, openPrice, stopLoss, takeProfit, opts);
          break;
        case 'ORDER_TYPE_BUY_STOP':
          result = await connection.createStopBuyOrder(symbol, volume, openPrice, stopLoss, takeProfit, opts);
          break;
        case 'ORDER_TYPE_SELL_STOP':
          result = await connection.createStopSellOrder(symbol, volume, openPrice, stopLoss, takeProfit, opts);
          break;
        default:
          throw new Error(`Unknown order type: ${type}`);
      }
      return { orderId: result.positionId || result.orderId || 'unknown' };
    },
    async cancelOrder(orderId) {
      await connection.cancelOrder(orderId);
    },
    async modifyPosition(positionId, params) {
      await connection.modifyPosition(positionId, params.stopLoss, params.takeProfit);
    },
    async closePosition(positionId) {
      await connection.closePosition(positionId);
    },
    async closePositionPartially(positionId, volume) {
      await connection.closePositionPartially(positionId, volume);
    },
    async calculateMargin(params) {
      const result = await connection.calculateMargin(params);
      return { margin: result.margin };
    },
    async getAccountInformation() {
      const info = await connection.getAccountInformation();
      return { balance: info.balance, equity: info.equity, freeMargin: info.freeMargin };
    },
  };
}

/**
 * Run `fn` with a temporary MetaApi RPC trade interface, then close the
 * connection. Throws if METAAPI_TOKEN is missing or the account is not deployed.
 */
export async function withRpcTrade<T>(
  metaApiId: string,
  fn: (api: MetaApiTradeInterface) => Promise<T>,
): Promise<T> {
  const { connection, close } = await getRpcConnection(metaApiId);
  try {
    return await fn(buildInterface(connection));
  } finally {
    await close();
  }
}
