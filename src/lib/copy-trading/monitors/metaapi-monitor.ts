import type { MasterMonitor, MasterPositionEvent } from '@/types/copy-trading';
import { getMetaApiInstance } from '@/lib/metaapi';

export class MetaApiMasterMonitor implements MasterMonitor {
  platform: 'mt4' | 'mt5';
  accountId: string;
  private metaApiId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private connection: any = null;
  private knownPositions = new Map<string, { sl?: number; tp?: number }>();
  private isSynchronized = false;

  onPositionOpen: ((event: MasterPositionEvent) => void) | null = null;
  onPositionClose: ((event: MasterPositionEvent) => void) | null = null;
  onPositionModify: ((event: MasterPositionEvent) => void) | null = null;

  constructor(accountId: string, metaApiId: string, platform: 'mt4' | 'mt5') {
    this.accountId = accountId;
    this.metaApiId = metaApiId;
    this.platform = platform;
  }

  async start(): Promise<void> {
    const api = getMetaApiInstance('signals');
    const account = await api.metatraderAccountApi.getAccount(this.metaApiId);

    if (account.state !== 'DEPLOYED') {
      console.log(`[copy-master:${this.accountId}] Waiting for deployment...`);
      await account.waitDeployed();
    }
    if (account.connectionStatus !== 'CONNECTED') {
      console.log(`[copy-master:${this.accountId}] Waiting for broker connection...`);
      await account.waitConnected();
    }

    this.connection = account.getStreamingConnection();

    const noopListener: Record<string, (...args: unknown[]) => void> = {};
    const methods = [
      'onAccountInformationUpdated', 'onBooksUpdated', 'onBrokerConnectionStatusChanged',
      'onCandlesUpdated', 'onConnected', 'onDealAdded', 'onDealsSynchronized',
      'onDisconnected', 'onHealthStatus', 'onHistoryOrderAdded', 'onHistoryOrdersSynchronized',
      'onPendingOrderCompleted', 'onPendingOrderUpdated', 'onPendingOrdersReplaced',
      'onPendingOrdersSynchronized', 'onPendingOrdersUpdated', 'onPositionRemoved',
      'onPositionUpdated', 'onPositionsReplaced', 'onPositionsSynchronized', 'onPositionsUpdated',
      'onStreamClosed', 'onSubscriptionDowngraded', 'onSymbolPriceUpdated', 'onSymbolPricesUpdated',
      'onSymbolSpecificationRemoved', 'onSymbolSpecificationUpdated', 'onSymbolSpecificationsUpdated',
      'onSynchronizationStarted', 'onTicksUpdated', 'onUnsubscribeRegion',
    ];
    for (const m of methods) noopListener[m] = () => {};

    this.connection.addSynchronizationListener({
      ...noopListener,

      onDealAdded: (_instanceIndex: string, deal: {
        positionId?: string; symbol?: string; type?: string; entryType?: string;
        volume?: number; price?: number; profit?: number; reason?: string;
        stopLoss?: number; takeProfit?: number;
      }) => {
        // Skip historical deals replayed during initial sync
        if (!this.isSynchronized) return;

        console.log(`[copy-monitor:${this.accountId}] Deal: symbol=${deal.symbol} type=${deal.type} entry=${deal.entryType} posId=${deal.positionId} vol=${deal.volume} price=${deal.price}`);

        if (!deal.positionId || !deal.symbol) return;
        if (deal.type === 'DEAL_TYPE_BALANCE') return;
        const posId = String(deal.positionId);
        const direction: 'BUY' | 'SELL' = deal.type === 'DEAL_TYPE_BUY' ? 'BUY' : 'SELL';

        if (deal.entryType === 'DEAL_ENTRY_IN') {
          this.knownPositions.set(posId, { sl: deal.stopLoss, tp: deal.takeProfit });
          this.onPositionOpen?.({
            type: 'open',
            positionId: posId,
            symbol: deal.symbol,
            direction,
            lots: deal.volume || 0,
            entryPrice: deal.price || 0,
            stopLoss: deal.stopLoss,
            takeProfit: deal.takeProfit,
            timestamp: new Date(),
            platform: this.platform,
          });
        } else if (deal.entryType === 'DEAL_ENTRY_OUT') {
          this.knownPositions.delete(posId);
          this.onPositionClose?.({
            type: 'close',
            positionId: posId,
            symbol: deal.symbol,
            direction,
            lots: deal.volume || 0,
            entryPrice: deal.price || 0,
            closePrice: deal.price,
            timestamp: new Date(),
            platform: this.platform,
          });
        }
      },

      onPositionUpdated: (_instanceIndex: string, position: {
        id?: string; symbol?: string; type?: string;
        volume?: number; openPrice?: number; stopLoss?: number; takeProfit?: number;
      }) => {
        if (!this.isSynchronized) return;
        if (!position.id || !position.symbol) return;
        const posId = String(position.id);
        const known = this.knownPositions.get(posId);
        if (!known) return;

        const slChanged = position.stopLoss !== known.sl;
        const tpChanged = position.takeProfit !== known.tp;
        if (!slChanged && !tpChanged) return;

        const previousSl = known.sl;
        const previousTp = known.tp;
        known.sl = position.stopLoss;
        known.tp = position.takeProfit;

        this.onPositionModify?.({
          type: 'modify',
          positionId: posId,
          symbol: position.symbol,
          direction: position.type === 'POSITION_TYPE_BUY' ? 'BUY' : 'SELL',
          lots: position.volume || 0,
          entryPrice: position.openPrice || 0,
          stopLoss: position.stopLoss,
          takeProfit: position.takeProfit,
          previousSl,
          previousTp,
          timestamp: new Date(),
          platform: this.platform,
        });
      },

      onConnected: () => {
        console.log(`[copy-master:${this.accountId}] Connected`);
      },
      onDisconnected: () => {
        console.log(`[copy-master:${this.accountId}] Disconnected — auto-reconnecting`);
      },
      onBrokerConnectionStatusChanged: (_i: string, connected: boolean) => {
        console.log(`[copy-master:${this.accountId}] Broker: ${connected ? 'connected' : 'disconnected'}`);
      },
      onDealsSynchronized: () => {
        this.isSynchronized = true;
        console.log(`[copy-master:${this.accountId}] Deals synchronized — now monitoring for new trades only`);
      },
    });

    await this.connection.connect();
    await this.connection.waitSynchronized({ timeoutInSeconds: 120 });
    console.log(`[copy-master:${this.accountId}] Monitoring active (${this.platform})`);
  }

  async stop(): Promise<void> {
    if (this.connection) {
      try { await this.connection.close(); } catch {}
      this.connection = null;
    }
    this.knownPositions.clear();
  }
}
