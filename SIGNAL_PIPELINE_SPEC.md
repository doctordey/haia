# Haia — Signal Copier & Trade Journal Module

## Design Specification v2.4

**Date:** April 4, 2026
**Author:** Brandon Dey + Claude
**Target:** Native integration into Haia web app (Railway)
**Repo:** github.com/doctordey/haia

---

## 1. Product Overview

This module adds three connected features to Haia:

**Signal Copier** — An automated pipeline that listens for trading signals from a Telegram channel (NQ and ES futures signals), applies real-time price offsets to convert futures prices to Fusion Markets CFD prices (NQ→NAS100, ES→US500), determines the correct order type (market, limit, or stop), and executes the trades on Fusion Markets via MetaApi Cloud — all within 2 seconds.

**Trade Journal** — A per-trade annotation system where users can log their reasoning, attach screenshots, tag setups, and review performance by setup type. Works for both signal-copied trades and manually placed trades.

**Access Control** — Both features are gated behind a role-based permission system. Only users with the `signals` role can access the Signal Copier. This allows Haia to be a public analytics platform while keeping the signal pipeline private to authorized users.

---

## 2. Instrument Mapping

The signal bot sends both NQ (Nasdaq) and ES (S&P 500) futures signals. Both are executed on Fusion Markets.

| Bot Signal | CME Futures Contract | Fusion Markets CFD | Underlying Index |
|---|---|---|---|
| **NQ** | NQM2026 (E-mini Nasdaq 100) | **NAS100** | Nasdaq 100 (NDX) |
| **ES** | ESM2026 (E-mini S&P 500) | **US500** | S&P 500 (SPX) |

Each instrument has its own independent futures basis (offset) that must be calculated and tracked separately:

| Property | NQ → NAS100 | ES → US500 |
|---|---|---|
| Current offset (approx.) | ~198 points | ~30–50 points |
| Offset direction | NQ trades higher than NAS100 | ES trades higher than US500 |
| TradingView spread chart | `CME_MINI:NQM2026 - FUSIONMARKETS:NAS100` | `CME_MINI:ESM2026 - FUSIONMARKETS:US500` |
| Contract expiry | June 20, 2026 | June 20, 2026 |
| Next contract | NQU2026 (September) | ESU2026 (September) |

---

## 3. Architecture Fit

### What Already Exists in Haia

| Component | Status | Relevance |
|---|---|---|
| Next.js 16 App Router | Built | Signal pages go under `src/app/(app)/signals/` |
| MetaApi Cloud SDK (v29.3.3) | Installed | Reuse for order execution and price streaming |
| Drizzle ORM + PostgreSQL | Built | New tables for signals, executions, journal entries |
| NextAuth v5 | Built | Extend with role/permission claims |
| Trade sync worker | Built | Signal listener runs alongside it |
| Tailwind dark theme | Built | Signal UI uses existing design tokens |
| Recharts | Installed | Visualize signal performance and offset charts |
| Zustand stores | Built | Add signalStore for real-time state |

### What Needs to Be Added

| Component | Package | Purpose |
|---|---|---|
| Telegram listener | `telegram` (gramjs) | MTProto client to listen to signal channels |
| Price cache | In-memory (Node.js Map) | Cache MetaApi streaming prices for instant offset calc |

---

## 4. Execution Speed Analysis

**Target: Signal receipt → order filled in under 2 seconds.**

| Step | Method | Latency |
|---|---|---|
| Signal received | Telegram MTProto push | ~100ms |
| Message parsed | Regex on server | ~5ms |
| Fusion price fetched (per instrument) | MetaApi WebSocket (cached) | ~50ms |
| Futures price fetched (per instrument) | MetaApi WebSocket (cached) | ~50ms |
| Offset calculated | Arithmetic | ~1ms |
| Order type determined | Price comparison | ~1ms |
| Order sent via MetaApi | REST API call | 200–500ms |
| **Total per instrument** | | **~400–700ms** |

With two instruments (NQ + ES), orders are sent in parallel. Total wall-clock time remains under 1 second.

**Why MetaApi Cloud over a Windows VPS:**
- Already in the Haia stack (no new infrastructure)
- REST/WebSocket API works from Railway's Linux containers
- Supports real-time price streaming via WebSocket for the price cache
- No Windows dependency, no MT5 terminal to manage

---

## 5. Signal Message Format (Calibrated)

### Message Types

The Telegram bot sends six distinct message types:

| Type | Example | Pipeline Action |
|---|---|---|
| **New Signals** | "🟢 LONG NQ @ 24,060 ..." | Parse all signals → Execute NQ on NAS100, ES on US500 |
| **Cancel All** | "❌ ALL POSITIONS CANCELLED" | Cancel all pending orders |
| **Cancel Specific** | "❌ Trade 3 — ... CANCELLED" | Cancel pending order for that trade number |
| **TP Hit** | "🟢 LONG NQ @ 23,411 → TP2 23,470 ✅" | Log only, no execution |
| **Warning** | "⚠️ HIGH RISK — ..." | Log warning, still execute signals in same message |
| **Unknown** | Any other text | Log raw message, skip |

### Signal Message Structure

A single message can contain multiple trades, each with both NQ and ES entries:

```
Trade 1                              ← Trade header
🟢 LONG NQ @ 24,060                 ← NQ signal (execute on NAS100)
TP1: 24,088
TP2: 24,160
SL: 24,020
Size: Medium
🟢 LONG ES @ 6,606                  ← ES signal (execute on US500)
TP1: 6,634
TP2: 6,660
SL: 6,596
Size: Medium
Trade 2                              ← Second trade in same message
🟢 LONG NQ @ 24,000
TP1: 24,088
TP2: 24,160
SL: 23,960
Size: Medium
🟢 LONG ES @ 6,583
...
```

### Key Observations

1. **LONG/SHORT terminology** (not BUY/SELL) with colored emoji indicators (🟢/🔴)
2. **Comma-formatted prices** ("24,060" not "24060")
3. **Size parameter** maps to lot size tiers: Small, Medium, Large
4. **Two TPs per signal** (TP1 and TP2)
5. **Cancellations can be all-or-nothing** or trade-specific

---

## 6. Parsed Data Structures

```typescript
// src/types/signals.ts

interface ParsedSignal {
  tradeNumber: number;              // 1, 2, 3 etc.
  instrument: 'NQ' | 'ES';
  direction: 'LONG' | 'SHORT';     // Maps to BUY / SELL for execution
  entryPrice: number;
  tp1: number;
  tp2: number;
  stopLoss: number;
  size: 'Small' | 'Medium' | 'Large';
}

interface ParsedCancellation {
  type: 'cancel_all' | 'cancel_specific';
  tradeNumber?: number;
  reason?: string;
}

interface ParsedTPHit {
  instrument: 'NQ' | 'ES';
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  tpLevel: string;                  // "TP1" or "TP2"
  tpPrice: number;
  profitPoints: number;
}

type ParsedMessage =
  | { type: 'signals'; signals: ParsedSignal[]; warning?: string }
  | { type: 'cancellation'; cancellation: ParsedCancellation }
  | { type: 'tp_hit'; hits: ParsedTPHit[] }
  | { type: 'unknown'; raw: string };

// Instrument → Fusion symbol mapping
const INSTRUMENT_MAP: Record<string, { fusionSymbol: string; futuresTicker: string }> = {
  NQ: { fusionSymbol: 'NAS100', futuresTicker: 'NQ=F' },
  ES: { fusionSymbol: 'US500', futuresTicker: 'ES=F' },
};
```

---

## 7. Signal Parser Implementation

```typescript
// src/lib/signals/parser.ts

function cleanPrice(s: string): number {
  return parseFloat(s.replace(/,/g, ''));
}

// ─── REGEX PATTERNS ──────────────────────────────────────────

// Single instrument signal block:
//   🟢 LONG NQ @ 24,060
//   TP1: 24,088
//   TP2: 24,160
//   SL: 24,020
//   Size: Medium
const SIGNAL_BLOCK_RE = new RegExp(
  '(?:🟢|🔴)\\s*' +
  '(LONG|SHORT)\\s+' +
  '(NQ|ES)\\s*@\\s*' +
  '([\\d,]+(?:\\.\\d+)?)\\s*\\n' +
  '\\s*TP1:\\s*([\\d,]+(?:\\.\\d+)?)\\s*\\n' +
  '\\s*TP2:\\s*([\\d,]+(?:\\.\\d+)?)\\s*\\n' +
  '\\s*SL:\\s*([\\d,]+(?:\\.\\d+)?)\\s*\\n' +
  '\\s*Size:\\s*(Small|Medium|Large)',
  'gi'
);

const TRADE_HEADER_RE = /Trade\s+(\d+)/gi;
const CANCEL_ALL_RE = /❌\s*ALL\s+POSITIONS\s+CANCELLED/i;
const CANCEL_SPECIFIC_RE = /❌\s*Trade\s+(\d+)\s*[—–-]\s*.*?CANCELLED/i;

const TP_HIT_RE = new RegExp(
  '(?:🟢|🔴)\\s*' +
  '(LONG|SHORT)\\s+' +
  '(NQ|ES)\\s*@\\s*' +
  '([\\d,]+(?:\\.\\d+)?)\\s*' +
  '→\\s*(TP\\d)\\s+' +
  '([\\d,]+(?:\\.\\d+)?)\\s*✅',
  'gi'
);

const WARNING_RE = /⚠️\s*(.*?)(?:\n|$)/i;

// ─── MAIN PARSER ─────────────────────────────────────────────

export function parseMessage(text: string): ParsedMessage {

  // 1. Check for cancellations (highest priority)
  if (CANCEL_ALL_RE.test(text)) {
    const reasonMatch = text.match(/CANCELLED\s*\n?(.*)/i);
    return {
      type: 'cancellation',
      cancellation: {
        type: 'cancel_all',
        reason: reasonMatch?.[1]?.trim() || undefined,
      },
    };
  }

  const cancelSpecific = text.match(CANCEL_SPECIFIC_RE);
  if (cancelSpecific && !SIGNAL_BLOCK_RE.test(text)) {
    return {
      type: 'cancellation',
      cancellation: {
        type: 'cancel_specific',
        tradeNumber: parseInt(cancelSpecific[1]),
      },
    };
  }

  // 2. Check for TP hit messages
  const tpHits: ParsedTPHit[] = [];
  let tpMatch;
  const tpRe = new RegExp(TP_HIT_RE.source, TP_HIT_RE.flags);
  while ((tpMatch = tpRe.exec(text)) !== null) {
    tpHits.push({
      instrument: tpMatch[2] as 'NQ' | 'ES',
      direction: tpMatch[1] as 'LONG' | 'SHORT',
      entryPrice: cleanPrice(tpMatch[3]),
      tpLevel: tpMatch[4],
      tpPrice: cleanPrice(tpMatch[5]),
      profitPoints: Math.abs(cleanPrice(tpMatch[5]) - cleanPrice(tpMatch[3])),
    });
  }
  if (tpHits.length > 0) {
    return { type: 'tp_hit', hits: tpHits };
  }

  // 3. Parse signal blocks
  const signals: ParsedSignal[] = [];
  let signalMatch;
  const sigRe = new RegExp(SIGNAL_BLOCK_RE.source, SIGNAL_BLOCK_RE.flags);

  // Build trade number index from "Trade N" headers
  const tradeHeaders: { tradeNum: number; startIndex: number }[] = [];
  let headerMatch;
  const headerRe = new RegExp(TRADE_HEADER_RE.source, TRADE_HEADER_RE.flags);
  while ((headerMatch = headerRe.exec(text)) !== null) {
    tradeHeaders.push({
      tradeNum: parseInt(headerMatch[1]),
      startIndex: headerMatch.index,
    });
  }

  while ((signalMatch = sigRe.exec(text)) !== null) {
    // Determine trade number from nearest preceding header
    let tradeNumber = 1;
    for (const header of tradeHeaders) {
      if (signalMatch.index >= header.startIndex) {
        tradeNumber = header.tradeNum;
      }
    }

    signals.push({
      tradeNumber,
      instrument: signalMatch[2].toUpperCase() as 'NQ' | 'ES',
      direction: signalMatch[1].toUpperCase() as 'LONG' | 'SHORT',
      entryPrice: cleanPrice(signalMatch[3]),
      tp1: cleanPrice(signalMatch[4]),
      tp2: cleanPrice(signalMatch[5]),
      stopLoss: cleanPrice(signalMatch[6]),
      size: signalMatch[7] as 'Small' | 'Medium' | 'Large',
    });
  }

  if (signals.length > 0) {
    const warningMatch = text.match(WARNING_RE);
    return {
      type: 'signals',
      signals,
      warning: warningMatch ? warningMatch[1].trim() : undefined,
    };
  }

  return { type: 'unknown', raw: text };
}
```

### Parser Test Cases

| Message | Parsed Result |
|---|---|
| Message 1 (Two short trades) | 4 signals: Trade 1 SHORT NQ@23809 + SHORT ES@6537, Trade 2 SHORT NQ@23933 + SHORT ES@6556 |
| Message 2 (Two long trades) | 4 signals: Trade 1 LONG NQ@24060 + LONG ES@6606, Trade 2 LONG NQ@24000 + LONG ES@6583 |
| Message 3 (Warning + Trade 3) | 2 signals (NQ+ES) with warning="HIGH RISK — Heavy selling pressure..." |
| Message 4 (Cancel all) | cancellation: cancel_all, reason="Unusual buying pressure..." |
| Message 5 (Cancel specific) | cancellation: cancel_specific, tradeNumber=3 |
| Message 6 (TP hit) | tp_hit: 2 hits (NQ TP2 + ES TP2) |

---

## 8. Order Type Decision Logic

Determines whether to place a market order, limit order, or stop order based on where the current Fusion price is relative to the adjusted signal entry.

```typescript
// src/lib/signals/order-type.ts

type OrderType = 'MARKET' | 'BUY_STOP' | 'BUY_LIMIT' | 'SELL_STOP' | 'SELL_LIMIT';

interface OrderDecision {
  orderType: OrderType;
  reason: string;
}

function determineOrderType(
  direction: 'LONG' | 'SHORT',
  adjustedEntryPrice: number,
  currentMarketPrice: number,
  threshold: number = 5.0     // "substantially similar" threshold in points
): OrderDecision {
  const diff = currentMarketPrice - adjustedEntryPrice;
  const absDiff = Math.abs(diff);

  // SUBSTANTIALLY SIMILAR — market order
  if (absDiff <= threshold) {
    return {
      orderType: 'MARKET',
      reason: `Market ${currentMarketPrice.toFixed(2)} is ${absDiff.toFixed(1)}pts ` +
              `from entry ${adjustedEntryPrice.toFixed(2)} (within ${threshold}pt threshold) — MARKET`
    };
  }

  if (direction === 'LONG') {
    if (currentMarketPrice < adjustedEntryPrice) {
      // Market BELOW entry → price must RISE to trigger → BUY STOP
      return {
        orderType: 'BUY_STOP',
        reason: `LONG: Market ${currentMarketPrice.toFixed(2)} is BELOW entry ` +
                `${adjustedEntryPrice.toFixed(2)} by ${absDiff.toFixed(1)}pts — BUY STOP`
      };
    } else {
      // Market ABOVE entry → price must DROP to trigger → BUY LIMIT
      return {
        orderType: 'BUY_LIMIT',
        reason: `LONG: Market ${currentMarketPrice.toFixed(2)} is ABOVE entry ` +
                `${adjustedEntryPrice.toFixed(2)} by ${absDiff.toFixed(1)}pts — BUY LIMIT`
      };
    }
  } else {
    // SHORT
    if (currentMarketPrice < adjustedEntryPrice) {
      // Market BELOW entry → price must RISE to trigger → SELL LIMIT
      return {
        orderType: 'SELL_LIMIT',
        reason: `SHORT: Market ${currentMarketPrice.toFixed(2)} is BELOW entry ` +
                `${adjustedEntryPrice.toFixed(2)} by ${absDiff.toFixed(1)}pts — SELL LIMIT`
      };
    } else {
      // Market ABOVE entry → price must DROP to trigger → SELL STOP
      return {
        orderType: 'SELL_STOP',
        reason: `SHORT: Market ${currentMarketPrice.toFixed(2)} is ABOVE entry ` +
                `${adjustedEntryPrice.toFixed(2)} by ${absDiff.toFixed(1)}pts — SELL STOP`
      };
    }
  }
}
```

---

## 9. Complete Pipeline Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                   TELEGRAM SIGNAL CHANNEL                         │
│           (Sends NQ + ES futures signals)                         │
└──────────────────────┬───────────────────────────────────────────┘
                       │ MTProto push (~100ms)
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│               SIGNAL LISTENER WORKER                              │
│          (src/workers/signal-listener.ts)                          │
│                                                                    │
│  1. Receive Telegram message                                       │
│  2. parseMessage(text)                                             │
│  3. Store raw message in signals table                             │
│                                                                    │
│  Route by type:                                                    │
│  ├─ "signals"      → Execute each signal (see below)              │
│  ├─ "cancellation" → Cancel pending orders (see below)            │
│  ├─ "tp_hit"       → Log for reference                            │
│  └─ "unknown"      → Log raw message, skip                        │
└──────────────────────┬───────────────────────────────────────────┘
                       │
       ┌───────────────┴───────────────┐
       │ type: "signals"               │ type: "cancellation"
       ▼                               ▼
┌──────────────────────┐  ┌────────────────────────────────────────┐
│  FOR EACH SIGNAL:    │  │  CANCELLATION HANDLER                  │
│                      │  │                                        │
│  1. Map instrument:  │  │  cancel_all:                           │
│     NQ → NAS100      │  │    Query all pending signal orders     │
│     ES → US500       │  │    Cancel each via MetaApi             │
│                      │  │                                        │
│  2. Get cached price │  │  cancel_specific:                      │
│     for BOTH source  │  │    Find orders matching Trade N        │
│     (futures) and    │  │    Cancel via MetaApi                  │
│     target (Fusion)  │  │                                        │
│                      │  └────────────────────────────────────────┘
│  3. Get offset from  │
│     TradingView      │
│     webhook cache    │
│     (or fixed        │
│      fallback)       │
│                      │
│  4. Adjust levels:   │
│     entry - offset   │
│     SL    - offset   │
│     TP1   - offset   │
│     TP2   - offset   │
│                      │
│  5. Determine order  │
│     type (market /   │
│     stop / limit)    │
│                      │
│  6. Calculate lot    │
│     size (sizing     │
│     mode + split)    │
│                      │
│  7. Check margin     │
│     (reject if       │
│     insufficient)    │
│                      │
│  8. Chunk orders if  │
│     lots > max per   │
│     order (default   │
│     50 lots/order)   │
│                      │
│  9. If split_target: │
│     chunk TP1 + TP2  │
│     independently    │
│     Else: chunk once │
│                      │
│  10. Execute all     │
│      chunks via      │
│      MetaApi REST    │
│      (all parallel)  │
│                      │
│  11. Log execution(s)│
│      with latency    │
│                      │
│  12. Monitor TP1 via │
│      sync listener → │
│      move TP2 SL to  │
│      entry on fill   │
│                      │
│  13. Auto-create     │
│      journal entry   │
└──────────────────────┘
```

---

## 10. Price Streaming & Caching

Two price sources feed the pipeline:

**Fusion CFD prices (MetaApi WebSocket)** — NAS100 and US500 streamed in real-time from the Fusion Markets trading account via MetaApi. Used for order type decisions (is the current market price above/below the adjusted entry?) and displayed on the dashboard.

**Futures prices + offsets (TradingView Webhook)** — NQM2026 and ESM2026 prices sent periodically from a TradingView Pine Script indicator via webhook. MetaApi cannot provide CME futures prices because Fusion Markets is a CFD broker. TradingView is the source of truth for futures data since Brandon has a live CME data subscription there.

The webhook fires on every bar close at whatever timeframe the chart is set to (recommended: 15-minute for intraday accuracy, or 1D for daily calibration). Each webhook POST sends: `nq_price`, `es_price`, `nas100_price`, `us500_price`, `nq_offset`, `es_offset`, plus SMA values and a secret token for authentication.

```typescript
// src/lib/signals/price-cache.ts

interface CachedPrice {
  bid: number;
  ask: number;
  mid: number;
  updatedAt: number;    // Date.now()
}

interface CachedOffset {
  nqOffset: number;
  esOffset: number;
  nqFuturesPrice: number;
  esFuturesPrice: number;
  nas100Price: number;     // Fusion price at time of TradingView calculation
  us500Price: number;      // Fusion price at time of TradingView calculation
  nqOffsetSma: number;
  esOffsetSma: number;
  receivedAt: number;      // Date.now() when webhook was received
  tradingviewTimestamp: string;
}

class PriceCache {
  private prices = new Map<string, CachedPrice>();
  private offset: CachedOffset | null = null;
  private PRICE_MAX_AGE_MS = 10_000;    // 10s staleness for CFD prices
  private OFFSET_MAX_AGE_MS = 86_400_000; // 24h staleness for offset (conservative)

  // ── CFD Prices (from MetaApi WebSocket) ──
  setPrice(key: string, bid: number, ask: number) {
    this.prices.set(key, {
      bid, ask,
      mid: (bid + ask) / 2,
      updatedAt: Date.now(),
    });
  }

  getPrice(key: string): CachedPrice | null {
    const cached = this.prices.get(key);
    if (!cached || Date.now() - cached.updatedAt > this.PRICE_MAX_AGE_MS) return null;
    return cached;
  }

  // ── Offsets (from TradingView Webhook) ──
  setOffset(data: CachedOffset) {
    this.offset = data;
  }

  getOffset(): CachedOffset | null {
    if (!this.offset || Date.now() - this.offset.receivedAt > this.OFFSET_MAX_AGE_MS) return null;
    return this.offset;
  }

  getOffsetAge(): number | null {
    return this.offset ? Date.now() - this.offset.receivedAt : null;
  }
}

// The worker maintains streaming connections to MetaApi for:
//   - Fusion NAS100 (execution account) — for order type decisions
//   - Fusion US500  (execution account) — for order type decisions
//
// Futures prices (NQM2026, ESM2026) come from TradingView webhooks,
// NOT from MetaApi (Fusion Markets does not offer CME futures).
//
// The offset is updated each time a TradingView webhook arrives.
// Between webhooks, the last known offset is used (the futures basis
// changes slowly — typically <2 points/day from time decay).
```

---

## 11. Offset Calculation

Each instrument has an independent offset that changes over time. The offset is sourced from the TradingView webhook (the only reliable source of CME futures prices in this stack).

### Offset Modes

| Mode | Source | When to use |
|---|---|---|
| `webhook` (default) | TradingView Pine Script sends NQ/ES prices via webhook | Primary mode — uses live CME data from your TradingView subscription |
| `fixed` | User-set values in config (NQ default: 198, ES default: 40) | Fallback if TradingView webhook is down or hasn't fired yet |
| `none` | No offset applied | Testing, or if the signal bot ever switches to CFD prices |

### How it works

1. TradingView indicator fires a webhook every N minutes (based on chart timeframe)
2. Webhook delivers: `nq_price`, `es_price`, `nas100_price`, `us500_price`, `nq_offset`, `es_offset`
3. Haia stores these in the PriceCache and also persists to `offsetHistory` for charting
4. When a signal arrives, the pipeline reads the last known offset from the cache
5. If the offset is stale (>24h since last webhook) or absent, falls back to fixed offset

The futures basis changes slowly — typically less than 2 points per day from time decay. So even a 15-minute-old offset is more than accurate enough. A daily update is the minimum; intraday updates on a 15-min chart are ideal.

```typescript
// src/lib/signals/offset.ts

interface OffsetResult {
  offset: number;           // futures price - CFD price
  futuresPrice: number;
  cfdPrice: number;
  instrument: 'NQ' | 'ES';
  isStale: boolean;         // true if using fixed fallback
  source: 'webhook' | 'fixed' | 'none';
  offsetAgeMs: number | null; // how old the webhook data is
}

function getOffset(
  instrument: 'NQ' | 'ES',
  priceCache: PriceCache,
  config: SignalConfig
): OffsetResult {

  if (config.offsetMode === 'none') {
    return { offset: 0, futuresPrice: 0, cfdPrice: 0, instrument, isStale: false, source: 'none', offsetAgeMs: null };
  }

  // Try webhook offset first (from TradingView)
  if (config.offsetMode === 'webhook') {
    const cached = priceCache.getOffset();
    if (cached) {
      const offset = instrument === 'NQ' ? cached.nqOffset : cached.esOffset;
      const futuresPrice = instrument === 'NQ' ? cached.nqFuturesPrice : cached.esFuturesPrice;
      const cfdPrice = instrument === 'NQ' ? cached.nas100Price : cached.us500Price;
      const ageMs = Date.now() - cached.receivedAt;

      // Safety bounds check
      const maxOffset = instrument === 'NQ' ? config.nqMaxOffset : config.esMaxOffset;
      if (Math.abs(offset) > maxOffset) {
        throw new Error(
          `[${instrument}] Webhook offset ${offset.toFixed(2)} exceeds max (${maxOffset}). ` +
          `Possible data error or contract roll.`
        );
      }

      return { offset, futuresPrice, cfdPrice, instrument, isStale: false, source: 'webhook', offsetAgeMs: ageMs };
    }

    // Webhook data missing or stale — fall through to fixed
    console.warn(`[${instrument}] Webhook offset unavailable, falling back to fixed offset`);
  }

  // Fixed fallback
  const fixedOffset = instrument === 'NQ' ? config.nqFixedOffset : config.esFixedOffset;
  return {
    offset: fixedOffset,
    futuresPrice: 0,
    cfdPrice: 0,
    instrument,
    isStale: true,
    source: 'fixed',
    offsetAgeMs: null,
  };
}

// Apply offset to all signal levels
function adjustSignalLevels(
  signal: ParsedSignal,
  offset: number
): { entry: number; sl: number; tp1: number; tp2: number } {
  return {
    entry: Math.round((signal.entryPrice - offset) * 100) / 100,
    sl:    Math.round((signal.stopLoss - offset) * 100) / 100,
    tp1:   Math.round((signal.tp1 - offset) * 100) / 100,
    tp2:   Math.round((signal.tp2 - offset) * 100) / 100,
  };
}
```

---

## 12. Position Sizing

The pipeline supports three position sizing modes, configurable per user.

### Mode 1: Strict Lot Sizing (default)

Fixed lot size per size tier. No calculation — the bot says "Small"/"Medium"/"Large" and you map those directly to lot values.

| Bot Size | NQ Default | ES Default |
|---|---|---|
| Small | 0.01 | 0.01 |
| Medium | 0.05 | 0.05 |
| Large | 0.10 | 0.10 |

### Mode 2: % of Account Balance

Risk a fixed percentage of **account balance** (deposited capital, ignoring open P&L) per trade. The bot's size tier acts as a **multiplier** on the base risk percentage.

**Formula:**

```
effectiveRiskPercent = baseRiskPercent × sizeMultiplier

riskAmount ($) = accountBalance × (effectiveRiskPercent / 100)

stopDistancePoints = |adjustedEntryPrice − stopLoss|

lotSize = riskAmount / (stopDistancePoints × pipValuePerLot)

lotSize = clamp(lotSize, minLotSize, maxLotSize)
         → then round down to nearest step (e.g., 0.01)
```

**Worked example:**
- Account balance: $10,000
- Base risk: 1%
- Bot signal: LONG NAS100 @ 24,060 (adjusted), SL: 24,020, Size: Medium (1.0× multiplier)
- Pip value per standard lot (NAS100 on Fusion): $1/point

```
effectiveRisk  = 1% × 1.0 = 1%
riskAmount     = $10,000 × 0.01 = $100
stopDistance    = 24,060 − 24,020 = 40 points
lotSize        = $100 / (40 × $1) = 2.50 lots
→ capped at maxLotSize (e.g., 0.10) = 0.10 lots
```

With micro lots (0.01 lot = $0.01/point on NAS100):
```
lotSize = $100 / (40 × $100) = 0.025 → rounded to 0.02 lots
```

### Mode 3: % of Account Equity

Identical formula, but uses **equity** (balance + unrealized P&L from open positions) instead of balance:

```
riskAmount ($) = accountEquity × (effectiveRiskPercent / 100)
```

This makes sizing self-correcting: you naturally scale down during drawdowns (equity < balance) and scale up during winning streaks (equity > balance).

### Size Tier Multipliers

| Bot Size | Default Multiplier |
|---|---|
| Small | 0.5× |
| Medium | 1.0× |
| Large | 1.5× |

Fully configurable. If your base risk is 1%, a "Large" signal risks 1.5%, a "Small" risks 0.5%.

### Safeguards

| Guard | Default | Purpose |
|---|---|---|
| `minLotSize` | 0.01 | Broker minimum |
| `maxLotSize` | No cap | User-defined cap (never exceeded regardless of sizing mode). With order chunking, large positions are split into multiple orders automatically. |
| `maxLotsPerOrder` | 50 | Max lots per single order sent to broker. Fusion recommends ≤50 for clean fills. Hard cap: 100 (broker limit). |
| `maxRiskPercent` | 5.0% | Hard ceiling — rejects calculation if effective risk exceeds this |
| `minStopDistance` | 10 pts | Rejects signals with unreasonably tight stops (prevents giant lot sizes) |
| `marginWarningThreshold` | 80% | Logs warning if margin utilization exceeds this |
| `marginRejectThreshold` | 95% | Rejects trade entirely if margin utilization exceeds this |

### Execution Mode: Single vs. Split Target

An optional **split-target** mode opens two positions per signal instead of one — one targeting TP1 and one targeting TP2 — with a breakeven trail on the TP2 position.

| Setting | Single (default) | Split Target |
|---|---|---|
| Positions per signal | 1 (TP set to TP1, TP2 ignored at execution) | 2 (one at TP1, one at TP2) |
| Risk distribution | 100% to single position | TP1 gets the larger half, TP2 gets the smaller half |
| Breakeven trail | None | When TP1 position closes, TP2's SL moves to entry |

**Lot splitting with rounding:**

The total lot size is calculated normally (via whichever sizing mode is active), then split into two. Because lot sizes must respect the broker's minimum step (typically 0.01), an exact 50/50 split isn't always possible. The **TP1 position gets the larger half**.

```
totalLots = 0.05 (calculated from sizing mode)
tp1Lots   = ceil(totalLots / 2 / lotStep) * lotStep  = 0.03
tp2Lots   = totalLots - tp1Lots                       = 0.02
```

If the total lot size equals the minimum (e.g., 0.01 and it can't be split), the pipeline falls back to single-position mode for that signal and logs the reason.

**Breakeven trail — how TP2's SL moves to entry:**

When the TP1 position closes (detected via MetaApi's synchronization listener on the WebSocket — the same connection the trade-sync worker already uses), the pipeline:

1. Looks up the paired TP2 execution via `linkedExecutionId`
2. Calls MetaApi `modifyPosition` to set the TP2 position's SL to the original entry price
3. Logs the modification in the execution record (`breakevenMovedAt` timestamp)

If the TP1 position was stopped out instead of hitting TP, the TP2 position is left unchanged (its original SL remains).

### Pip Value & Contract Specs

Verified from Fusion Markets MT5 (right-click symbol → Specification):

| Property | NAS100 | US500 |
|---|---|---|
| 1 lot pip value | $0.10/point | $0.10/point |
| 100 lots pip value | $10/point | $10/point |
| Min lot size | 0.01 | 0.01 |
| Lot step | 0.01 | 0.01 |
| Max order size | 100 lots (broker recommends ≤50 for slippage) | 100 lots |

**Pip vs Point note:** On Fusion, 1 point on NAS100 = 10 pips (tick size 0.1). The values above are per **point** (whole number move). So 100 lots, SHORT NAS100 @ 23,809 → 23,700 = 109 points × $100/point = $10,900.

These values should be fetched dynamically from MetaApi `getSymbolSpecification()` on startup and cached, rather than hardcoded, in case Fusion changes contract terms.

```typescript
// src/lib/signals/sizing.ts

interface ContractSpec {
  pipValuePerLot: number;   // $ per POINT per lot (not per pip)
  minLotSize: number;
  lotStep: number;          // e.g., 0.01
  maxOrderSize: number;     // max lots per single order (broker limit)
}

// Default values — overridden by MetaApi getSymbolSpecification() on startup
const CONTRACT_SPECS: Record<string, ContractSpec> = {
  NAS100: { pipValuePerLot: 0.10, minLotSize: 0.01, lotStep: 0.01, maxOrderSize: 100 },
  US500:  { pipValuePerLot: 0.10, minLotSize: 0.01, lotStep: 0.01, maxOrderSize: 100 },
};
```

### Order Chunking (Large Positions)

When the calculated lot size exceeds the broker's max order size (100 lots), or the user's preferred chunk size, the pipeline automatically splits the order into multiple smaller orders. All chunks share the same entry, SL, and TP — they fire in parallel.

| Config | Default | Purpose |
|---|---|---|
| `maxLotsPerOrder` | 50 | Preferred chunk size (Fusion recommends ≤50 for clean fills) |
| Broker hard cap | 100 | Absolute max — never exceeded per order |

**Chunking logic:**

```typescript
function chunkLots(totalLots: number, maxPerOrder: number, lotStep: number): number[] {
  const chunks: number[] = [];
  let remaining = totalLots;

  while (remaining > 0) {
    const chunk = Math.min(remaining, maxPerOrder);
    // Round to lot step
    const rounded = Math.floor(chunk / lotStep) * lotStep;
    if (rounded < lotStep) break;  // can't place an order smaller than 1 step
    chunks.push(parseFloat(rounded.toFixed(2)));
    remaining = parseFloat((remaining - rounded).toFixed(2));
  }

  return chunks;
}

// Example: chunkLots(250, 50, 0.01)
// → [50, 50, 50, 50, 50]  (5 orders × 50 lots)

// Example: chunkLots(130, 50, 0.01)
// → [50, 50, 30]  (3 orders)
```

**Interaction with split target:**

If split target is enabled, the total lots are first split into TP1/TP2 halves, then each half is chunked independently:

```
Total: 250 lots, split target enabled, maxPerOrder: 50
→ TP1: 130 lots → chunks: [50, 50, 30] (3 orders, all TP=TP1)
→ TP2: 120 lots → chunks: [50, 50, 20] (3 orders, all TP=TP2)
= 6 orders total, all fired in parallel
```

The breakeven monitor tracks all TP1-tagged executions. It only moves TP2 orders' SL to entry once **every** TP1 chunk has closed (either filled at TP or stopped out).

### Margin Validation

Before executing, the pipeline checks whether the account has sufficient free margin for the total position. MetaApi provides margin requirements via `calculateMargin()` or from `getSymbolSpecification()`.

```typescript
interface MarginCheck {
  requiredMargin: number;     // $ margin needed for the total position
  freeMargin: number;         // $ available margin on account
  sufficient: boolean;
  marginUtilization: number;  // requiredMargin / freeMargin as percentage
}

async function checkMargin(
  account: MetaApiAccount,
  symbol: string,
  totalLots: number,
  direction: 'LONG' | 'SHORT',
): Promise<MarginCheck> {
  const accountInfo = await account.getAccountInformation();
  const freeMargin = accountInfo.freeMargin;

  // Get margin requirement from MetaApi
  const marginReq = await account.calculateMargin({
    symbol,
    volume: totalLots,
    type: direction === 'LONG' ? 'ORDER_TYPE_BUY' : 'ORDER_TYPE_SELL',
  });

  return {
    requiredMargin: marginReq.margin,
    freeMargin,
    sufficient: freeMargin >= marginReq.margin,
    marginUtilization: (marginReq.margin / freeMargin) * 100,
  };
}
```

**Pipeline behavior:**

| Margin Check Result | Action |
|---|---|
| Sufficient (utilization < 80%) | Execute normally |
| Sufficient but tight (80–95%) | Execute + log warning on dashboard |
| Insufficient (>95% or not enough) | **Reject the trade**, log error, show alert on dashboard |

The 80%/95% thresholds are configurable via `marginWarningThreshold` and `marginRejectThreshold` in signalConfigs.

Margin is checked **once** for the total position (all chunks combined), not per chunk — this prevents a scenario where the first 3 chunks succeed but chunk 4 fails due to margin consumed by the first 3.

### Position Sizing Implementation

```typescript
// src/lib/signals/sizing.ts

type SizingMode = 'strict' | 'percent_balance' | 'percent_equity';
type ExecutionMode = 'single' | 'split_target';

interface SizingConfig {
  mode: SizingMode;
  executionMode: ExecutionMode;        // "single" = 1 position, "split_target" = 2 positions (TP1 + TP2)
  // Strict mode
  strictLots: Record<string, number>;  // { Small: 0.01, Medium: 0.05, Large: 0.10 }
  // Percent mode
  baseRiskPercent: number;             // e.g., 1.0
  sizeMultipliers: Record<string, number>; // { Small: 0.5, Medium: 1.0, Large: 1.5 }
  maxRiskPercent: number;              // hard ceiling, e.g., 5.0
  minStopDistance: number;             // minimum stop distance in points
  maxLotSize: number;
  maxLotsPerOrder: number;             // chunk size for large positions (default 50, hard cap 100)
}

interface AccountInfo {
  balance: number;
  equity: number;
}

interface SizingResult {
  lotSize: number;                     // total lot size
  riskAmount: number;
  effectiveRiskPercent: number;
  reason: string;
  // Split target fields
  isSplit: boolean;
  tp1LotSize?: number;
  tp2LotSize?: number;
  splitFallbackReason?: string;
  // Order chunking fields
  chunks: number[];                    // e.g., [50, 50, 30] — each element is one order
  tp1Chunks?: number[];                // chunks for TP1 orders (split mode)
  tp2Chunks?: number[];                // chunks for TP2 orders (split mode)
}

export function calculateLotSize(
  config: SizingConfig,
  signal: { size: 'Small' | 'Medium' | 'Large'; entryPrice: number; stopLoss: number },
  account: AccountInfo,
  contractSpec: ContractSpec,
): SizingResult {

  // ── STRICT MODE ──
  let totalLots: number;
  let riskAmount = 0;
  let effectiveRisk = 0;
  let reason: string;

  if (config.mode === 'strict') {
    const lots = config.strictLots[signal.size] ?? config.strictLots['Medium'];
    totalLots = Math.min(lots, config.maxLotSize);
    reason = `Strict: ${signal.size} → ${totalLots} lots`;
  } else {
    // ── PERCENT MODES ──
    const baseAmount = config.mode === 'percent_balance' ? account.balance : account.equity;
    const multiplier = config.sizeMultipliers[signal.size] ?? 1.0;
    effectiveRisk = config.baseRiskPercent * multiplier;

    // Safety: reject if effective risk exceeds hard ceiling
    if (effectiveRisk > config.maxRiskPercent) {
      return {
        lotSize: contractSpec.minLotSize, riskAmount: 0,
        effectiveRiskPercent: effectiveRisk, isSplit: false,
        reason: `Risk ${effectiveRisk.toFixed(1)}% exceeds max ${config.maxRiskPercent}% — using min lot`,
      };
    }

    riskAmount = baseAmount * (effectiveRisk / 100);
    const stopDistance = Math.abs(signal.entryPrice - signal.stopLoss);

    // Safety: reject unreasonably tight stops
    if (stopDistance < config.minStopDistance) {
      return {
        lotSize: contractSpec.minLotSize, riskAmount,
        effectiveRiskPercent: effectiveRisk, isSplit: false,
        reason: `Stop distance ${stopDistance.toFixed(1)} pts < min ${config.minStopDistance} pts — using min lot`,
      };
    }

    const rawLots = riskAmount / (stopDistance * contractSpec.pipValuePerLot);
    const steppedLots = Math.floor(rawLots / contractSpec.lotStep) * contractSpec.lotStep;
    totalLots = Math.max(contractSpec.minLotSize, Math.min(steppedLots, config.maxLotSize));
    reason = `${config.mode}: ${effectiveRisk.toFixed(1)}% of ${config.mode === 'percent_balance' ? 'balance' : 'equity'} ($${baseAmount.toFixed(0)}) = $${riskAmount.toFixed(2)} risk = ${totalLots.toFixed(2)} lots`;
  }

  // ── SPLIT TARGET ──
  if (config.executionMode === 'split_target') {
    const minLot = contractSpec.minLotSize;
    const step = contractSpec.lotStep;

    // Can't split if total is at minimum already
    if (totalLots <= minLot) {
      return {
        lotSize: totalLots, riskAmount, effectiveRiskPercent: effectiveRisk,
        reason, isSplit: false,
        splitFallbackReason: `Total lots (${totalLots}) = minimum — cannot split, using single position`,
      };
    }

    // TP1 gets the larger half (round up), TP2 gets the remainder
    const tp1Lots = Math.ceil((totalLots / 2) / step) * step;
    const tp2Lots = parseFloat((totalLots - tp1Lots).toFixed(2));

    // If TP2 would be below minimum, fall back to single
    if (tp2Lots < minLot) {
      return {
        lotSize: totalLots, riskAmount, effectiveRiskPercent: effectiveRisk,
        reason, isSplit: false,
        splitFallbackReason: `TP2 half (${tp2Lots}) < min lot (${minLot}) — cannot split, using single position`,
      };
    }

    return {
      lotSize: totalLots, riskAmount, effectiveRiskPercent: effectiveRisk,
      reason: `${reason} → split: TP1=${tp1Lots}, TP2=${tp2Lots}`,
      isSplit: true, tp1LotSize: tp1Lots, tp2LotSize: tp2Lots,
    };
  }

  // ── SINGLE (default) ──
  return {
    lotSize: parseFloat(totalLots.toFixed(2)),
    riskAmount, effectiveRiskPercent: effectiveRisk, reason, isSplit: false,
  };
}
```

---

## 13. Database Schema Additions

7 new tables, all following Haia's existing conventions (cuid2 IDs, timestamps, Drizzle ORM).

```typescript
// src/lib/db/schema.ts — ADDITIONS

// ─── User Roles (access control) ──────────────────
export const userRoles = pgTable('user_roles', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),               // "admin" | "signals" | "journal"
  grantedBy: text('granted_by').references(() => users.id),
  grantedAt: timestamp('granted_at').notNull().defaultNow(),
}, (table) => [
  unique('user_roles_user_role_uniq').on(table.userId, table.role),
]);

// ─── Signal Sources ───────────────────────────────
export const signalSources = pgTable('signal_sources', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),                // "NQ/ES Futures Signals"
  telegramChannelId: text('telegram_channel_id'),
  telegramChannelName: text('telegram_channel_name'),
  priceFeed: text('price_feed').notNull(),     // "CME" | "BLACKBULL"
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
});

// ─── Signal Configs ───────────────────────────────
export const signalConfigs = pgTable('signal_configs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sourceId: text('source_id').notNull().references(() => signalSources.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull().references(() => tradingAccounts.id, { onDelete: 'cascade' }),

  // Master controls
  isEnabled: boolean('is_enabled').notNull().default(false),
  dryRun: boolean('dry_run').notNull().default(true),

  // Instrument-specific execution symbols
  nqSymbol: text('nq_symbol').notNull().default('NAS100'),
  esSymbol: text('es_symbol').notNull().default('US500'),

  // Size → lot mapping (per instrument)
  nqSmallLots: real('nq_small_lots').notNull().default(0.01),
  nqMediumLots: real('nq_medium_lots').notNull().default(0.05),
  nqLargeLots: real('nq_large_lots').notNull().default(0.10),
  esSmallLots: real('es_small_lots').notNull().default(0.01),
  esMediumLots: real('es_medium_lots').notNull().default(0.05),
  esLargeLots: real('es_large_lots').notNull().default(0.10),

  // Offset settings (per instrument)
  offsetMode: text('offset_mode').notNull().default('webhook'), // "webhook" | "fixed" | "none"
  nqFixedOffset: real('nq_fixed_offset').notNull().default(198),
  esFixedOffset: real('es_fixed_offset').notNull().default(40),
  nqMaxOffset: real('nq_max_offset').notNull().default(400),
  nqMinOffset: real('nq_min_offset').notNull().default(50),
  esMaxOffset: real('es_max_offset').notNull().default(150),
  esMinOffset: real('es_min_offset').notNull().default(10),

  // Position sizing
  sizingMode: text('sizing_mode').notNull().default('strict'),  // "strict" | "percent_balance" | "percent_equity"
  executionMode: text('execution_mode').notNull().default('single'),  // "single" | "split_target"
  baseRiskPercent: real('base_risk_percent').notNull().default(1.0),
  maxRiskPercent: real('max_risk_percent').notNull().default(5.0),
  minStopDistance: real('min_stop_distance').notNull().default(10),
  maxLotSize: real('max_lot_size').notNull().default(0.10),

  // Size tier multipliers (for percent modes)
  smallMultiplier: real('small_multiplier').notNull().default(0.5),
  mediumMultiplier: real('medium_multiplier').notNull().default(1.0),
  largeMultiplier: real('large_multiplier').notNull().default(1.5),

  // Order settings
  maxLotsPerOrder: real('max_lots_per_order').notNull().default(50),  // chunk size (broker max 100, recommended ≤50)
  marketOrderThreshold: real('market_order_threshold').notNull().default(5.0),
  maxSlippage: real('max_slippage').notNull().default(5.0),

  // Margin safety
  marginWarningThreshold: real('margin_warning_threshold').notNull().default(80),  // % utilization → log warning
  marginRejectThreshold: real('margin_reject_threshold').notNull().default(95),    // % utilization → reject trade

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
});

// ─── Signals ──────────────────────────────────────
// Every message from Telegram
export const signals = pgTable('signals', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  sourceId: text('source_id').notNull().references(() => signalSources.id, { onDelete: 'cascade' }),

  // Raw data
  telegramMessageId: integer('telegram_message_id'),
  rawMessage: text('raw_message').notNull(),
  receivedAt: timestamp('received_at').notNull().defaultNow(),

  // Parsed result
  messageType: text('message_type').notNull(),   // "signals" | "cancellation" | "tp_hit" | "unknown"
  parsed: boolean('parsed').notNull().default(false),
  signalCount: integer('signal_count').notNull().default(0),   // How many trade signals in this message
  warning: text('warning'),                      // High-risk warning text if present
  parseError: text('parse_error'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('signals_source_id_idx').on(table.sourceId),
  index('signals_received_at_idx').on(table.receivedAt),
]);

// ─── Signal Executions ────────────────────────────
// One row per order sent. Single mode: 1+ rows per signal (chunked if large). Split mode: 2+ rows (TP1 chunks + TP2 chunks).
export const signalExecutions = pgTable('signal_executions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  signalId: text('signal_id').notNull().references(() => signals.id, { onDelete: 'cascade' }),
  configId: text('config_id').notNull().references(() => signalConfigs.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull().references(() => tradingAccounts.id, { onDelete: 'cascade' }),

  // Signal data
  tradeNumber: integer('trade_number'),         // Trade 1, 2, 3
  splitIndex: integer('split_index'),           // null=single, 1=TP1 position, 2=TP2 position
  linkedExecutionId: text('linked_execution_id'), // links TP1↔TP2 pair (self-referencing)
  chunkIndex: integer('chunk_index'),           // null=no chunking, 1/2/3... for chunked orders
  totalChunks: integer('total_chunks'),         // total number of chunks for this signal+split combo
  instrument: text('instrument').notNull(),      // "NQ" | "ES"
  fusionSymbol: text('fusion_symbol').notNull(), // "NAS100" | "US500"
  direction: text('direction').notNull(),         // "LONG" | "SHORT"
  signalEntry: real('signal_entry').notNull(),
  signalSl: real('signal_sl').notNull(),
  signalTp1: real('signal_tp1').notNull(),
  signalTp2: real('signal_tp2').notNull(),
  signalSize: text('signal_size').notNull(),      // "Small" | "Medium" | "Large"
  lotSize: real('lot_size').notNull(),

  // Offset
  futuresPriceAtExec: real('futures_price_at_exec'),
  fusionPriceAtExec: real('fusion_price_at_exec'),
  offsetApplied: real('offset_applied'),
  offsetIsStale: boolean('offset_is_stale').notNull().default(false),

  // Adjusted levels (after offset)
  adjustedEntry: real('adjusted_entry'),
  adjustedSl: real('adjusted_sl'),
  adjustedTp1: real('adjusted_tp1'),
  adjustedTp2: real('adjusted_tp2'),

  // Order decision
  orderType: text('order_type'),                 // "MARKET" | "BUY_STOP" | "BUY_LIMIT" | "SELL_STOP" | "SELL_LIMIT"
  orderReason: text('order_reason'),

  // Execution result
  status: text('status').notNull(),              // "pending" | "sent" | "filled" | "cancelled" | "rejected" | "error" | "dry_run"
  metaapiOrderId: text('metaapi_order_id'),
  fillPrice: real('fill_price'),
  slippage: real('slippage'),
  errorMessage: text('error_message'),

  // Timing
  signalReceivedAt: timestamp('signal_received_at'),
  orderSentAt: timestamp('order_sent_at'),
  orderFilledAt: timestamp('order_filled_at'),
  totalLatencyMs: integer('total_latency_ms'),

  // Split target tracking
  breakevenMovedAt: timestamp('breakeven_moved_at'),  // when TP2's SL was moved to entry (split mode only)

  isDryRun: boolean('is_dry_run').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => [
  index('signal_executions_signal_id_idx').on(table.signalId),
  index('signal_executions_account_id_idx').on(table.accountId),
  index('signal_executions_status_idx').on(table.status),
  index('signal_executions_instrument_idx').on(table.instrument),
]);

// ─── Offset History (from TradingView Webhooks) ──
// Persists each webhook payload for dashboard charts and audit trail
export const offsetHistory = pgTable('offset_history', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  nqOffset: real('nq_offset').notNull(),
  esOffset: real('es_offset').notNull(),
  nqFuturesPrice: real('nq_futures_price').notNull(),
  esFuturesPrice: real('es_futures_price').notNull(),
  nas100Price: real('nas100_price').notNull(),
  us500Price: real('us500_price').notNull(),
  nqOffsetSma: real('nq_offset_sma'),
  esOffsetSma: real('es_offset_sma'),
  tradingviewTimestamp: text('tradingview_timestamp'),
  receivedAt: timestamp('received_at').notNull().defaultNow(),
}, (table) => [
  index('offset_history_received_at_idx').on(table.receivedAt),
]);

// ─── Trade Journal ────────────────────────────────
export const tradeJournal = pgTable('trade_journal', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tradeId: text('trade_id').references(() => trades.id, { onDelete: 'set null' }),
  signalExecutionId: text('signal_execution_id').references(() => signalExecutions.id, { onDelete: 'set null' }),

  // Journal content
  setupType: text('setup_type'),                  // "breakout" | "pullback" | "reversal" | "signal_copy" | custom
  reasoning: text('reasoning'),                    // Pre-trade thesis
  review: text('review'),                          // Post-trade review
  emotionalState: text('emotional_state'),         // "confident" | "hesitant" | "fomo" | "revenge" | "calm"
  rating: integer('rating'),                       // 1-5 self-assessment
  tags: text('tags'),                              // JSON array
  screenshotUrls: text('screenshot_urls'),         // JSON array

  // Denormalized for fast queries
  symbol: text('symbol'),
  direction: text('direction'),
  pnl: real('pnl'),
  pnlPips: real('pnl_pips'),
  entryTime: timestamp('entry_time'),
  exitTime: timestamp('exit_time'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index('trade_journal_user_id_idx').on(table.userId),
  index('trade_journal_setup_type_idx').on(table.setupType),
]);
```

---

## 14. Cancellation Handling

When a cancellation message arrives:

**"ALL POSITIONS CANCELLED":**
1. Query `signalExecutions` for all rows with `status = 'sent'` (pending orders) belonging to the active config
2. For each, call MetaApi to cancel the pending order using `metaapiOrderId`
3. Update status to `'cancelled'`
4. Log the cancellation reason

**"Trade N CANCELLED":**
1. Query `signalExecutions` where `tradeNumber = N` and `status = 'sent'`
2. Cancel those specific orders via MetaApi
3. Update status to `'cancelled'`

**Edge case:** If the order was already filled (status = `'filled'`), cancellation is a no-op — log it as "already filled, cannot cancel" but do NOT close the position (that's a separate manual decision).

---

## 15. Access Control

### Role System

| Role | Access |
|---|---|
| `admin` | Full access, can grant/revoke roles |
| `signals` | Signal Copier pages + API |
| `journal` | Trade Journal pages + API (could be made public later) |

### Implementation

Extend the existing NextAuth session to include roles:

```typescript
// In auth.ts callbacks
async session({ session, user }) {
  // Query userRoles for this user
  const roles = await db.select()
    .from(userRoles)
    .where(eq(userRoles.userId, user.id));
  session.user.roles = roles.map(r => r.role);
  return session;
}
```

Middleware checks for protected routes:

```typescript
// src/middleware.ts — additions
const ROLE_ROUTES: Record<string, string> = {
  '/signals': 'signals',
  '/api/signals': 'signals',
  '/journal': 'journal',
  '/api/journal': 'journal',
  '/settings/admin': 'admin',
};
```

For initial setup, grant yourself `admin` + `signals` + `journal` roles directly via Drizzle Studio or a seed script.

---

## 16. New Pages & UI

### 16.1 Signal Dashboard — `/signals`

```
┌─────────────────────────────────────────────────────────────────┐
│ [TopNav] Dashboard Analytics Calendar History Flex Signals ...   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ ┌────────┐ │
│  │ Pipeline  │ │ Today    │ │ Latency  │ │NQ Ofst │ │ES Ofst │ │
│  │ ● ACTIVE  │ │ Sigs: 12 │ │ Avg      │ │ +198   │ │ +42    │ │
│  │ DRY: OFF  │ │ Fill: 11 │ │ 650ms    │ │ pts    │ │ pts    │ │
│  └──────────┘ └──────────┘ └──────────┘ └────────┘ └────────┘ │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Recent Signals                             [NQ] [ES] [All] │ │
│  │ ┌──────┬─────┬─────┬────────┬───────┬───────┬─────┬──────┐ │ │
│  │ │ Time │ Sym │ Dir │ Signal │ Adj.  │ Type  │ Fill│ Lat. │ │ │
│  │ ├──────┼─────┼─────┼────────┼───────┼───────┼─────┼──────┤ │ │
│  │ │14:32 │NAS  │ BUY │ 24380  │ 24182 │MARKET │24183│ 620  │ │ │
│  │ │14:32 │US5  │ BUY │ 6606   │ 6564  │MARKET │6565 │ 580  │ │ │
│  │ │14:15 │NAS  │ SELL│ 24420  │ 24222 │S.STOP │24221│ 710  │ │ │
│  │ │14:15 │US5  │ SELL│ 6637   │ 6595  │S.STOP │ pnd │  —   │ │ │
│  │ └──────┴─────┴─────┴────────┴───────┴───────┴─────┴──────┘ │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌──────────────────────────┐ ┌────────────────────────────────┐ │
│  │ Live Offset Monitors     │ │ Signal Performance             │ │
│  │ [NQ-NAS100 spread chart] │ │ NAS100: +$1,240 (68% WR)      │ │
│  │ [ES-US500 spread chart]  │ │ US500:  +$860   (71% WR)      │ │
│  │ (Recharts, dual-axis)    │ │ Total:  +$2,100               │ │
│  └──────────────────────────┘ └────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 16.2 Signal Settings — `/signals/settings`

- **Telegram Connection** — Auth flow, channel selection
- **Offset Settings** — Offset mode (Webhook / Fixed / None), webhook status + last received time, per-instrument fixed fallback values, min/max bounds
- **Position Sizing** — Mode selector (Strict / % Balance / % Equity), base risk %, size multipliers, max lot cap
- **Execution Mode** — Single Position or Split Target (TP1 + TP2). When Split is selected, show explanation: "Opens two positions per signal. TP1 gets the larger lot. When TP1 hits, TP2's stop loss moves to entry (breakeven)."
- **Order Limits** — Max lots per order (default 50, hard cap 100), margin warning threshold (default 80%), margin reject threshold (default 95%). Show current account free margin and estimated margin required for a sample trade.
- **NQ Execution** — Fusion symbol (NAS100), strict lot sizes for Small/Medium/Large
- **ES Execution** — Fusion symbol (US500), strict lot sizes for Small/Medium/Large
- **Order Settings** — Market order threshold, max slippage
- **Master Switch** — Enable/disable, dry run toggle

### 16.3 Trade Journal — `/journal`

Timeline-based journal with filters for setup type, instrument, mood, and date. Auto-created entries for signal copies. Performance analytics by setup type and emotional state.

---

## 17. API Routes

### Signal Pipeline

```
POST   /api/signals/webhook/telegram       — Telegram bot webhook (Option B)
GET    /api/signals                         — List signals (paginated)
GET    /api/signals/:id                     — Signal with all executions
GET    /api/signals/executions              — List executions
GET    /api/signals/stats                   — Performance stats (per instrument)
GET    /api/signals/offset/current          — Current offsets (NQ + ES) + age
GET    /api/signals/offset/history          — Offset history for charts
POST   /api/signals/offset/webhook          — TradingView webhook receiver (auth via secret token)

POST   /api/signals/config                 — Create/update config
GET    /api/signals/config                 — Get current config
PATCH  /api/signals/config/toggle          — Enable/disable pipeline

POST   /api/signals/sources               — Add signal source
GET    /api/signals/sources               — List sources

POST   /api/signals/telegram/auth          — Start Telegram auth
POST   /api/signals/telegram/verify        — Verify 2FA code
GET    /api/signals/telegram/status        — Connection status
```

### Trade Journal

```
GET    /api/journal                         — List entries (paginated, filterable)
POST   /api/journal                         — Create entry
GET    /api/journal/:id                     — Single entry
PATCH  /api/journal/:id                     — Update entry
DELETE /api/journal/:id                     — Delete entry
GET    /api/journal/stats                   — Performance by setup/mood
POST   /api/journal/:id/screenshot          — Upload screenshot
```

### Admin

```
GET    /api/admin/users                     — List users with roles
POST   /api/admin/users/:id/roles           — Grant role
DELETE /api/admin/users/:id/roles/:role     — Revoke role
```

---

## 18. Telegram Integration

### Recommended: GramJS User Client (MTProto)

Runs as part of the worker process. Listens to any channel the user is a member of — no bot required.

```
npm install telegram
```

**Auth flow:**
1. User enters phone number on `/signals/settings`
2. Backend sends code via Telegram
3. User enters code (+ 2FA password if enabled)
4. Session string is stored encrypted in the database
5. Worker uses session string to maintain persistent connection

### Alternative: Bot Webhook

If the signal channel allows bots, a simpler webhook approach can be used as a fallback.

---

## 19. Contract Roll Handling

Both NQ and ES futures expire quarterly (3rd Friday of March/June/September/December).

**Detection:** Monitor offset values. If either jumps by more than 100 points (NQ) or 30 points (ES) between consecutive readings, flag a potential roll.

**Handling:**
1. Auto-pause the pipeline
2. Send notification: "Contract roll detected on [NQ/ES]. Offset jumped from +85 to +210. Pipeline paused."
3. User updates contract references and resumes

**Upcoming rolls:**
- Current: NQM2026 / ESM2026 (June 2026 expiry: June 20)
- Next: NQU2026 / ESU2026 (September 2026)

---

## 20. New Environment Variables

```env
# Telegram
TELEGRAM_API_ID=
TELEGRAM_API_HASH=
TELEGRAM_SESSION=            # Encrypted session string

# Signal Pipeline
SIGNAL_PIPELINE_ENABLED=false
SIGNAL_DRY_RUN=true

# TradingView Webhook (offset data)
TRADINGVIEW_WEBHOOK_SECRET=  # Must match the secret in your Pine Script indicator
```

All other settings (lot sizes, offsets, thresholds) are stored in `signalConfigs` in the database, configurable through the UI.

---

## 21. File Structure (New Files)

```
src/
├── app/
│   ├── (app)/
│   │   ├── signals/                    # NEW
│   │   │   ├── page.tsx               # Signal dashboard
│   │   │   └── settings/
│   │   │       └── page.tsx           # Signal config
│   │   └── journal/                    # NEW
│   │       └── page.tsx               # Trade journal
│   └── api/
│       ├── signals/                    # NEW
│       │   ├── route.ts
│       │   ├── [id]/route.ts
│       │   ├── executions/route.ts
│       │   ├── config/route.ts
│       │   ├── sources/route.ts
│       │   ├── offset/
│       │   │   ├── current/route.ts
│       │   │   └── history/route.ts
│       │   ├── telegram/
│       │   │   ├── auth/route.ts
│       │   │   ├── verify/route.ts
│       │   │   └── status/route.ts
│       │   ├── stats/route.ts
│       │   └── webhook/
│       │       └── telegram/route.ts
│       ├── journal/                    # NEW
│       │   ├── route.ts
│       │   ├── [id]/route.ts
│       │   ├── stats/route.ts
│       │   └── tags/route.ts
│       └── admin/                      # NEW
│           └── users/route.ts
├── components/
│   ├── signals/                        # NEW
│   │   ├── SignalDashboard.tsx
│   │   ├── SignalTable.tsx
│   │   ├── OffsetChart.tsx
│   │   ├── PipelineStatus.tsx
│   │   ├── SignalConfig.tsx
│   │   └── TelegramConnect.tsx
│   └── journal/                        # NEW
│       ├── JournalTimeline.tsx
│       ├── JournalEntry.tsx
│       ├── JournalEditor.tsx
│       └── SetupStats.tsx
├── lib/
│   └── signals/                        # NEW
│       ├── execute.ts                 # Main execution pipeline
│       ├── order-type.ts              # Order type decision
│       ├── parser.ts                  # Message parser (calibrated)
│       ├── price-cache.ts            # In-memory price cache
│       ├── offset.ts                 # Offset calculation (NQ + ES)
│       ├── cancel.ts                 # Cancellation handler
│       ├── sizing.ts                # Position sizing + order chunking
│       ├── margin.ts                # Margin validation (pre-execution check)
│       ├── breakeven.ts             # Split-target TP1→TP2 breakeven monitor
│       └── telegram.ts              # GramJS client wrapper
├── workers/
│   ├── trade-sync.ts                  # Existing
│   └── signal-listener.ts            # NEW
└── types/
    └── signals.ts                      # NEW
```

---

## 22. Implementation Phases

### Phase A: Foundation (Week 1)
- Database schema additions (6 new tables)
- Role-based access control middleware
- Admin role management page
- Signal config CRUD + settings page UI
- Seed admin user with all roles

### Phase B: Signal Pipeline Core (Week 2)
- Signal parser (calibrated to bot format)
- Offset calculation engine (dual instrument)
- Order type decision logic
- Position sizing engine (strict, % balance, % equity)
- MetaApi order execution (market, stop, limit)
- Cancellation handler
- Execution logging with latency tracking
- Dry run mode

### Phase C: Telegram + Price Streaming (Week 3)
- GramJS Telegram client integration
- Telegram auth flow (phone → code → session)
- Signal listener worker process
- MetaApi WebSocket price streaming for NAS100, US500, NQ, ES
- Price cache
- Worker process combining trade-sync + signal-listener

### Phase D: Signal Dashboard UI (Week 3–4)
- Signal dashboard with summary cards
- Signal/execution table with instrument filter
- Dual offset chart (NQ + ES)
- Pipeline status indicator
- Execution detail view

### Phase E: Trade Journal (Week 4–5)
- Journal CRUD + API
- Journal timeline UI
- Auto-create entries for signal copies
- Setup type / emotional state / rating / tags
- Screenshot upload
- Performance analytics by setup and mood

### Phase F: Polish (Week 5–6)
- Real-time updates (SSE or polling)
- Toast notifications on signal execution
- Contract roll detection + auto-pause
- Mobile responsive signal dashboard
- CSV export for signal execution history
- Pine Script indicator for TradingView (already built — include in docs)
