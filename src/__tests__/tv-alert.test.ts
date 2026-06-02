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
    riskPercent: 1,
    tpRMultiple: 5,
    beAtRMultiple: 1,
    partialCloseAtRMultiple: 2,
    partialClosePercent: 50,
    closeAtRMultiple: 5,
    slPipOffset: 2,
    pipSize: 0.01,
    pipValuePerLot: 0.10,
    sizingMode: 'percent_equity',
    strictLots: 0.01,
    minLotSize: 0.01,
    lotStep: 0.01,
    maxLotSize: 100,
    maxLotsPerOrder: 50,
    spilloverMode: 'cap',
    minStopDistancePips: 5,
    maxRiskPercent: 10,
    maxSlippage: 5,
    marginWarningThreshold: 80,
    marginRejectThreshold: 95,
    maxOffsetAbs: 10,
    invalidationCloseEnabled: true,
    watermarkEnabled: false,
    watermarkDrawdownThreshold: 10,
    watermarkRiskReductionPercent: 50,
    marketCloseTimezone: 'America/Los_Angeles',
    marketCloseHour: 14,
    marketCloseMinute: 0,
    ...overrides,
  };
}

function ukConfig(overrides: Partial<TvAlertConfig> = {}): TvAlertConfig {
  return xbrConfig({
    id: 'cfg-uk',
    tvSymbol: 'UK10YBG',
    fusionSymbol: 'UKGILT',
    ...overrides,
  });
}

const account: AccountInfo = { balance: 10_000, equity: 10_000 };

function activation(overrides: Partial<TvAlertPayload> = {}): TvAlertPayload {
  return {
    secret: 'x',
    alert_type: 'activation',
    tv_symbol: 'XBRUSD',
    direction: 'LONG',
    tv_price: 75.50,
    prev_5m_high: 75.55,
    prev_5m_low: 75.40,
    ...overrides,
  };
}

describe('computeTradeParams — XBRUSD activation (no offset)', () => {
  it('LONG: SL 2 pips below candle low, TP at 5R', () => {
    const result = computeTradeParams(activation(), xbrConfig(), account, 1.0);
    if ('error' in result) throw new Error(result.error);

    expect(result.offsetApplied).toBe(0);
    expect(result.entryPrice).toBe(75.5);
    // SL = 75.40 - 0.02 = 75.38
    expect(result.stopLoss).toBeCloseTo(75.38, 5);
    // R distance = 0.12; TP = entry + 5×R = 75.50 + 0.60 = 76.10
    expect(result.takeProfit).toBeCloseTo(76.10, 5);
    expect(result.rDistance).toBeCloseTo(0.12, 5);
    expect(result.lotSize).toBeGreaterThan(0);
    expect(result.riskMultiplierApplied).toBe(1.0);
  });

  it('SHORT: SL above candle high, TP at 5R below entry', () => {
    const result = computeTradeParams(
      activation({ direction: 'SHORT', prev_5m_high: 75.60, prev_5m_low: 75.45 }),
      xbrConfig(),
      account,
      1.0,
    );
    if ('error' in result) throw new Error(result.error);
    // SL = 75.60 + 0.02 = 75.62; R = 0.12; TP = 75.50 - 0.60 = 74.90
    expect(result.stopLoss).toBeCloseTo(75.62, 5);
    expect(result.takeProfit).toBeCloseTo(74.90, 5);
  });

  it('uses breaker_high/low when provided (preferred over prev_5m_*)', () => {
    const result = computeTradeParams(
      activation({ breaker_high: 75.80, breaker_low: 75.10 }),
      xbrConfig(),
      account,
      1.0,
    );
    if ('error' in result) throw new Error(result.error);
    expect(result.stopLoss).toBeCloseTo(75.08, 5);  // 75.10 - 0.02
    expect(result.breakerLowAdjusted).toBeCloseTo(75.10, 5);
  });

  it('rejects LONG when low is above current price', () => {
    const result = computeTradeParams(
      activation({ tv_price: 75.20, prev_5m_high: 75.55, prev_5m_low: 75.40 }),
      xbrConfig(),
      account,
      1.0,
    );
    expect('error' in result).toBe(true);
  });

  it('rejects when stop distance is below min', () => {
    const result = computeTradeParams(
      activation({ prev_5m_high: 75.51, prev_5m_low: 75.49 }),
      xbrConfig({ minStopDistancePips: 5 }),
      account,
      1.0,
    );
    expect('error' in result).toBe(true);
  });
});

describe('computeTradeParams — UK10YBG → UKGILT (inline offset)', () => {
  it('subtracts offset from candle H/L for Fusion price space', () => {
    const payload = activation({
      tv_symbol: 'UK10YBG',
      tv_price: 91.55,
      fusion_price: 91.20,
      prev_5m_high: 91.60,
      prev_5m_low: 91.50,
    });
    const result = computeTradeParams(payload, ukConfig(), account, 1.0);
    if ('error' in result) throw new Error(result.error);

    expect(result.offsetApplied).toBeCloseTo(0.35, 5);
    expect(result.entryPrice).toBe(91.20);
    expect(result.breakerLowAdjusted).toBeCloseTo(91.15, 5);
    expect(result.stopLoss).toBeCloseTo(91.13, 5);
    // R = 0.07, TP = 91.20 + 5×0.07 = 91.55
    expect(result.takeProfit).toBeCloseTo(91.55, 5);
  });

  it('requires fusion_price when symbols differ', () => {
    const payload = activation({
      tv_symbol: 'UK10YBG',
      tv_price: 91.55,
      prev_5m_high: 91.60,
      prev_5m_low: 91.50,
    });
    const result = computeTradeParams(payload, ukConfig(), account, 1.0);
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error).toMatch(/fusion_price/);
  });

  it('rejects when offset exceeds maxOffsetAbs', () => {
    const payload = activation({
      tv_symbol: 'UK10YBG',
      tv_price: 91.55,
      fusion_price: 70.0,
      prev_5m_high: 91.60,
      prev_5m_low: 91.50,
    });
    const result = computeTradeParams(payload, ukConfig({ maxOffsetAbs: 10 }), account, 1.0);
    expect('error' in result).toBe(true);
  });
});

describe('lot sizing', () => {
  it('1% risk × tight stop produces a meaningful lot size', () => {
    const result = computeTradeParams(activation(), xbrConfig(), account, 1.0);
    if ('error' in result) throw new Error(result.error);
    expect(result.lotSize).toBeGreaterThan(0);
    expect(result.riskAmount).toBe(100); // 10_000 × 1%
  });

  it('applies watermark risk multiplier proportionally', () => {
    const full   = computeTradeParams(activation(), xbrConfig(), account, 1.0);
    const halved = computeTradeParams(activation(), xbrConfig(), account, 0.5);
    if ('error' in full || 'error' in halved) throw new Error('unexpected error');
    expect(halved.lotSize).toBeCloseTo(full.lotSize / 2, 1);
    expect(halved.riskMultiplierApplied).toBe(0.5);
  });

  it('caps at maxLotSize in cap spillover mode', () => {
    // Tiny stop, high risk %, huge balance → unbounded lots would be massive.
    const result = computeTradeParams(
      activation({ prev_5m_low: 75.45 }),                     // 5 pip stop
      xbrConfig({ riskPercent: 5, maxLotSize: 10, spilloverMode: 'cap' }),
      { balance: 1_000_000, equity: 1_000_000 },
      1.0,
    );
    if ('error' in result) throw new Error(result.error);
    expect(result.lotSize).toBe(10);
    expect(result.orderSizes).toEqual([10]);
  });

  it('splits into multiple orders in split spillover mode', () => {
    const result = computeTradeParams(
      activation({ prev_5m_low: 75.45 }),
      xbrConfig({ riskPercent: 5, maxLotSize: 10, spilloverMode: 'split' }),
      { balance: 1_000_000, equity: 1_000_000 },
      1.0,
    );
    if ('error' in result) throw new Error(result.error);
    expect(result.orderSizes.length).toBeGreaterThan(1);
    expect(result.lotSize).toBeGreaterThan(10);
    // All but possibly the last should be at the max
    expect(result.orderSizes.slice(0, -1).every((v) => v === 10)).toBe(true);
  });
});

describe('validatePayload', () => {
  it('requires alert_type', () => {
    const v = validatePayload({ secret: 'x', tv_symbol: 'XBRUSD' });
    expect(v.ok).toBe(false);
  });

  it('activation requires direction and price + breaker/candle', () => {
    expect(validatePayload({
      secret: 'x',
      alert_type: 'activation',
      tv_symbol: 'XBRUSD',
      tv_price: 75,
      // no direction, no breaker, no prev candle
    }).ok).toBe(false);

    expect(validatePayload({
      secret: 'x',
      alert_type: 'activation',
      tv_symbol: 'XBRUSD',
      direction: 'LONG',
      tv_price: 75,
      prev_5m_high: 75.1,
      prev_5m_low: 74.9,
    }).ok).toBe(true);
  });

  it('target_reached requires r_level', () => {
    expect(validatePayload({
      secret: 'x',
      alert_type: 'target_reached',
      tv_symbol: 'XBRUSD',
    }).ok).toBe(false);

    expect(validatePayload({
      secret: 'x',
      alert_type: 'target_reached',
      tv_symbol: 'XBRUSD',
      r_level: 1,
    }).ok).toBe(true);
  });

  it('invalidation_hit only needs tv_symbol + secret + alert_type', () => {
    expect(validatePayload({
      secret: 'x',
      alert_type: 'invalidation_hit',
      tv_symbol: 'XBRUSD',
    }).ok).toBe(true);
  });
});
