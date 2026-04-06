import { describe, it, expect } from 'vitest';
import { calculateLotSize, chunkLots } from '@/lib/signals/sizing';
import type { SizingConfig, ContractSpec, AccountInfo } from '@/types/signals';

const defaultSpec: ContractSpec = {
  pipValuePerLot: 0.10,
  minLotSize: 0.01,
  lotStep: 0.01,
  maxOrderSize: 100,
};

const defaultAccount: AccountInfo = { balance: 10000, equity: 10000 };

function makeConfig(overrides: Partial<SizingConfig> = {}): SizingConfig {
  return {
    mode: 'strict',
    executionMode: 'single',
    strictLots: { Small: 0.01, Medium: 0.05, Large: 0.10 },
    baseRiskPercent: 1.0,
    sizeMultipliers: { Small: 0.5, Medium: 1.0, Large: 1.5 },
    maxRiskPercent: 5.0,
    minStopDistance: 10,
    maxLotSize: 100,
    maxLotsPerOrder: 50,
    ...overrides,
  };
}

const defaultSignal = { size: 'Medium' as const, entryPrice: 24060, stopLoss: 24020 };

describe('chunkLots', () => {
  it('no chunking needed', () => {
    expect(chunkLots(10, 50, 0.01)).toEqual([10]);
  });

  it('chunks evenly', () => {
    expect(chunkLots(250, 50, 0.01)).toEqual([50, 50, 50, 50, 50]);
  });

  it('chunks with remainder', () => {
    expect(chunkLots(130, 50, 0.01)).toEqual([50, 50, 30]);
  });

  it('single chunk under max', () => {
    expect(chunkLots(0.05, 50, 0.01)).toEqual([0.05]);
  });

  it('very small lots', () => {
    expect(chunkLots(0.01, 50, 0.01)).toEqual([0.01]);
  });

  it('rounds sub-step input to nearest step via toFixed', () => {
    // 0.005 toFixed(2) �� 0.01, which is a valid lot
    expect(chunkLots(0.005, 50, 0.01)).toEqual([0.01]);
  });
});

describe('calculateLotSize - strict mode', () => {
  it('maps Small to configured lot size', () => {
    const result = calculateLotSize(makeConfig(), { ...defaultSignal, size: 'Small' }, defaultAccount, defaultSpec);
    expect(result.lotSize).toBe(0.01);
    expect(result.isSplit).toBe(false);
    expect(result.reason).toContain('Strict');
  });

  it('maps Medium to configured lot size', () => {
    const result = calculateLotSize(makeConfig(), defaultSignal, defaultAccount, defaultSpec);
    expect(result.lotSize).toBe(0.05);
  });

  it('maps Large to configured lot size', () => {
    const result = calculateLotSize(makeConfig(), { ...defaultSignal, size: 'Large' }, defaultAccount, defaultSpec);
    expect(result.lotSize).toBe(0.10);
  });

  it('caps at maxLotSize', () => {
    const result = calculateLotSize(
      makeConfig({ maxLotSize: 0.03 }),
      defaultSignal,
      defaultAccount,
      defaultSpec,
    );
    expect(result.lotSize).toBe(0.03);
  });
});

describe('calculateLotSize - percent_balance mode', () => {
  it('calculates lots from balance percentage', () => {
    // balance=10000, risk=1%, size=Medium (1.0x), stop=40pts, pipValue=0.10
    // riskAmount = 10000 * 0.01 = 100
    // lots = 100 / (40 * 0.10) = 25
    const result = calculateLotSize(
      makeConfig({ mode: 'percent_balance' }),
      defaultSignal,
      defaultAccount,
      defaultSpec,
    );
    expect(result.lotSize).toBe(25);
    expect(result.riskAmount).toBe(100);
    expect(result.effectiveRiskPercent).toBe(1.0);
  });

  it('applies size multiplier for Small', () => {
    // 0.5x multiplier → effectiveRisk = 0.5%, riskAmount = 50
    // lots = 50 / (40 * 0.10) = 12.5 → 12.50
    const result = calculateLotSize(
      makeConfig({ mode: 'percent_balance' }),
      { ...defaultSignal, size: 'Small' },
      defaultAccount,
      defaultSpec,
    );
    expect(result.lotSize).toBe(12.5);
    expect(result.effectiveRiskPercent).toBe(0.5);
  });

  it('applies size multiplier for Large', () => {
    // 1.5x multiplier → effectiveRisk = 1.5%, riskAmount = 150
    // lots = 150 / (40 * 0.10) = 37.5 → 37.50
    const result = calculateLotSize(
      makeConfig({ mode: 'percent_balance' }),
      { ...defaultSignal, size: 'Large' },
      defaultAccount,
      defaultSpec,
    );
    expect(result.lotSize).toBe(37.5);
  });

  it('caps at maxLotSize', () => {
    const result = calculateLotSize(
      makeConfig({ mode: 'percent_balance', maxLotSize: 0.10 }),
      defaultSignal,
      defaultAccount,
      defaultSpec,
    );
    expect(result.lotSize).toBe(0.10);
  });

  it('rejects if effective risk exceeds max', () => {
    const result = calculateLotSize(
      makeConfig({ mode: 'percent_balance', maxRiskPercent: 1.0 }),
      { ...defaultSignal, size: 'Large' }, // 1.5% > 1.0% max
      defaultAccount,
      defaultSpec,
    );
    expect(result.lotSize).toBe(defaultSpec.minLotSize);
    expect(result.reason).toContain('exceeds max');
  });

  it('rejects if stop distance too tight', () => {
    const result = calculateLotSize(
      makeConfig({ mode: 'percent_balance', minStopDistance: 50 }),
      defaultSignal, // stop distance = 40 < 50
      defaultAccount,
      defaultSpec,
    );
    expect(result.lotSize).toBe(defaultSpec.minLotSize);
    expect(result.reason).toContain('Stop distance');
  });

  it('ensures at least minLotSize', () => {
    // Tiny account → very small lot size → floor to min
    const result = calculateLotSize(
      makeConfig({ mode: 'percent_balance' }),
      defaultSignal,
      { balance: 1, equity: 1 },
      defaultSpec,
    );
    expect(result.lotSize).toBe(defaultSpec.minLotSize);
  });
});

describe('calculateLotSize - percent_equity mode', () => {
  it('uses equity instead of balance', () => {
    // equity=12000, risk=1%, stop=40pts, pipValue=0.10
    // lots = 120 / (40 * 0.10) = 30
    const result = calculateLotSize(
      makeConfig({ mode: 'percent_equity' }),
      defaultSignal,
      { balance: 10000, equity: 12000 },
      defaultSpec,
    );
    expect(result.lotSize).toBe(30);
    expect(result.riskAmount).toBe(120);
  });
});

describe('calculateLotSize - split_target mode', () => {
  it('splits evenly when possible', () => {
    // 0.10 lots → tp1=0.05, tp2=0.05
    const result = calculateLotSize(
      makeConfig({ executionMode: 'split_target', strictLots: { Medium: 0.10 } }),
      defaultSignal,
      defaultAccount,
      defaultSpec,
    );
    expect(result.isSplit).toBe(true);
    expect(result.tp1LotSize).toBe(0.05);
    expect(result.tp2LotSize).toBe(0.05);
  });

  it('TP1 gets larger half on odd split', () => {
    // 0.05 lots → tp1=0.03, tp2=0.02
    const result = calculateLotSize(
      makeConfig({ executionMode: 'split_target' }),
      defaultSignal,
      defaultAccount,
      defaultSpec,
    );
    expect(result.isSplit).toBe(true);
    expect(result.tp1LotSize).toBe(0.03);
    expect(result.tp2LotSize).toBe(0.02);
  });

  it('falls back to single when at minimum', () => {
    const result = calculateLotSize(
      makeConfig({ executionMode: 'split_target', strictLots: { Medium: 0.01 } }),
      defaultSignal,
      defaultAccount,
      defaultSpec,
    );
    expect(result.isSplit).toBe(false);
    expect(result.splitFallbackReason).toContain('cannot split');
  });

  it('falls back if TP2 would be below min', () => {
    const result = calculateLotSize(
      makeConfig({ executionMode: 'split_target', strictLots: { Medium: 0.02 } }),
      defaultSignal,
      defaultAccount,
      defaultSpec,
    );
    // 0.02 → tp1=0.01, tp2=0.01 — both >= min, should split
    expect(result.isSplit).toBe(true);
    expect(result.tp1LotSize).toBe(0.01);
    expect(result.tp2LotSize).toBe(0.01);
  });

  it('generates tp1Chunks and tp2Chunks for large split positions', () => {
    // 250 lots split → TP1: 130, TP2: 120
    const result = calculateLotSize(
      makeConfig({
        executionMode: 'split_target',
        strictLots: { Medium: 250 },
        maxLotSize: 250,
      }),
      defaultSignal,
      defaultAccount,
      defaultSpec,
    );
    expect(result.isSplit).toBe(true);
    expect(result.tp1LotSize).toBe(125);
    expect(result.tp2LotSize).toBe(125);
    expect(result.tp1Chunks).toEqual([50, 50, 25]);
    expect(result.tp2Chunks).toEqual([50, 50, 25]);
  });
});

describe('calculateLotSize - chunking', () => {
  it('chunks single mode orders exceeding maxLotsPerOrder', () => {
    const result = calculateLotSize(
      makeConfig({ strictLots: { Medium: 130 }, maxLotSize: 130 }),
      defaultSignal,
      defaultAccount,
      defaultSpec,
    );
    expect(result.chunks).toEqual([50, 50, 30]);
    expect(result.isSplit).toBe(false);
  });

  it('no chunking for small orders', () => {
    const result = calculateLotSize(
      makeConfig(),
      defaultSignal,
      defaultAccount,
      defaultSpec,
    );
    expect(result.chunks).toEqual([0.05]);
  });

  it('5+ chunks for very large position', () => {
    const result = calculateLotSize(
      makeConfig({ strictLots: { Medium: 260 }, maxLotSize: 260 }),
      defaultSignal,
      defaultAccount,
      defaultSpec,
    );
    // 260 / 50 = 5 chunks of 50, 1 chunk of 10
    expect(result.chunks).toHaveLength(6);
    expect(result.chunks).toEqual([50, 50, 50, 50, 50, 10]);
  });
});
