/**
 * HITL broker adapter — the single wrapper through which the HITL path touches
 * MetaApi (invariant: all MetaApi access goes through one wrapper). Extends the
 * existing trade primitives with the bits HITL needs: generic symbol specs,
 * per-leg `clientId` tagging, partial close, and position lookup by signal.
 *
 * SDK-surface note: the MetaApi streaming-connection field names below
 * (terminalState.specification / .price / .positions, order option `clientId`)
 * are isolated here on purpose. They are the only spots needing verification
 * against the live demo account during the §7 bring-up; the rest of HITL is
 * pure and tested.
 */

import type { HitlSymbolSpec } from './sizing';
import type { Direction } from './levels';

export interface HitlPosition {
  id: string;
  clientId: string | null;
  symbol: string;
  type: string;        // 'POSITION_TYPE_BUY' | 'POSITION_TYPE_SELL'
  volume: number;
  openPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  profit: number;
}

export interface OpenOrderParams {
  symbol: string;
  direction: Direction;
  volume: number;
  entryMode: 'market' | 'pending';
  openPrice?: number;       // required when entryMode === 'pending'
  stopLoss: number;
  takeProfit: number;
  clientId: string;         // hh_{alnum signalId}_{A|B}
  comment?: string;         // optional; omitted by default (combined length cap)
  slippage: number;
}

export interface HitlBroker {
  /** Demo accounts only until §7 acceptance passes — the dispatcher checks this. */
  isDemo(): boolean;
  getEquity(): number;
  /** Subscribe to a symbol so its spec/price become available in terminalState. */
  ensureSymbol(symbol: string): Promise<void>;
  getSymbolSpec(symbol: string): HitlSymbolSpec;
  getPrice(symbol: string): { bid: number; ask: number } | null;
  openOrder(params: OpenOrderParams): Promise<{ ticket: string }>;
  modifySl(ticket: string, stopLoss: number, takeProfit?: number): Promise<void>;
  partialClose(ticket: string, volume: number): Promise<void>;
  /** Live positions whose clientId belongs to this signal (prefix match). */
  positionsBySignal(signalId: string): HitlPosition[];
  /** Realized P/L for a signal's positions from the streaming history (null if unknown). */
  realizedPnl?(signalId: string, tickets: string[]): number | null;
}

// MetaApi stores clientId inside the platform comment, so it must (a) match a
// restricted pattern — alphanumerics + underscore, NO hyphens — and (b) be
// short: the clientId+comment combined length is capped (~26 chars). We send no
// separate comment and keep the tag compact. clientIdFor and signalIdPrefix
// must stay in lockstep: the prefix is how we find a signal's positions/deals.
function clientIdTag(signalId: string): string {
  const clean = signalId.replace(/[^a-zA-Z0-9]/g, '');
  return `hh_${clean.slice(0, 16)}`; // "hh_" + ≤16 + "_A" = ≤21 chars
}

export function clientIdFor(signalId: string, leg: 'A' | 'B'): string {
  return `${clientIdTag(signalId)}_${leg}`;
}

export function signalIdPrefix(signalId: string): string {
  return `${clientIdTag(signalId)}_`;
}

/**
 * Flatten a MetaApi trade error into a readable, specific message. MetaApi
 * ValidationError carries a `details` array (e.g. invalid stops, bad clientId,
 * volume out of range); the broker reject carries `stringCode`/`numericCode`.
 */
function describeBrokerError(err: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = err as any;
  const base = e?.message ? String(e.message) : String(err);
  const details = e?.details;
  if (Array.isArray(details) && details.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parts = details.map((d: any) => [d.parameter, d.message, d.value].filter((x) => x != null).join('=')).join('; ');
    return `${base} (${parts})`;
  }
  if (e?.stringCode || e?.numericCode) return `${base} [${e.stringCode ?? e.numericCode}]`;
  return base;
}

const ORDER_TYPE_BY_MODE: Record<string, Record<Direction, string>> = {
  market:  { BUY: 'ORDER_TYPE_BUY',       SELL: 'ORDER_TYPE_SELL' },
  // pending uses LIMIT when entering on a pullback toward price; the caller
  // passes openPrice and we pick LIMIT (the common HITL entry). STOP variants
  // can be added if a breakout-entry mode is introduced.
  pending: { BUY: 'ORDER_TYPE_BUY_LIMIT', SELL: 'ORDER_TYPE_SELL_LIMIT' },
};

/**
 * Build the broker adapter over a live MetaApi streaming connection.
 * `isDemoAccount` comes from the MetaApi account object (`account.type` →
 * 'cloud' demo vs live, resolved by the worker before calling this).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildHitlBroker(connection: any, isDemoAccount: boolean): HitlBroker {
  const term = () => connection.terminalState;

  return {
    isDemo() {
      return isDemoAccount;
    },

    getEquity() {
      const info = term()?.accountInformation;
      if (!info) throw new Error('account information not yet synchronized');
      return info.equity;
    },

    async ensureSymbol(symbol) {
      let subErr: string | null = null;
      try {
        await connection.subscribeToMarketData(symbol);
      } catch (err) {
        subErr = err instanceof Error ? err.message : String(err);
        console.warn(`[hitl/broker] subscribeToMarketData(${symbol}) failed:`, subErr);
      }
      // The specification lands in terminalState asynchronously after the
      // subscribe (sync lag) — especially the first time a symbol is touched.
      // Reading it synchronously races and returns undefined, so poll briefly.
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline) {
        if (term()?.specification(symbol)) return;
        await new Promise((r) => setTimeout(r, 250));
      }
      // Never materialised — surface why; the caller appends close-match hints.
      const hint = subErr ? `broker rejected the symbol (${subErr})` : 'the broker may list it under a different name';
      throw new Error(`symbol "${symbol}" is not available: ${hint}`);
    },

    getSymbolSpec(symbol) {
      const spec = term()?.specification(symbol);
      if (!spec) throw new Error(`symbol specification unavailable for ${symbol}`);
      // Field mapping (verify on demo): MetaApi exposes tickSize, minVolume,
      // maxVolume, volumeStep. tickValue may be absent → derive from
      // contractSize × tickSize as a CFD-safe fallback.
      const tickSize = Number(spec.tickSize);
      const tickValue =
        spec.tickValue != null ? Number(spec.tickValue)
        : spec.contractSize != null ? Number(spec.contractSize) * tickSize
        : tickSize;
      return {
        tickValue,
        tickSize,
        volumeMin: Number(spec.minVolume),
        volumeMax: Number(spec.maxVolume),
        volumeStep: Number(spec.volumeStep),
      };
    },

    getPrice(symbol) {
      const p = term()?.price(symbol);
      return p ? { bid: Number(p.bid), ask: Number(p.ask) } : null;
    },

    async openOrder(params) {
      const type = ORDER_TYPE_BY_MODE[params.entryMode][params.direction];
      // Send only clientId (+ slippage). Omit comment unless explicitly set —
      // MetaApi caps the combined clientId+comment length.
      const opts: { clientId: string; slippage: number; comment?: string } = {
        clientId: params.clientId,
        slippage: params.slippage,
      };
      if (params.comment) opts.comment = params.comment;
      let result;
      try {
        switch (type) {
          case 'ORDER_TYPE_BUY':
            result = await connection.createMarketBuyOrder(params.symbol, params.volume, params.stopLoss, params.takeProfit, opts);
            break;
          case 'ORDER_TYPE_SELL':
            result = await connection.createMarketSellOrder(params.symbol, params.volume, params.stopLoss, params.takeProfit, opts);
            break;
          case 'ORDER_TYPE_BUY_LIMIT':
            result = await connection.createLimitBuyOrder(params.symbol, params.volume, params.openPrice, params.stopLoss, params.takeProfit, opts);
            break;
          case 'ORDER_TYPE_SELL_LIMIT':
            result = await connection.createLimitSellOrder(params.symbol, params.volume, params.openPrice, params.stopLoss, params.takeProfit, opts);
            break;
          default:
            throw new Error(`unsupported order type ${type}`);
        }
      } catch (err) {
        // Surface MetaApi's specific validation details instead of a bare "Validation failed".
        throw new Error(describeBrokerError(err));
      }
      // Anything but a confirmed result is a failure (fail-closed).
      const ticket = result?.positionId || result?.orderId;
      if (!ticket || (result?.stringCode && result.stringCode !== 'TRADE_RETCODE_DONE' && result.stringCode !== 'ERR_NO_ERROR')) {
        throw new Error(`order not confirmed DONE (code=${result?.stringCode ?? 'none'})`);
      }
      return { ticket: String(ticket) };
    },

    async modifySl(ticket, stopLoss, takeProfit) {
      await connection.modifyPosition(ticket, stopLoss, takeProfit);
    },

    async partialClose(ticket, volume) {
      await connection.closePositionPartially(ticket, volume);
    },

    positionsBySignal(signalId) {
      const prefix = signalIdPrefix(signalId);
      const positions = term()?.positions ?? [];
      return positions
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((p: any) => typeof p.clientId === 'string' && p.clientId.startsWith(prefix))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((p: any): HitlPosition => ({
          id: String(p.id),
          clientId: p.clientId ?? null,
          symbol: p.symbol,
          type: p.type,
          volume: Number(p.volume),
          openPrice: Number(p.openPrice),
          stopLoss: p.stopLoss != null ? Number(p.stopLoss) : null,
          takeProfit: p.takeProfit != null ? Number(p.takeProfit) : null,
          profit: Number(p.profit ?? 0),
        }));
    },

    realizedPnl(signalId, tickets) {
      // Use the streaming connection's in-memory history storage — it's already
      // synchronised and receives close deals live, so no extra RPC connection
      // (which is slow and often returns empty right after a close).
      const hs = connection.historyStorage;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const deals: any[] = hs?.deals ?? [];
      if (deals.length === 0) return null;

      const prefix = signalIdPrefix(signalId);
      // Candidate position ids: the tickets we recorded at open, PLUS any
      // discovered from entry deals carrying our clientId (close deals — TP/SL —
      // don't carry it, but share the positionId).
      const ids = new Set(tickets.map(String));
      for (const d of deals) {
        if (typeof d.clientId === 'string' && d.clientId.startsWith(prefix) && d.positionId != null) {
          ids.add(String(d.positionId));
        }
      }

      const matched = deals.filter((d) => d.positionId != null && ids.has(String(d.positionId)));
      if (matched.length === 0) return null;
      return matched.reduce((sum, d) => sum + Number(d.profit ?? 0) + Number(d.commission ?? 0) + Number(d.swap ?? 0), 0);
    },
  };
}
