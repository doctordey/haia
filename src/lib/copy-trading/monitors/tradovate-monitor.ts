import type { MasterMonitor, MasterPositionEvent } from '@/types/copy-trading';
import { TradovateClient } from '../adapters/tradovate-client';
import type { TradovateCredentials } from '@/types/copy-trading';

/**
 * Tradovate uses a net-position model: one position per contract symbol.
 * We track net position changes to emit open/close events.
 * Net goes from 0 → +2 = "open 2 BUY". +2 → 0 = "close 2 BUY".
 */
interface NetPosition {
  symbol: string;
  contractId: number;
  netPos: number;         // positive = long, negative = short
  netPrice: number;       // average entry price
}

export class TradovateMasterMonitor implements MasterMonitor {
  platform = 'tradovate' as const;
  accountId: string;
  private client: TradovateClient;
  private tradovateAccountId: number;
  private netPositions = new Map<string, NetPosition>();

  onPositionOpen: ((event: MasterPositionEvent) => void) | null = null;
  onPositionClose: ((event: MasterPositionEvent) => void) | null = null;
  onPositionModify: ((event: MasterPositionEvent) => void) | null = null;

  constructor(accountId: string, credentials: TradovateCredentials, tradovateAccountId: number) {
    this.accountId = accountId;
    this.client = new TradovateClient(credentials);
    this.tradovateAccountId = tradovateAccountId;
  }

  async start(): Promise<void> {
    await this.client.authenticate();

    // Load initial positions
    const positions = await this.client.getPositions();
    for (const pos of positions) {
      if (pos.accountId !== this.tradovateAccountId) continue;
      if (pos.netPos === 0) continue;
      this.netPositions.set(pos.contractId.toString(), {
        symbol: pos.contractId.toString(),
        contractId: pos.contractId,
        netPos: pos.netPos,
        netPrice: pos.netPrice || 0,
      });
    }
    console.log(`[copy-master:${this.accountId}] Loaded ${this.netPositions.size} initial positions`);

    // Connect WebSocket for real-time updates
    await this.client.connectWebSocket();

    // Listen for position updates
    this.client.onEntity('position', (data) => {
      if (!data || data.accountId !== this.tradovateAccountId) return;
      this.handlePositionUpdate(data);
    });

    // Listen for fill events for more detailed open/close detection
    this.client.onEntity('fill', (data) => {
      if (!data || data.accountId !== this.tradovateAccountId) return;
      this.handleFill(data);
    });

    console.log(`[copy-master:${this.accountId}] Monitoring active (tradovate)`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handlePositionUpdate(pos: any): void {
    const key = String(pos.contractId);
    const previous = this.netPositions.get(key);
    const prevNet = previous?.netPos || 0;
    const newNet = pos.netPos || 0;

    if (prevNet === newNet) return;

    // Resolve symbol from contract — use cached or the contractId as fallback
    const symbol = pos.contractId?.toString() || key;

    if (prevNet === 0 && newNet !== 0) {
      // New position opened
      this.netPositions.set(key, {
        symbol,
        contractId: pos.contractId,
        netPos: newNet,
        netPrice: pos.netPrice || 0,
      });
      this.onPositionOpen?.({
        type: 'open',
        positionId: key,
        symbol,
        direction: newNet > 0 ? 'BUY' : 'SELL',
        lots: Math.abs(newNet),
        entryPrice: pos.netPrice || 0,
        timestamp: new Date(),
        platform: 'tradovate',
      });
    } else if (newNet === 0 && prevNet !== 0) {
      // Position fully closed
      this.netPositions.delete(key);
      this.onPositionClose?.({
        type: 'close',
        positionId: key,
        symbol,
        direction: prevNet > 0 ? 'BUY' : 'SELL',
        lots: Math.abs(prevNet),
        entryPrice: previous?.netPrice || 0,
        closePrice: pos.netPrice || 0,
        timestamp: new Date(),
        platform: 'tradovate',
      });
    } else if (Math.sign(prevNet) === Math.sign(newNet) && Math.abs(newNet) < Math.abs(prevNet)) {
      // Partial close
      const closedQty = Math.abs(prevNet) - Math.abs(newNet);
      this.netPositions.set(key, {
        symbol,
        contractId: pos.contractId,
        netPos: newNet,
        netPrice: pos.netPrice || 0,
      });
      this.onPositionClose?.({
        type: 'close',
        positionId: key,
        symbol,
        direction: prevNet > 0 ? 'BUY' : 'SELL',
        lots: closedQty,
        entryPrice: previous?.netPrice || 0,
        closePrice: pos.netPrice || 0,
        timestamp: new Date(),
        platform: 'tradovate',
      });
    } else if (Math.sign(prevNet) === Math.sign(newNet) && Math.abs(newNet) > Math.abs(prevNet)) {
      // Added to position
      const addedQty = Math.abs(newNet) - Math.abs(prevNet);
      this.netPositions.set(key, {
        symbol,
        contractId: pos.contractId,
        netPos: newNet,
        netPrice: pos.netPrice || 0,
      });
      this.onPositionOpen?.({
        type: 'open',
        positionId: key,
        symbol,
        direction: newNet > 0 ? 'BUY' : 'SELL',
        lots: addedQty,
        entryPrice: pos.netPrice || 0,
        timestamp: new Date(),
        platform: 'tradovate',
      });
    } else if (Math.sign(prevNet) !== Math.sign(newNet)) {
      // Position flipped (close + open opposite)
      this.onPositionClose?.({
        type: 'close',
        positionId: key,
        symbol,
        direction: prevNet > 0 ? 'BUY' : 'SELL',
        lots: Math.abs(prevNet),
        entryPrice: previous?.netPrice || 0,
        closePrice: pos.netPrice || 0,
        timestamp: new Date(),
        platform: 'tradovate',
      });
      this.netPositions.set(key, {
        symbol,
        contractId: pos.contractId,
        netPos: newNet,
        netPrice: pos.netPrice || 0,
      });
      this.onPositionOpen?.({
        type: 'open',
        positionId: key,
        symbol,
        direction: newNet > 0 ? 'BUY' : 'SELL',
        lots: Math.abs(newNet),
        entryPrice: pos.netPrice || 0,
        timestamp: new Date(),
        platform: 'tradovate',
      });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleFill(_fill: any): void {
    // Fills provide more granular info (exact fill price, timestamp).
    // Position updates already handle the core open/close logic.
    // This handler can be extended for fill-level audit logging.
  }

  async stop(): Promise<void> {
    await this.client.disconnect();
    this.netPositions.clear();
  }

  getClient(): TradovateClient { return this.client; }
}
