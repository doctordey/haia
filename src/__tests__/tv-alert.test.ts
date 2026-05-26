import { describe, it, expect } from 'vitest';
import { computeTradeParams, validatePayload } from '@/lib/signals/tv-alert';
import type { TvAlertConfig, TvAlertPayload } from '@/types/tv-alerts';
import type { AccountInfo } from '@/types/signals';

function xbrConfig(overrides: Partial<TvAlertConfig> = {}): TvAlertConfig {
  return {
    id: 'cfg-xbr',
    userId: 'u1',
    accountId: 'acc1',
    tvSymbol: 'XBRUSD',
    fusionSymbol: 'XBRUSD',
    isEnabled: true,
    dryRun: false,
    riskPercent: 5,
    rewardRiskRatio: 2,
    slPipOffset: 2,
    pipSize: 0.01,
    pipValuePerLot: 0.10,
    sizingMode: 'percent_equity',
    strictLots: 0.01,
    minLotSize: 0.01,
    lotStep: 0.01,
    maxLotSize: 100,
    maxLotsPerOrder: 50,
    minStopDistancePips: 5,
    maxRiskPercent: 10,
    maxSlippage: 5,
    marginWarningThreshold: 80,
    marginRejectThreshold: 95,
    maxOffsetAbs: 10,
    ...overrides,
  };
}

function ukConfig(overrides: Partial<TvAlertConfig> = {}): TvAlertConfig {
  return {
    ...xbrConfig({
      id: 'cfg-uk',
      tvSymbol: 'UK10YBG',
      fusionSymbol: 'UKGILT',
      rewardRiskRatio: 1,
    }),
    ...overrides,
  };
}

const account: AccountInfo = { balance: 10_000, equity: 10_000 };

describe('computeTradeParams — XBRUSD (no offset)', () => {
  it('LONG: SL is 2 pips below prev candle low, TP is 2× SL distance above entry', () => {
    const payload: TvAlertPayload = {
      secret: 'x',
      tv_symbol: 'XBRUSD',
      direction: 'LONG',
      tv_price: 75.50,
      prev_5m_high: 75.55,
      prev_5m_low: 75.40,
    };

    const result = computeTradeParams(payload, xbrConfig(), account);
    if ('error' in result) throw new Error(result.error);

    expect(result.offsetApplied).toBe(0);
    expect(result.entryPrice).toBe(75.5);
    // SL = 75.40 - (2 × 0.01) = 75.38
    expect(result.stopLoss).toBeCloseTo(75.38, 5);
    // distance = 0.12 → TP = 75.50 + 2 × 0.12 = 75.74
    expect(result.takeProfit).toBeCloseTo(75.74, 5);
    expect(result.stopDistancePips).toBeCloseTo(12, 2);
    expect(result.lotSize).toBeGreaterThan(0);
  });

  it('SHORT: SL is 2 pips above prev candle high, TP below entry', () => {
    const payload: TvAlertPayload = {
      secret: 'x',
      tv_symbol: 'XBRUSD',
      direction: 'SHORT',
      tv_price: 75.50,
      prev_5m_high: 75.60,
      prev_5m_low: 75.45,
    };

    const result = computeTradeParams(payload, xbrConfig(), account);
    if ('error' in result) throw new Error(result.error);

    // SL = 75.60 + 0.02 = 75.62
    expect(result.stopLoss).toBeCloseTo(75.62, 5);
    // distance = 0.12 → TP = 75.50 - 2 × 0.12 = 75.26
    expect(result.takeProfit).toBeCloseTo(75.26, 5);
  });

  it('rejects LONG when prev candle low is above current price (impossible setup)', () => {
    const payload: TvAlertPayload = {
      secret: 'x',
      tv_symbol: 'XBRUSD',
      direction: 'LONG',
      tv_price: 75.20,
      prev_5m_high: 75.55,
      prev_5m_low: 75.40,
    };

    const result = computeTradeParams(payload, xbrConfig(), account);
    expect('error' in result).toBe(true);
  });

  it('rejects when stop distance is below min', () => {
    const payload: TvAlertPayload = {
      secret: 'x',
      tv_symbol: 'XBRUSD',
      direction: 'LONG',
      tv_price: 75.50,
      prev_5m_high: 75.51,
      prev_5m_low: 75.49,    // only 1 pip below entry
    };

    const result = computeTradeParams(payload, xbrConfig({ minStopDistancePips: 5 }), account);
    expect('error' in result).toBe(true);
  });
});

describe('computeTradeParams — UK10YBG → UKGILT (with inline offset)', () => {
  it('subtracts offset from prev candle H/L so SL sits in Fusion price space', () => {
    // UK10YBG at 91.55, UKGILT at 91.20 → offset = 0.35
    const payload: TvAlertPayload = {
      secret: 'x',
      tv_symbol: 'UK10YBG',
      direction: 'LONG',
      tv_price: 91.55,
      fusion_price: 91.20,
      prev_5m_high: 91.60,
      prev_5m_low: 91.50,
    };

    const result = computeTradeParams(payload, ukConfig(), account);
    if ('error' in result) throw new Error(result.error);

    expect(result.offsetApplied).toBeCloseTo(0.35, 5);
    expect(result.fusionPriceAtAlert).toBe(91.20);
    expect(result.entryPrice).toBe(91.20);

    // prevLowFusion = 91.50 - 0.35 = 91.15 → SL = 91.15 - 0.02 = 91.13
    expect(result.prevCandleLowAdjusted).toBeCloseTo(91.15, 5);
    expect(result.stopLoss).toBeCloseTo(91.13, 5);

    // RR=1: TP = 91.20 + 1 × (91.20 - 91.13) = 91.27
    expect(result.takeProfit).toBeCloseTo(91.27, 5);
  });

  it('requires fusion_price when symbols differ', () => {
    const payload: TvAlertPayload = {
      secret: 'x',
      tv_symbol: 'UK10YBG',
      direction: 'LONG',
      tv_price: 91.55,
      prev_5m_high: 91.60,
      prev_5m_low: 91.50,
      // fusion_price missing
    };

    const result = computeTradeParams(payload, ukConfig(), account);
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error).toMatch(/fusion_price/);
  });

  it('rejects when offset exceeds maxOffsetAbs (data sanity)', () => {
    const payload: TvAlertPayload = {
      secret: 'x',
      tv_symbol: 'UK10YBG',
      direction: 'LONG',
      tv_price: 91.55,
      fusion_price: 70.0,    // 21.55 offset — way out of band
      prev_5m_high: 91.60,
      prev_5m_low: 91.50,
    };

    const result = computeTradeParams(payload, ukConfig({ maxOffsetAbs: 10 }), account);
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error).toMatch(/offset/i);
  });
});

describe('lot sizing', () => {
  it('5% of equity × XBRUSD setup produces a reasonable lot size', () => {
    const payload: TvAlertPayload = {
      secret: 'x',
      tv_symbol: 'XBRUSD',
      direction: 'LONG',
      tv_price: 75.50,
      prev_5m_high: 75.55,
      prev_5m_low: 75.40,
    };

    const result = computeTradeParams(payload, xbrConfig(), account);
    if ('error' in result) throw new Error(result.error);

    // riskAmount = 10,000 × 5% = $500
    // stopDistancePips = 12
    // pipValuePerLot = $0.10/pip → cost per lot for full stop = 12 × $0.10 = $1.20
    // lots = $500 / $1.20 = 416.67 → capped at maxLotSize=100
    expect(result.lotSize).toBe(100);
    expect(result.riskAmount).toBe(500);
  });

  it('scales lot size down for wider stops', () => {
    const tightPayload: TvAlertPayload = {
      secret: 'x',
      tv_symbol: 'XBRUSD',
      direction: 'LONG',
      tv_price: 75.50,
      prev_5m_high: 75.55,
      prev_5m_low: 74.50,    // 100 pip distance + 2 pip buffer = 102 pips
    };
    const widePayload: TvAlertPayload = { ...tightPayload, prev_5m_low: 70.0 }; // ~552 pips

    // Cap below the unbounded calc so sizing is the binding constraint, not the cap.
    const cfg = xbrConfig({ maxLotSize: 50 });
    const tight = computeTradeParams(tightPayload, cfg, account);
    const wide  = computeTradeParams(widePayload, cfg, account);

    if ('error' in tight || 'error' in wide) throw new Error('unexpected error');
    expect(wide.lotSize).toBeLessThan(tight.lotSize);
  });
});

describe('validatePayload', () => {
  it('rejects missing fields', () => {
    expect(validatePayload({}).ok).toBe(false);
    expect(validatePayload({ secret: 'x' }).ok).toBe(false);
    expect(validatePayload({ secret: 'x', tv_symbol: 'XBRUSD' }).ok).toBe(false);
  });

  it('rejects invalid direction', () => {
    const v = validatePayload({
      secret: 'x',
      tv_symbol: 'XBRUSD',
      // @ts-expect-error testing runtime guard
      direction: 'BUY',
      tv_price: 75,
      prev_5m_high: 75.1,
      prev_5m_low: 74.9,
    });
    expect(v.ok).toBe(false);
  });

  it('rejects high < low', () => {
    const v = validatePayload({
      secret: 'x',
      tv_symbol: 'XBRUSD',
      direction: 'LONG',
      tv_price: 75,
      prev_5m_high: 74.9,
      prev_5m_low: 75.1,
    });
    expect(v.ok).toBe(false);
  });

  it('accepts a well-formed payload', () => {
    expect(
      validatePayload({
        secret: 'x',
        tv_symbol: 'XBRUSD',
        direction: 'LONG',
        tv_price: 75,
        prev_5m_high: 75.1,
        prev_5m_low: 74.9,
      }).ok,
    ).toBe(true);
  });
});
