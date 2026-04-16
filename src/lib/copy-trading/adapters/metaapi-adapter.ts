import type { CopyTradeInterface, CopyAccountInfo, CopyPlatform } from '@/types/copy-trading';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class MetaApiCopyTradeAdapter implements CopyTradeInterface {
  platform: CopyPlatform;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private connection: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(connection: any, platform: 'mt4' | 'mt5') {
    this.connection = connection;
    this.platform = platform;
  }

  async openPosition(params: {
    symbol: string;
    direction: 'BUY' | 'SELL';
    volume: number;
    stopLoss?: number;
    takeProfit?: number;
    comment?: string;
    slippage?: number;
  }): Promise<{ positionId: string }> {
    const result = params.direction === 'BUY'
      ? await this.connection.createMarketBuyOrder(
          params.symbol, params.volume, params.stopLoss, params.takeProfit,
          { comment: params.comment || 'haia-copy', slippage: params.slippage },
        )
      : await this.connection.createMarketSellOrder(
          params.symbol, params.volume, params.stopLoss, params.takeProfit,
          { comment: params.comment || 'haia-copy', slippage: params.slippage },
        );
    return { positionId: String(result.positionId || result.orderId) };
  }

  async closePosition(positionId: string): Promise<void> {
    await this.connection.closePosition(positionId);
  }

  async modifyPosition(positionId: string, params: { stopLoss?: number; takeProfit?: number }): Promise<void> {
    await this.connection.modifyPosition(positionId, params.stopLoss, params.takeProfit);
  }

  async getAccountInfo(): Promise<CopyAccountInfo> {
    const info = this.connection.terminalState.accountInformation;
    return {
      balance: info?.balance || 0,
      equity: info?.equity || 0,
      freeMargin: info?.freeMargin || 0,
    };
  }
}
