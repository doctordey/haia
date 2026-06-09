/**
 * HITL sizing — thin wrappers over the existing signal-pipeline sizing math.
 *
 * Per the brief's explicit instruction, we do NOT invent a second sizing
 * method: `computeLots` reuses `calculateLotSize` (risk / (R × valuePerPoint),
 * clamped to volumeMin/Max, rounded to volumeStep). The only HITL-specific bit
 * is sourcing the contract spec generically from MetaApi and splitting the
 * total into two legs (Leg A → TP2, Leg B → TP3).
 */

import { calculateLotSize } from '@/lib/signals/sizing';
import type { SizingConfig, ContractSpec, AccountInfo } from '@/types/signals';

/** Generic per-symbol spec, sourced from MetaApi `getSymbolSpecification`. */
export interface HitlSymbolSpec {
  tickValue: number;   // account-currency value of one tick, per lot
  tickSize: number;    // price increment of one tick
  volumeMin: number;
  volumeMax: number;
  volumeStep: number;
}

export interface ComputeLotsInput {
  equity: number;
  riskPct: number;
  maxRiskPct: number;
  entry: number;
  sl: number;
  spec: HitlSymbolSpec;
  riskMode?: 'percent' | 'fixed';
  fixedRiskAmount?: number; // $ per trade when riskMode === 'fixed'
}

export interface ComputeLotsResult {
  lots: number;
  riskAmount: number;
  reason: string;
}

/** $ value of a one-point move per lot, derived generically from the spec. */
export function valuePerPoint(spec: HitlSymbolSpec): number {
  return spec.tickValue / spec.tickSize;
}

export function computeLots(input: ComputeLotsInput): ComputeLotsResult {
  const { equity, riskPct, maxRiskPct, entry, sl, spec } = input;

  const contractSpec: ContractSpec = {
    pipValuePerLot: valuePerPoint(spec),
    minLotSize: spec.volumeMin,
    lotStep: spec.volumeStep,
    maxOrderSize: spec.volumeMax,
  };

  // Fixed-$ mode maps onto the same percent_equity path by expressing the
  // dollar amount as a percent of live equity — so the max-risk cap and all
  // the lot clamps/rounding apply identically to both modes.
  const effectiveRiskPct =
    input.riskMode === 'fixed' && input.fixedRiskAmount && input.fixedRiskAmount > 0 && equity > 0
      ? (input.fixedRiskAmount / equity) * 100
      : riskPct;

  // Map HITL's risk-percent model onto the existing percent_equity path.
  const sizingConfig: SizingConfig = {
    mode: 'percent_equity',
    executionMode: 'single',          // HITL does its own two-leg split
    strictLots: {},
    baseRiskPercent: effectiveRiskPct,
    sizeMultipliers: { Small: 1, Medium: 1, Large: 1 },
    maxRiskPercent: maxRiskPct,
    minStopDistance: 0,               // R is already validated > 0 by computeLevels
    maxLotSize: spec.volumeMax,
    maxLotsPerOrder: spec.volumeMax,  // HITL manages legs, not per-order chunking
  };

  const account: AccountInfo = { balance: equity, equity };

  const result = calculateLotSize(
    sizingConfig,
    { size: 'Medium', entryPrice: entry, stopLoss: sl },
    account,
    contractSpec,
  );

  return { lots: result.lotSize, riskAmount: result.riskAmount, reason: result.reason };
}

// ── Leg split ────────────────────────────────────────

export interface SplitLeg {
  leg: 'A' | 'B';
  volume: number;
}

export interface SplitResult {
  legs: SplitLeg[];      // two legs normally; one leg when collapsed
  collapsed: boolean;    // true → couldn't split, single front-loaded position
  reason?: string;
}

function stepDecimals(step: number): number {
  const s = step.toString();
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

function floorToStep(value: number, step: number): number {
  const decimals = stepDecimals(step);
  const floored = Math.floor((value + 1e-9) / step) * step;
  return parseFloat(floored.toFixed(decimals));
}

/**
 * Split total lots into Leg A (legSplit share) and Leg B (remainder), each
 * re-clamped to the volume step. If either leg falls below volumeMin, collapse
 * to a single front-loaded position and tell the caller.
 */
export function splitLegs(totalLots: number, legSplit: number, spec: HitlSymbolSpec): SplitResult {
  const decimals = stepDecimals(spec.volumeStep);
  const total = parseFloat(totalLots.toFixed(decimals));

  const legA = floorToStep(total * legSplit, spec.volumeStep);
  const legB = parseFloat((total - legA).toFixed(decimals));

  if (legA < spec.volumeMin || legB < spec.volumeMin) {
    return {
      legs: [{ leg: 'A', volume: total }],
      collapsed: true,
      reason: `total ${total} lots too small to split at ${legSplit} (min lot ${spec.volumeMin}) — single front-loaded position`,
    };
  }

  return { legs: [{ leg: 'A', volume: legA }, { leg: 'B', volume: legB }], collapsed: false };
}
