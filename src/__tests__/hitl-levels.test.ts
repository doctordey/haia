import { describe, it, expect } from 'vitest';
import { computeLevels, inferDirection, TP_MULTIPLES } from '@/lib/hitl/levels';
import { computeLots, splitLegs, valuePerPoint, type HitlSymbolSpec } from '@/lib/hitl/sizing';

// ── Geometry: range-anchored (SL at protective edge, TPs projected from the far edge) ──

describe('computeLevels — range-anchored', () => {
  it('BUY: SL at range low, TPs projected from range high (1R/2R/5R)', () => {
    const r = computeLevels({ entry: 5000, rangeHigh: 5010, rangeLow: 4990, direction: 'BUY' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.levels).toMatchObject({ r: 20, sl: 4990, tp1: 5030, tp2: 5050, tp3: 5110 });
  });

  it('SELL: SL at range high, TPs projected down from range low', () => {
    const r = computeLevels({ entry: 5000, rangeHigh: 5010, rangeLow: 4990, direction: 'SELL' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.levels).toMatchObject({ r: 20, sl: 5010, tp1: 4970, tp2: 4950, tp3: 4890 });
  });

  it('the ladder is independent of the entry price (entry only recorded)', () => {
    const a = computeLevels({ entry: 5000, rangeHigh: 5010, rangeLow: 4990, direction: 'BUY' });
    const b = computeLevels({ entry: 5007, rangeHigh: 5010, rangeLow: 4990, direction: 'BUY' });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.levels.sl).toBe(b.levels.sl);
    expect(a.levels.tp1).toBe(b.levels.tp1);
    expect(a.levels.tp3).toBe(b.levels.tp3);
    expect(a.levels.entry).toBe(5000);
    expect(b.levels.entry).toBe(5007);
  });

  it('default TP multiples are 1R/2R/5R', () => {
    expect(TP_MULTIPLES).toEqual({ tp1: 1, tp2: 2, tp3: 5 });
  });

  it('honours custom TP multiples (from the far edge)', () => {
    const r = computeLevels({ entry: 5000, rangeHigh: 5010, rangeLow: 4990, direction: 'BUY', tpMultiples: { tp1: 1, tp2: 3, tp3: 6 } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.levels).toMatchObject({ tp1: 5030, tp2: 5070, tp3: 5130 });
  });
});

describe('computeLevels — validation', () => {
  it('rejects an inverted range', () => {
    const r = computeLevels({ entry: 5000, rangeHigh: 4990, rangeLow: 5010, direction: 'BUY' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/invalid range/);
  });

  it('rejects non-finite inputs', () => {
    const r = computeLevels({ entry: NaN, rangeHigh: 5010, rangeLow: 4990, direction: 'BUY' });
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
