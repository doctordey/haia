import { describe, it, expect, vi } from 'vitest';
import { executePipeline } from '@/lib/signals/execute';
import type { SignalConfig, PriceCache, MetaApiTradeInterface } from '@/types/signals';

function makeConfig(overrides: Partial<SignalConfig> = {}): SignalConfig {
  return {
    id: 'cfg1',
    isEnabled: true,
    dryRun: true,
    nqSymbol: 'NAS100',
    esSymbol: 'US500',
    nqSmallLots: 0.01, nqMediumLots: 0.05, nqLargeLots: 0.10,
    esSmallLots: 0.01, esMediumLots: 0.05, esLargeLots: 0.10,
    offsetMode: 'none',
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
    minStopDistance: 10,
    maxLotSize: 100,
    smallMultiplier: 0.5,
    mediumMultiplier: 1.0,
    largeMultiplier: 1.5,
    maxLotsPerOrder: 50,
    marketOrderThreshold: 5,
    maxSlippage: 5,
    marginWarningThreshold: 80,
    marginRejectThreshold: 95,
    ...overrides,
  };
}

const mockPriceCache: PriceCache = {
  getOffset: () => null,
  getFusionPrice: () => 23862,
};

const mockMetaApi: MetaApiTradeInterface = {
  createOrder: vi.fn().mockResolvedValue({ orderId: 'order-123' }),
  cancelOrder: vi.fn().mockResolvedValue(undefined),
  modifyPosition: vi.fn().mockResolvedValue(undefined),
  calculateMargin: vi.fn().mockResolvedValue({ margin: 100 }),
  getAccountInformation: vi.fn().mockResolvedValue({ balance: 10000, equity: 10000, freeMargin: 9000 }),
};

const singleSignalMsg = `Trade 1
🟢 LONG NQ @ 24,060
TP1: 24,088
TP2: 24,160
SL: 24,020
Size: Medium`;

describe('executePipeline', () => {
  it('returns empty for non-signal messages', async () => {
    const results = await executePipeline(
      '❌ ALL POSITIONS CANCELLED',
      'sig1', makeConfig(), mockPriceCache, { balance: 10000, equity: 10000 }, mockMetaApi,
    );
    expect(results).toEqual([]);
  });

  it('executes dry run for a single signal', async () => {
    const results = await executePipeline(
      singleSignalMsg,
      'sig1', makeConfig(), mockPriceCache, { balance: 10000, equity: 10000 }, mockMetaApi,
    );
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('dry_run');
    expect(results[0].isDryRun).toBe(true);
    expect(results[0].instrument).toBe('NQ');
    expect(results[0].direction).toBe('LONG');
    expect(results[0].lotSize).toBe(0.05);
  });

  it('sets offset fields with none mode', async () => {
    const results = await executePipeline(
      singleSignalMsg,
      'sig1', makeConfig({ offsetMode: 'none' }), mockPriceCache,
      { balance: 10000, equity: 10000 }, mockMetaApi,
    );
    expect(results[0].offsetApplied).toBe(0);
    expect(results[0].adjustedEntry).toBe(24060);
    expect(results[0].adjustedSl).toBe(24020);
  });

  it('executes multiple signals from same message in parallel', async () => {
    const multiMsg = `Trade 1
🟢 LONG NQ @ 24,060
TP1: 24,088
TP2: 24,160
SL: 24,020
Size: Medium
🟢 LONG ES @ 6,606
TP1: 6,634
TP2: 6,660
SL: 6,596
Size: Medium`;

    const results = await executePipeline(
      multiMsg,
      'sig1', makeConfig(), mockPriceCache, { balance: 10000, equity: 10000 }, mockMetaApi,
    );
    expect(results).toHaveLength(2);
    expect(results[0].instrument).toBe('NQ');
    expect(results[1].instrument).toBe('ES');
  });

  it('generates split executions in split_target mode', async () => {
    const results = await executePipeline(
      singleSignalMsg,
      'sig1',
      makeConfig({ executionMode: 'split_target' }),
      mockPriceCache,
      { balance: 10000, equity: 10000 },
      mockMetaApi,
    );
    // 0.05 lots split → TP1: 0.03, TP2: 0.02
    expect(results).toHaveLength(2);
    expect(results[0].splitIndex).toBe(1);
    expect(results[0].lotSize).toBe(0.03);
    expect(results[1].splitIndex).toBe(2);
    expect(results[1].lotSize).toBe(0.02);
    // Linked together
    expect(results[0].linkedExecutionId).toBeTruthy();
    expect(results[1].linkedExecutionId).toBeTruthy();
  });

  it('sends real orders when not dry run', async () => {
    const metaApi: MetaApiTradeInterface = {
      ...mockMetaApi,
      createOrder: vi.fn().mockResolvedValue({ orderId: 'real-order-1' }),
    };

    const results = await executePipeline(
      singleSignalMsg,
      'sig1',
      makeConfig({ dryRun: false }),
      mockPriceCache,
      { balance: 10000, equity: 10000 },
      metaApi,
    );
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('sent');
    expect(results[0].metaapiOrderId).toBe('real-order-1');
    expect(metaApi.createOrder).toHaveBeenCalled();
  });

  it('rejects trade on margin failure', async () => {
    const metaApi: MetaApiTradeInterface = {
      ...mockMetaApi,
      calculateMargin: vi.fn().mockResolvedValue({ margin: 9800 }),
      getAccountInformation: vi.fn().mockResolvedValue({ balance: 10000, equity: 10000, freeMargin: 10000 }),
    };

    const results = await executePipeline(
      singleSignalMsg,
      'sig1',
      makeConfig({ dryRun: false, marginRejectThreshold: 95 }),
      mockPriceCache,
      { balance: 10000, equity: 10000 },
      metaApi,
    );
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('rejected');
    expect(results[0].errorMessage).toContain('Margin rejected');
  });
});
