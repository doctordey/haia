import type { CopyTradeInterface, CopyAccountInfo } from '@/types/copy-trading';
import { TradovateClient } from './tradovate-client';

export class TradovateCopyTradeAdapter implements CopyTradeInterface {
  platform = 'tradovate' as const;
  private client: TradovateClient;
  private accountId: number;

  constructor(client: TradovateClient, accountId: number) {
    this.client = client;
    this.accountId = accountId;
  }

  async openPosition(params: {
    symbol: string;
    direction: 'BUY' | 'SELL';
    volume: number;
    stopLoss?: number;
    takeProfit?: number;
    comment?: string;
  }): Promise<{ positionId: string }> {
    // Volume must be an integer for Tradovate (contracts, not fractional lots)
    const qty = Math.max(1, Math.round(params.volume));

    if (params.stopLoss || params.takeProfit) {
      const result = await this.client.placeBracketOrder({
        accountId: this.accountId,
        action: params.direction === 'BUY' ? 'Buy' : 'Sell',
        symbol: params.symbol,
        orderQty: qty,
        stopLoss: params.stopLoss ? Math.abs(params.stopLoss) : undefined,
        profitTarget: params.takeProfit ? Math.abs(params.takeProfit) : undefined,
      });
      return { positionId: String(result.orderId || result.orderStrategyId) };
    }

    const result = await this.client.placeOrder({
      accountId: this.accountId,
      action: params.direction === 'BUY' ? 'Buy' : 'Sell',
      symbol: params.symbol,
      orderQty: qty,
    });
    return { positionId: String(result.orderId) };
  }

  async closePosition(positionId: string): Promise<void> {
    const contractId = parseInt(positionId, 10);
    if (isNaN(contractId)) {
      throw new Error(`Invalid Tradovate position/contract ID: ${positionId}`);
    }
    await this.client.liquidatePosition(this.accountId, contractId);
  }

  async modifyPosition(_positionId: string, params: { stopLoss?: number; takeProfit?: number }): Promise<void> {
    const orderId = parseInt(_positionId, 10);
    if (isNaN(orderId)) return;
    await this.client.modifyOrder(orderId, {
      stopPrice: params.stopLoss,
      price: params.takeProfit,
    });
  }

  async getAccountInfo(): Promise<CopyAccountInfo> {
    const account = await this.client.getAccount(this.accountId);
    const cashBalances = await this.client.getCashBalances();
    const accountCash = cashBalances.find((cb: { accountId: number }) => cb.accountId === this.accountId);
    const balance = accountCash?.amount || 0;
    return {
      balance,
      equity: account?.marginUsed != null ? balance - account.marginUsed : balance,
      freeMargin: account?.availableMargin || balance,
    };
  }
}
