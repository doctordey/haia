/**
 * Parser for the TradingView "Unicorn" alert text (pure, no I/O).
 *
 * The indicator fires plain-text alert() strings, e.g.:
 *   "Activated 5m Bearish Unicorn [1H OHLC] on US30 @ 50788.71"
 *   "Target Reached: 5m Bearish Unicorn [1H OHLC] on ETHUSD @ 1671.72"
 *
 * Both message types arrive through one webhook ("Any alert() function call"),
 * so the route routes on `type`. Direction comes from Bullish/Bearish, the
 * symbol from `on <SYM> @`, and the reference price from `@ <price>`. No range,
 * SL, TP, or id is present — the operator supplies the range via Telegram, and
 * Target-Reached is correlated to the open trade by symbol + direction.
 */

import type { Direction } from './levels';

export type AlertType = 'activation' | 'target_reached' | 'unknown';

export interface AlertInfo {
  type: AlertType;
  direction: Direction | null;
  symbol: string | null;
  price: number | null;
  raw: string;
}

const SYMBOL_RE = /\bon\s+([A-Za-z0-9._/]+)\s*@/i;
const PRICE_RE = /@\s*([0-9]+(?:\.[0-9]+)?)/;

export function parseAlert(text: string): AlertInfo {
  const raw = text ?? '';

  const type: AlertType = /target\s*reached/i.test(raw)
    ? 'target_reached'
    : /activated/i.test(raw)
      ? 'activation'
      : 'unknown';

  const direction: Direction | null = /\bbullish\b/i.test(raw)
    ? 'BUY'
    : /\bbearish\b/i.test(raw)
      ? 'SELL'
      : null;

  const symbolMatch = raw.match(SYMBOL_RE);
  const symbol = symbolMatch ? symbolMatch[1].toUpperCase() : null;

  const priceMatch = raw.match(PRICE_RE);
  const price = priceMatch ? Number(priceMatch[1]) : null;

  return { type, direction, symbol, price, raw };
}
