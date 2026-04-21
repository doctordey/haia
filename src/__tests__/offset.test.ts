import { describe, it, expect, vi } from 'vitest';
import { getOffset, adjustSignalLevels } from '@/lib/signals/offset';
import type { PriceCache, SignalConfig, ParsedSignal } from '@/types/signals';

function makeConfig(overrides: Partial<SignalConfig> = {}): SignalConfig {
  return {
    id: 'cfg1',
    isEnabled: true,
    dryRun: false,
    nqSymbol: 'NAS100',
    esSymbol: 'US500',
    nqSmallLots: 0.01, nqMediumLots: 0.05, nqLargeLots: 0.10,
    esSmallLots: 0.01, esMediumLots: 0.05, esLargeLots: 0.10,
    offsetMode: 'webhook',
    nqFixedOffset: 198,
    esFixedOffset: 40,
    nqMaxOffset: 400,
    nqMinOffset: 50,
    esMaxOffset: 150,
    esMinOffset: 10,
    sizingMode: 'strict',
    executionMode: 'single',
    baseRiskPercent: 1,
    maxRiskPercent: 5,
    nqBaseRiskPercent: null,
    nqMaxRiskPercent: null,
    esBaseRiskPercent: null,
    esMaxRiskPercent: null,
    minStopDistance: 10,
    maxLotSize: 100,
    smallMultiplier: 0.5,
    mediumMultiplier: 1.0,
    largeMultiplier: 1.5,
    maxLotsPerOrder: 50,
    marketOrderThreshold: 5,
    nqMarketOrderThreshold: null,
    esMarketOrderThreshold: null,
    maxSlippage: 5,
    marginWarningThreshold: 80,
    marginRejectThreshold: 95,
    ...overrides,
  };
}

function makeCache(data: {
  nqOffset?: number; esOffset?: number;
  nqFuturesPrice?: number; esFuturesPrice?: number;
  nas100Price?: number; us500Price?: number;
  receivedAt?: number;
} | null): PriceCache {
  return {
    getOffset: () => data ? {
      nqOffset: data.nqOffset ?? 198,
      esOffset: data.esOffset ?? 40,
      nqFuturesPrice: data.nqFuturesPrice ?? 24060,
      esFuturesPrice: data.esFuturesPrice ?? 6606,
      nas100Price: data.nas100Price ?? 23862,
      us500Price: data.us500Price ?? 6566,
      receivedAt: data.receivedAt ?? Date.now(),
    } : null,
    getFusionPrice: () => null,
  };
}

describe('getOffset', () => {
  it('returns webhook offset for NQ when fresh', () => {
    const result = getOffset('NQ', makeCache({ nqOffset: 200 }), makeConfig());
    expect(result.source).toBe('webhook');
    expect(result.offset).toBe(200);
    expect(result.isStale).toBe(false);
  });

  it('returns webhook offset for ES', () => {
    const result = getOffset('ES', makeCache({ esOffset: 42 }), makeConfig());
    expect(result.source).toBe('webhook');
    expect(result.offset).toBe(42);
  });

  it('falls back to fixed when webhook data is null', () => {
    const result = getOffset('NQ', makeCache(null), makeConfig());
    expect(result.source).toBe('fixed');
    expect(result.offset).toBe(198);
    expect(result.isStale).toBe(true);
  });

  it('falls back to fixed when webhook data is stale (>24h)', () => {
    const staleTime = Date.now() - 25 * 60 * 60 * 1000;
    const result = getOffset('NQ', makeCache({ receivedAt: staleTime }), makeConfig());
    expect(result.source).toBe('fixed');
    expect(result.isStale).toBe(true);
  });

  it('returns zero offset in none mode', () => {
    const result = getOffset('NQ', makeCache({ nqOffset: 200 }), makeConfig({ offsetMode: 'none' }));
    expect(result.offset).toBe(0);
    expect(result.source).toBe('none');
  });

  it('uses fixed mode directly', () => {
    const result = getOffset('ES', makeCache({ esOffset: 42 }), makeConfig({ offsetMode: 'fixed' }));
    expect(result.source).toBe('fixed');
    expect(result.offset).toBe(40);
  });

  it('throws if webhook offset exceeds max', () => {
    expect(() =>
      getOffset('NQ', makeCache({ nqOffset: 500 }), makeConfig({ nqMaxOffset: 400 })),
    ).toThrow('exceeds max');
  });

  it('throws if webhook offset below min', () => {
    expect(() =>
      getOffset('NQ', makeCache({ nqOffset: 30 }), makeConfig({ nqMinOffset: 50 })),
    ).toThrow('below min');
  });
});

describe('adjustSignalLevels', () => {
  it('subtracts offset from all levels', () => {
    const signal: ParsedSignal = {
      tradeNumber: 1,
      instrument: 'NQ',
      direction: 'LONG',
      entryPrice: 24060,
      tp1: 24088,
      tp2: 24160,
      stopLoss: 24020,
      size: 'Medium',
    };

    const result = adjustSignalLevels(signal, 198);
    expect(result.entry).toBe(23862);
    expect(result.tp1).toBe(23890);
    expect(result.tp2).toBe(23962);
    expect(result.sl).toBe(23822);
  });

  it('handles zero offset', () => {
    const signal: ParsedSignal = {
      tradeNumber: 1,
      instrument: 'NQ',
      direction: 'LONG',
      entryPrice: 24060,
      tp1: 24088,
      tp2: 24160,
      stopLoss: 24020,
      size: 'Medium',
    };

    const result = adjustSignalLevels(signal, 0);
    expect(result.entry).toBe(24060);
  });

  it('handles fractional offsets', () => {
    const signal: ParsedSignal = {
      tradeNumber: 1,
      instrument: 'ES',
      direction: 'LONG',
      entryPrice: 6606,
      tp1: 6634,
      tp2: 6660,
      stopLoss: 6596,
      size: 'Medium',
    };

    const result = adjustSignalLevels(signal, 40.5);
    expect(result.entry).toBe(6565.5);
    expect(result.sl).toBe(6555.5);
  });
});
