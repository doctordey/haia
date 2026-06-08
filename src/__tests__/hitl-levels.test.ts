import { describe, it, expect } from 'vitest';
import { computeLevels, inferDirection, TP_MULTIPLES } from '@/lib/hitl/levels';
import { computeLots, splitLegs, valuePerPoint, type HitlSymbolSpec } from '@/lib/hitl/sizing';

// ── Geometry: SL_FROM = range_size (locked default) ──

describe('computeLevels — range_size', () => {
  it('BUY: range width is R, stop one R below entry, TP ladder 1R/2R/3R', () => {
    const r = computeLevels({ entry: 5000, rangeHigh: 5010, rangeLow: 4990, direction: 'BUY', slFrom: 'range_size' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.levels).toMatchObject({ r: 20, sl: 4980, tp1: 5020, tp2: 5040, tp3: 5060 });
  });

  it('SELL: stop one R above entry, TPs descend', () => {
    const r = computeLevels({ entry: 5000, rangeHigh: 5010, rangeLow: 4990, direction: 'SELL', slFrom: 'range_size' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.levels).toMatchObject({ r: 20, sl: 5020, tp1: 4980, tp2: 4960, tp3: 4940 });
  });

  it('TP multiples are the documented ladder', () => {
    expect(TP_MULTIPLES).toEqual({ tp1: 1, tp2: 2, tp3: 3 });
  });
});

describe('computeLevels — protective_edge (alt)', () => {
  it('BUY: stop at range low, R is entry→low distance', () => {
    const r = computeLevels({ entry: 5010, rangeHigh: 5010, rangeLow: 4990, direction: 'BUY', slFrom: 'protective_edge' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.levels).toMatchObject({ sl: 4990, r: 20, tp1: 5030 });
  });

  it('rejects non-positive R when entry sits on the stop edge', () => {
    const r = computeLevels({ entry: 4990, rangeHigh: 5010, rangeLow: 4990, direction: 'BUY', slFrom: 'protective_edge' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/non-positive R/);
  });
});

describe('computeLevels — validation', () => {
  it('rejects an inverted range', () => {
    const r = computeLevels({ entry: 5000, rangeHigh: 4990, rangeLow: 5010, direction: 'BUY', slFrom: 'range_size' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/invalid range/);
  });

  it('rejects non-finite inputs', () => {
    const r = computeLevels({ entry: NaN, rangeHigh: 5010, rangeLow: 4990, direction: 'BUY', slFrom: 'range_size' });
    expect(r.ok).toBe(false);
  });
});

describe('inferDirection', () => {
  it('breakout above range → BUY', () => expect(inferDirection(5011, 5010, 4990)).toBe('BUY'));
  it('breakdown below range → SELL', () => expect(inferDirection(4989, 5010, 4990)).toBe('SELL'));
  it('inside range → null (must ask)', () => expect(inferDirection(5000, 5010, 4990)).toBeNull());
});

// ── Sizing: reuse of calculateLotSize across instruments ──

const specs: Record<string, HitlSymbolSpec> = {
  NAS100: { tickValue: 1, tickSize: 1, volumeMin: 0.01, volumeMax: 100, volumeStep: 0.01 },
  US500:  { tickValue: 1, tickSize: 1, volumeMin: 0.01, volumeMax: 100, volumeStep: 0.01 },
  XAUUSD: { tickValue: 1, tickSize: 0.01, volumeMin: 0.01, volumeMax: 100, volumeStep: 0.01 },
  BTCUSD: { tickValue: 1, tickSize: 1, volumeMin: 0.01, volumeMax: 100, volumeStep: 0.01 },
  EURUSD: { tickValue: 1, tickSize: 0.0001, volumeMin: 0.01, volumeMax: 100, volumeStep: 0.01 },
};

describe('valuePerPoint', () => {
  it('derives $/point from tickValue / tickSize', () => {
    expect(valuePerPoint(specs.XAUUSD)).toBe(100);
    expect(valuePerPoint(specs.EURUSD)).toBe(10000);
  });
});

describe('computeLots — risk / (R × valuePerPoint), all instruments', () => {
  const equity = 10000;
  const riskPct = 1;          // $100 risk
  const maxRiskPct = 5;

  it('NAS100 long: R=40pts, vpp=1 → 2.5 lots', () => {
    const r = computeLots({ equity, riskPct, maxRiskPct, entry: 24060, sl: 24020, spec: specs.NAS100 });
    expect(r.lots).toBeCloseTo(2.5, 5);
    expect(r.riskAmount).toBeCloseTo(100, 5);
  });

  it('US500 short: R=20pts, vpp=1 → 5 lots', () => {
    const r = computeLots({ equity, riskPct, maxRiskPct, entry: 4980, sl: 5000, spec: specs.US500 });
    expect(r.lots).toBeCloseTo(5, 5);
  });

  it('XAUUSD long: R=$10, vpp=100 → 0.1 lots', () => {
    const r = computeLots({ equity, riskPct, maxRiskPct, entry: 2000, sl: 1990, spec: specs.XAUUSD });
    expect(r.lots).toBeCloseTo(0.1, 5);
  });

  it('BTCUSD long: R=$1000, vpp=1 → 0.1 lots', () => {
    const r = computeLots({ equity, riskPct, maxRiskPct, entry: 60000, sl: 59000, spec: specs.BTCUSD });
    expect(r.lots).toBeCloseTo(0.1, 5);
  });

  it('EURUSD long: R=50pips, vpp=10000 → ~2 lots (floored to step)', () => {
    // 100 / (0.005 × 10000) = 1.9999… which floors to the 0.01 step → 1.99
    const r = computeLots({ equity, riskPct, maxRiskPct, entry: 1.1000, sl: 1.0950, spec: specs.EURUSD });
    expect(r.lots).toBe(1.99);
  });

  it('clamps to volumeMax', () => {
    const capped: HitlSymbolSpec = { ...specs.NAS100, volumeMax: 1 };
    const r = computeLots({ equity, riskPct, maxRiskPct, entry: 24060, sl: 24020, spec: capped });
    expect(r.lots).toBe(1);
  });
});

describe('splitLegs', () => {
  it('splits 50/50 into Leg A and Leg B', () => {
    const r = splitLegs(2.5, 0.5, specs.NAS100);
    expect(r.collapsed).toBe(false);
    expect(r.legs).toEqual([{ leg: 'A', volume: 1.25 }, { leg: 'B', volume: 1.25 }]);
  });

  it('honours an uneven split ratio', () => {
    const r = splitLegs(2.5, 0.6, specs.NAS100);
    expect(r.legs).toEqual([{ leg: 'A', volume: 1.5 }, { leg: 'B', volume: 1.0 }]);
  });

  it('collapses to a single front-loaded leg when too small to split', () => {
    const r = splitLegs(0.01, 0.5, specs.NAS100);
    expect(r.collapsed).toBe(true);
    expect(r.legs).toEqual([{ leg: 'A', volume: 0.01 }]);
    expect(r.reason).toMatch(/single front-loaded/);
  });
});
