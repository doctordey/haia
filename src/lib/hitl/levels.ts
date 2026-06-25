/**
 * HITL level geometry — pure, no I/O.
 *
 * Given an entry reference and a range (high/low) plus a direction, derive
 * SL, R, and the TP ladder. The SL/R derivation is gated by `SL_FROM`
 * (HITL_DESIGN.md §D1); the locked default is `range_size` — the range width
 * *is* R and the stop sits one R from entry.
 *
 * NOTE: the TP ladder multiples (1R/2R/3R) are reconstructed from the brief,
 * pending the authoritative `Haia_HITL_Execution_Spec.md`. They live in one
 * constant so reconciliation is a one-line change.
 */

import type { SlFrom } from './config';

export type Direction = 'BUY' | 'SELL';

/** Default R-multiples for the TP ladder. TP1 = BE trigger, TP2 = Leg A, TP3 = Leg B.
 *  Configurable per-deployment (env HITL_TP{1,2,3}_R / Settings → HITL → Targets). */
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
  slFrom: SlFrom;
  tpMultiples?: TpMultiples;   // defaults to TP_MULTIPLES
}

export function computeLevels(input: ComputeLevelsInput): LevelsResult {
  const { entry, rangeHigh, rangeLow, direction, slFrom } = input;
  const mult = input.tpMultiples ?? TP_MULTIPLES;

  if (![entry, rangeHigh, rangeLow].every((n) => Number.isFinite(n))) {
    return { ok: false, reason: 'entry, rangeHigh and rangeLow must all be finite numbers' };
  }
  if (rangeHigh <= rangeLow) {
    return { ok: false, reason: `invalid range: high (${rangeHigh}) must be greater than low (${rangeLow})` };
  }

  let sl: number;
  let r: number;

  if (slFrom === 'range_size') {
    // Range width IS R; stop sits one R from entry on the protective side.
    r = rangeHigh - rangeLow;
    sl = direction === 'BUY' ? entry - r : entry + r;
  } else {
    // protective_edge: stop at the far edge of the range; R is the distance to it.
    sl = direction === 'BUY' ? rangeLow : rangeHigh;
    r = Math.abs(entry - sl);
  }

  if (!(r > 0)) {
    return { ok: false, reason: `non-positive R (${r}) — entry/range/direction are inconsistent` };
  }

  const sign = direction === 'BUY' ? 1 : -1;
  const tp1 = entry + sign * mult.tp1 * r;
  const tp2 = entry + sign * mult.tp2 * r;
  const tp3 = entry + sign * mult.tp3 * r;

  return { ok: true, levels: { direction, entry, sl, r, tp1, tp2, tp3 } };
}
