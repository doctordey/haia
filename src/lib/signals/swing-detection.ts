// Swing high/low detection on a sequence of candles.
//
// A swing high at index i requires high[i] to be strictly greater than the
// high of `strength` candles on each side. Likewise swing low for `low[i]`.
// The MOST RECENT swing is the one with the largest index that still has
// `strength` candles to its right — so it's at least `strength` bars old.

export interface Candle {
  time: number;   // ms epoch (or any monotonic key)
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface SwingResult {
  found: boolean;
  index: number;       // index in the candles array, -1 if not found
  price: number;       // the high/low value, NaN if not found
  candleTime: number;  // ms epoch, 0 if not found
}

/**
 * Find the most recent swing high in the candle window. A candle qualifies if
 * its high is strictly greater than the high of `strength` candles on either
 * side. Returns the swing closest to "now" — i.e. the largest qualifying index.
 */
export function findSwingHigh(candles: Candle[], strength: number): SwingResult {
  return findSwing(candles, strength, 'high');
}

export function findSwingLow(candles: Candle[], strength: number): SwingResult {
  return findSwing(candles, strength, 'low');
}

function findSwing(candles: Candle[], strength: number, kind: 'high' | 'low'): SwingResult {
  const empty: SwingResult = { found: false, index: -1, price: NaN, candleTime: 0 };
  if (candles.length < 2 * strength + 1) return empty;

  // Scan from the most-recent qualifying index backwards. The most recent
  // index that can possibly qualify is (candles.length - 1 - strength) because
  // it needs `strength` candles to its right.
  for (let i = candles.length - 1 - strength; i >= strength; i--) {
    const pivot = kind === 'high' ? candles[i].high : candles[i].low;
    let qualifies = true;

    for (let k = 1; k <= strength; k++) {
      const left  = kind === 'high' ? candles[i - k].high : candles[i - k].low;
      const right = kind === 'high' ? candles[i + k].high : candles[i + k].low;
      if (kind === 'high') {
        if (pivot <= left || pivot <= right) { qualifies = false; break; }
      } else {
        if (pivot >= left || pivot >= right) { qualifies = false; break; }
      }
    }

    if (qualifies) {
      return { found: true, index: i, price: pivot, candleTime: candles[i].time };
    }
  }
  return empty;
}

/**
 * For a LONG: the SL anchor is the most recent swing low BELOW the entry
 * price (otherwise we'd be placing SL above entry, nonsense).
 * For a SHORT: most recent swing high ABOVE entry.
 */
export function findAnchorForDirection(
  candles: Candle[],
  direction: 'LONG' | 'SHORT',
  entryPrice: number,
  strength: number,
): SwingResult {
  // Find the most recent swing in the right kind, then walk backwards if it's
  // on the wrong side of entry.
  if (direction === 'LONG') {
    return findValidSwing(candles, strength, 'low', (price) => price < entryPrice);
  }
  return findValidSwing(candles, strength, 'high', (price) => price > entryPrice);
}

function findValidSwing(
  candles: Candle[],
  strength: number,
  kind: 'high' | 'low',
  predicate: (price: number) => boolean,
): SwingResult {
  const empty: SwingResult = { found: false, index: -1, price: NaN, candleTime: 0 };
  if (candles.length < 2 * strength + 1) return empty;

  for (let i = candles.length - 1 - strength; i >= strength; i--) {
    const pivot = kind === 'high' ? candles[i].high : candles[i].low;
    let qualifies = true;
    for (let k = 1; k <= strength; k++) {
      const left  = kind === 'high' ? candles[i - k].high : candles[i - k].low;
      const right = kind === 'high' ? candles[i + k].high : candles[i + k].low;
      if (kind === 'high') {
        if (pivot <= left || pivot <= right) { qualifies = false; break; }
      } else {
        if (pivot >= left || pivot >= right) { qualifies = false; break; }
      }
    }
    if (qualifies && predicate(pivot)) {
      return { found: true, index: i, price: pivot, candleTime: candles[i].time };
    }
  }
  return empty;
}
