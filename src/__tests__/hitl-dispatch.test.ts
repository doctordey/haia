import { describe, it, expect, vi } from 'vitest';
import { buildLegPlan, preDispatchGates, openLegs } from '@/lib/hitl/dispatch';
import { loadHitlConfig, type HitlConfig } from '@/lib/hitl/config';
import type { ComputedLevels } from '@/lib/hitl/levels';
import type { HitlSymbolSpec } from '@/lib/hitl/sizing';
import { clientIdFor, signalIdPrefix, type HitlBroker, type HitlPosition, type OpenOrderParams } from '@/lib/hitl/metaapi';

const spec: HitlSymbolSpec = { tickValue: 1, tickSize: 1, volumeMin: 0.01, volumeMax: 100, volumeStep: 0.01 };

const buyLevels: ComputedLevels = { direction: 'BUY', entry: 5000, sl: 4980, r: 20, tp1: 5020, tp2: 5040, tp3: 5060 };

function cfg(overrides: Partial<HitlConfig> = {}): HitlConfig {
  return { ...loadHitlConfig({} as NodeJS.ProcessEnv), ...overrides };
}

describe('clientId tagging (MetaApi pattern-safe)', () => {
  it('strips hyphens and caps length for auto-derived signal ids (the case that failed)', () => {
    const id = clientIdFor('auto-0d4f95fbf9bbc946', 'A');
    expect(id).toBe('hh_auto0d4f95fbf9bb_A');
    expect(id).toMatch(/^[a-zA-Z0-9_]+$/);   // no hyphens / illegal chars
    expect(id.length).toBeLessThanOrEqual(26); // MetaApi combined-length cap
  });

  it('prefix is a strict prefix of each leg clientId', () => {
    const prefix = signalIdPrefix('auto-0d4f95fbf9bbc946');
    expect(clientIdFor('auto-0d4f95fbf9bbc946', 'A').startsWith(prefix)).toBe(true);
    expect(clientIdFor('auto-0d4f95fbf9bbc946', 'B').startsWith(prefix)).toBe(true);
  });

  it('caps long ids well within the length limit', () => {
    const id = clientIdFor('x'.repeat(100), 'B');
    expect(id.length).toBeLessThanOrEqual(26);
    expect(id).toMatch(/^[a-zA-Z0-9_]+$/);
  });
});

describe('buildLegPlan', () => {
  it('two-position: Leg A → TP2, Leg B → TP3', () => {
    const plan = buildLegPlan('sig1', buyLevels, 2.5, cfg(), spec);
    expect(plan.collapsed).toBe(false);
    expect(plan.legs).toEqual([
      { leg: 'A', tp: 5040, volume: 1.25, clientId: 'hh_sig1_A', ticket: null, status: 'pending' },
      { leg: 'B', tp: 5060, volume: 1.25, clientId: 'hh_sig1_B', ticket: null, status: 'pending' },
    ]);
  });

  it('collapses to single leg → TP3 when too small to split', () => {
    const plan = buildLegPlan('sig2', buyLevels, 0.01, cfg(), spec);
    expect(plan.collapsed).toBe(true);
    expect(plan.legs).toHaveLength(1);
    expect(plan.legs[0]).toMatchObject({ leg: 'A', tp: 5060, volume: 0.01 });
  });

  it('single-position model: one leg → TP3', () => {
    const plan = buildLegPlan('sig3', buyLevels, 2.5, cfg({ positionModel: 'single' }), spec);
    expect(plan.legs).toHaveLength(1);
    expect(plan.legs[0]).toMatchObject({ leg: 'A', tp: 5060, volume: 2.5 });
  });
});

describe('preDispatchGates', () => {
  const base = { levels: buyLevels, lots: 1, equity: 100000, spec, cfg: cfg(), isDemo: true };

  it('passes a clean demo trade', () => {
    expect(preDispatchGates(base)).toEqual({ ok: true });
  });

  it('blocks a live account while HITL_ALLOW_LIVE is off', () => {
    const r = preDispatchGates({ ...base, isDemo: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/live account blocked/);
  });

  it('allows a live account once HITL_ALLOW_LIVE is on', () => {
    expect(preDispatchGates({ ...base, isDemo: false, cfg: cfg({ allowLive: true }) })).toEqual({ ok: true });
  });

  it('rejects a stop-loss on the wrong side', () => {
    const bad: ComputedLevels = { ...buyLevels, sl: 5020 };
    const r = preDispatchGates({ ...base, levels: bad });
    expect(r.ok).toBe(false);
  });

  it('rejects when risk exceeds the cap', () => {
    // huge size relative to equity → way over MAX_RISK_PER_TRADE (5%)
    const r = preDispatchGates({ ...base, lots: 1000, equity: 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/exceeds cap/);
  });

  it('rejects an unordered TP ladder', () => {
    const bad: ComputedLevels = { ...buyLevels, tp3: 5010 };
    expect(preDispatchGates({ ...base, levels: bad }).ok).toBe(false);
  });
});

// ── openLegs with a mock broker ──

function mockBroker(openImpl: (p: OpenOrderParams) => Promise<{ ticket: string }>): HitlBroker {
  return {
    isDemo: () => true,
    getEquity: () => 100000,
    ensureSymbol: async () => {},
    getSymbolSpec: () => spec,
    getPrice: () => ({ bid: 5000, ask: 5000 }),
    openOrder: vi.fn(openImpl),
    modifySl: vi.fn(async () => {}),
    partialClose: vi.fn(async () => {}),
    positionsBySignal: (): HitlPosition[] => [],
  };
}

const twoLegs = () => buildLegPlan('sigX', buyLevels, 2.5, cfg(), spec).legs;

describe('openLegs', () => {
  it('opens both legs → OPEN', async () => {
    let n = 0;
    const broker = mockBroker(async () => ({ ticket: `t${++n}` }));
    const res = await openLegs(broker, {
      symbol: 'NAS100', direction: 'BUY', entryMode: 'market', sl: 4980,
      legs: twoLegs(), slippage: 10, partialLegFailure: 'alert_hold',
    });
    expect(res.status).toBe('OPEN');
    expect(res.legs.map((l) => l.status)).toEqual(['open', 'open']);
    expect(res.legs.map((l) => l.ticket)).toEqual(['t1', 't2']);
  });

  it('fails closed when the first leg errors → FAILED, no fills', async () => {
    const broker = mockBroker(async () => { throw new Error('broker down'); });
    const res = await openLegs(broker, {
      symbol: 'NAS100', direction: 'BUY', entryMode: 'market', sl: 4980,
      legs: twoLegs(), slippage: 10, partialLegFailure: 'alert_hold',
    });
    expect(res.status).toBe('FAILED');
    expect(res.message).toMatch(/before any fill/);
  });

  it('alert_hold: keeps the filled leg when the second errors → OPEN + alert', async () => {
    let n = 0;
    const broker = mockBroker(async () => {
      n++;
      if (n === 2) throw new Error('rejected');
      return { ticket: `t${n}` };
    });
    const res = await openLegs(broker, {
      symbol: 'NAS100', direction: 'BUY', entryMode: 'market', sl: 4980,
      legs: twoLegs(), slippage: 10, partialLegFailure: 'alert_hold',
    });
    expect(res.status).toBe('OPEN');
    expect(res.alert).toMatch(/Partial dispatch/);
    expect(res.legs.map((l) => l.status)).toEqual(['open', 'failed']);
  });

  it('auto_close: closes the filled leg when the second errors → FAILED', async () => {
    let n = 0;
    const broker = mockBroker(async () => {
      n++;
      if (n === 2) throw new Error('rejected');
      return { ticket: `t${n}` };
    });
    const res = await openLegs(broker, {
      symbol: 'NAS100', direction: 'BUY', entryMode: 'market', sl: 4980,
      legs: twoLegs(), slippage: 10, partialLegFailure: 'auto_close',
    });
    expect(res.status).toBe('FAILED');
    expect(broker.partialClose).toHaveBeenCalledWith('t1', 1.25);
    expect(res.legs[0].status).toBe('closed');
  });
});
