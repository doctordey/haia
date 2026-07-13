/**
 * HITL level geometry — pure, no I/O.
 *
 * Range-anchored: the operator's range defines every level, independent of the
 * exact fill price.
 *   • R (the projection unit) = range height (high − low)
 *   • SL = the protective edge (BUY → range low, SELL → range high)
 *   • TPn = far edge + multiple×R in the trade direction
 *            (BUY → high + n×R, SELL → low − n×R)
 *
 * The entry price plays no part in the ladder — it only drives lot sizing
 * (risk = fill→SL distance) and the pre-dispatch sanity gates (SL on the
 * protective side of the fill, TPs beyond it).
 */

export type Direction = 'BUY' | 'SELL';

/** Default R-multiples for the TP ladder. TP1 = BE trigger, TP2 = Leg A, TP3 = Leg B.
 *  Configurable per-deployment (env HITL_TP{1,2,3}_R / Settings → Unicorn → Targets). */
export const TP_MULTIPLES = { tp1: 1, tp2: 2, tp3: 5 } as const;

export interface TpMultiples { tp1: number; tp2: number; tp3: number }

export interface ComputedLevels {
  direction: Direction;
  entry: number;
  sl: number;
  r: number;
  tp1: number;
  tp2: number;
  tp3: number;
}

export type LevelsResult =
  | { ok: true; levels: ComputedLevels }
  | { ok: false; reason: string };

/**
 * Infer direction from where the entry sits relative to the range.
 * Entry strictly inside the range is ambiguous → caller must ask (AWAITING_DIRECTION).
 */
export function inferDirection(entry: number, rangeHigh: number, rangeLow: number): Direction | null {
  if (entry >= rangeHigh) return 'BUY';
  if (entry <= rangeLow) return 'SELL';
  return null;
}

export interface ComputeLevelsInput {
  entry: number;
  rangeHigh: number;
  rangeLow: number;
  direction: Direction;
  tpMultiples?: TpMultiples;   // defaults to TP_MULTIPLES
}

export function computeLevels(input: ComputeLevelsInput): LevelsResult {
  const { entry, rangeHigh, rangeLow, direction } = input;
  const mult = input.tpMultiples ?? TP_MULTIPLES;

  if (![entry, rangeHigh, rangeLow].every((n) => Number.isFinite(n))) {
    return { ok: false, reason: 'entry, rangeHigh and rangeLow must all be finite numbers' };
  }
  if (rangeHigh <= rangeLow) {
    return { ok: false, reason: `invalid range: high (${rangeHigh}) must be greater than low (${rangeLow})` };
  }

  // Range height is the projection unit.
  const r = rangeHigh - rangeLow;

  const sign = direction === 'BUY' ? 1 : -1;
  const sl = direction === 'BUY' ? rangeLow : rangeHigh;    // protective edge
  const far = direction === 'BUY' ? rangeHigh : rangeLow;   // projection origin

  const tp1 = far + sign * mult.tp1 * r;
  const tp2 = far + sign * mult.tp2 * r;
  const tp3 = far + sign * mult.tp3 * r;

  return { ok: true, levels: { direction, entry, sl, r, tp1, tp2, tp3 } };
}
