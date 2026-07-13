/**
 * Parser for the TradingView alert texts (pure, no I/O) — two strategies share
 * one webhook and are distinguished by syntax:
 *
 * Unicorn (the original HITL module):
 *   "Activated 5m Bearish Unicorn [1H OHLC] on US30 @ 50788.71"
 *   "Target Reached: 5m Bearish Unicorn [1H OHLC] on ETHUSD @ 1671.72"
 *
 * Forever:
 *   "Bullish Forever Model (5m 90m Cycle) on NAS100"                        → entry (no price!)
 *   "Forever Model (5m 90m Cycle): Bullish Orderblock Projection Hit on ETHUSD" → TP1 → breakeven
 *   "Forever Model (5m 90m Cycle): Bullish ERL Hit[ on SYMBOL]"             → notification only
 *
 * Forever entry alerts carry no reference price — the service resolves the live
 * quote when the operator submits the range. ERL Hit may omit the symbol; it is
 * forward-only so that's acceptable.
 */

import type { Direction } from './levels';

export type AlertStrategy = 'unicorn' | 'forever';
export type AlertType = 'activation' | 'target_reached' | 'notification' | 'unknown';

export interface AlertInfo {
  strategy: AlertStrategy;
  type: AlertType;
  direction: Direction | null;
  symbol: string | null;
  price: number | null;
  raw: string;
}

const SYMBOL_RE = /\bon\s+([A-Za-z0-9._/!:]+)\s*@/i;
const PRICE_RE = /@\s*([0-9]+(?:\.[0-9]+)?)/;

/** Trailing "on SYMBOL" with no price after it (Forever alerts carry no price). */
const SYMBOL_NO_PRICE_RE = /\bon\s+([A-Za-z0-9._/!:]+)\s*$/i;

function parseDirection(raw: string): Direction | null {
  if (/\bbullish\b/i.test(raw)) return 'BUY';
  if (/\bbearish\b/i.test(raw)) return 'SELL';
  return null;
}

/** The original Unicorn syntax. */
export function parseAlert(text: string): AlertInfo {
  const raw = text ?? '';

  const type: AlertType = /target\s*reached/i.test(raw)
    ? 'target_reached'
    : /activated/i.test(raw)
      ? 'activation'
      : 'unknown';

  const symbolMatch = raw.match(SYMBOL_RE);
  const symbol = symbolMatch ? symbolMatch[1].toUpperCase() : null;

  const priceMatch = raw.match(PRICE_RE);
  const price = priceMatch ? Number(priceMatch[1]) : null;

  return { strategy: 'unicorn', type, direction: parseDirection(raw), symbol, price, raw };
}

/** The Forever syntax (no reference price on entries). */
export function parseForeverAlert(text: string): AlertInfo {
  const raw = text ?? '';
  const direction = parseDirection(raw);

  // "Forever Model (…): … Hit [on SYMBOL]" — event alerts.
  if (/\bERL\s+Hit\b/i.test(raw)) {
    const m = raw.match(SYMBOL_NO_PRICE_RE);
    return { strategy: 'forever', type: 'notification', direction, symbol: m ? m[1].toUpperCase() : null, price: null, raw };
  }
  if (/\bOrderblock\s+Projection\s+Hit\b/i.test(raw)) {
    const m = raw.match(SYMBOL_NO_PRICE_RE);
    // OB projection = the strategy's TP1 → breakeven, correlated by symbol+direction.
    return { strategy: 'forever', type: 'target_reached', direction, symbol: m ? m[1].toUpperCase() : null, price: null, raw };
  }

  // "Bullish Forever Model (5m 90m Cycle) on NAS100" — entry signal.
  const entry = raw.match(/^\s*(Bullish|Bearish)\s+Forever\s+Model\b.*?\bon\s+([A-Za-z0-9._/!:]+)\s*$/i);
  if (entry) {
    return { strategy: 'forever', type: 'activation', direction, symbol: entry[2].toUpperCase(), price: null, raw };
  }

  return { strategy: 'forever', type: 'unknown', direction, symbol: null, price: null, raw };
}

/** Route to the right parser by syntax ("Forever Model" marks the Forever strategy). */
export function parseAnyAlert(text: string): AlertInfo {
  const raw = text ?? '';
  return /\bForever\s+Model\b/i.test(raw) ? parseForeverAlert(raw) : parseAlert(raw);
}
