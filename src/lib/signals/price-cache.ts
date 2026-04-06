import type { OffsetData, PriceCache as IPriceCache } from '@/types/signals';

export interface CachedPrice {
  bid: number;
  ask: number;
  mid: number;
  updatedAt: number;
}

export interface CachedOffset {
  nqOffset: number;
  esOffset: number;
  nqFuturesPrice: number;
  esFuturesPrice: number;
  nas100Price: number;
  us500Price: number;
  nqOffsetSma: number;
  esOffsetSma: number;
  receivedAt: number;
  tradingviewTimestamp: string;
}

const PRICE_MAX_AGE_MS = 10_000;       // 10s staleness for CFD prices
const OFFSET_MAX_AGE_MS = 86_400_000;  // 24h staleness for offset

// Contract roll detection thresholds
const NQ_ROLL_JUMP_THRESHOLD = 100;  // points
const ES_ROLL_JUMP_THRESHOLD = 30;   // points

export class PriceCache implements IPriceCache {
  private prices = new Map<string, CachedPrice>();
  private offset: CachedOffset | null = null;
  private _contractRollDetected = false;
  private _contractRollMessage = '';

  // ── CFD Prices (from MetaApi WebSocket) ──

  setPrice(key: string, bid: number, ask: number): void {
    this.prices.set(key, {
      bid,
      ask,
      mid: (bid + ask) / 2,
      updatedAt: Date.now(),
    });
  }

  getPrice(key: string): CachedPrice | null {
    const cached = this.prices.get(key);
    if (!cached || Date.now() - cached.updatedAt > PRICE_MAX_AGE_MS) return null;
    return cached;
  }

  // ── Offsets (from TradingView Webhook) ──

  setOffset(data: CachedOffset): void {
    // Contract roll detection: check for abnormal jump
    if (this.offset) {
      const nqJump = Math.abs(data.nqOffset - this.offset.nqOffset);
      const esJump = Math.abs(data.esOffset - this.offset.esOffset);

      if (nqJump > NQ_ROLL_JUMP_THRESHOLD) {
        this._contractRollDetected = true;
        this._contractRollMessage =
          `Contract roll detected on NQ. Offset jumped from +${this.offset.nqOffset.toFixed(1)} to +${data.nqOffset.toFixed(1)} (${nqJump.toFixed(1)}pt change).`;
        console.warn(`[price-cache] ${this._contractRollMessage}`);
      }
      if (esJump > ES_ROLL_JUMP_THRESHOLD) {
        this._contractRollDetected = true;
        this._contractRollMessage =
          `Contract roll detected on ES. Offset jumped from +${this.offset.esOffset.toFixed(1)} to +${data.esOffset.toFixed(1)} (${esJump.toFixed(1)}pt change).`;
        console.warn(`[price-cache] ${this._contractRollMessage}`);
      }
    }

    this.offset = data;
  }

  get contractRollDetected(): boolean { return this._contractRollDetected; }
  get contractRollMessage(): string { return this._contractRollMessage; }
  clearContractRoll(): void { this._contractRollDetected = false; this._contractRollMessage = ''; }

  getOffset(): OffsetData | null {
    if (!this.offset || Date.now() - this.offset.receivedAt > OFFSET_MAX_AGE_MS) return null;
    return {
      nqOffset: this.offset.nqOffset,
      esOffset: this.offset.esOffset,
      nqFuturesPrice: this.offset.nqFuturesPrice,
      esFuturesPrice: this.offset.esFuturesPrice,
      nas100Price: this.offset.nas100Price,
      us500Price: this.offset.us500Price,
      receivedAt: this.offset.receivedAt,
    };
  }

  getOffsetAge(): number | null {
    return this.offset ? Date.now() - this.offset.receivedAt : null;
  }

  getOffsetRaw(): CachedOffset | null {
    return this.offset;
  }

  // ── IPriceCache interface ──

  getFusionPrice(symbol: string): number | null {
    const cached = this.getPrice(symbol);
    return cached ? cached.mid : null;
  }
}

// Singleton for the worker process
export const priceCache = new PriceCache();
