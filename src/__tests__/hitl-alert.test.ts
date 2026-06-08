import { describe, it, expect } from 'vitest';
import { parseAlert } from '@/lib/hitl/alert';
import { loadHitlConfig, resolveBrokerSymbol } from '@/lib/hitl/config';
import { resolveWithMap } from '@/lib/hitl/symbol-map';

const ACTIVATION = 'Activated 5m Bearish Unicorn [1H OHLC] on US30 @ 50788.71';
const TARGET = 'Target Reached: 5m Bearish Unicorn [1H OHLC] on ETHUSD @ 1671.72';

describe('parseAlert', () => {
  it('parses an activation (Bearish → SELL)', () => {
    expect(parseAlert(ACTIVATION)).toMatchObject({
      type: 'activation',
      direction: 'SELL',
      symbol: 'US30',
      price: 50788.71,
    });
  });

  it('parses a target-reached (breakeven trigger)', () => {
    expect(parseAlert(TARGET)).toMatchObject({
      type: 'target_reached',
      direction: 'SELL',
      symbol: 'ETHUSD',
      price: 1671.72,
    });
  });

  it('maps Bullish → BUY', () => {
    const a = parseAlert('Activated 15m Bullish Unicorn [1H OHLC] on NAS100 @ 20000');
    expect(a.direction).toBe('BUY');
    expect(a.symbol).toBe('NAS100');
    expect(a.price).toBe(20000);
  });

  it('uppercases symbols and tolerates dotted/slashed tickers', () => {
    expect(parseAlert('Activated 5m Bullish Unicorn on us30.cash @ 100').symbol).toBe('US30.CASH');
    expect(parseAlert('Activated 5m Bearish Unicorn on EUR/USD @ 1.1').symbol).toBe('EUR/USD');
  });

  it('returns unknown for unrelated text', () => {
    expect(parseAlert('hello world').type).toBe('unknown');
    expect(parseAlert('').direction).toBeNull();
  });
});

describe('resolveBrokerSymbol', () => {
  it('is identity by default', () => {
    const cfg = loadHitlConfig({} as NodeJS.ProcessEnv);
    expect(resolveBrokerSymbol(cfg, 'US30')).toBe('US30');
  });

  it('applies a configured env map (UK10YBGBP → UKGILT), case-insensitive', () => {
    const cfg = loadHitlConfig({ HITL_SYMBOL_MAP: 'UK10YBGBP:UKGILT, FOO:BAR' } as unknown as NodeJS.ProcessEnv);
    expect(resolveBrokerSymbol(cfg, 'UK10YBGBP')).toBe('UKGILT');
    expect(resolveBrokerSymbol(cfg, 'uk10ybgbp')).toBe('UKGILT');
    expect(resolveBrokerSymbol(cfg, 'ETHUSD')).toBe('ETHUSD');
  });
});

describe('resolveWithMap (DB-managed map)', () => {
  it('DB rows override, identity otherwise, case-insensitive', () => {
    const map = { UK10YBGBP: 'UKGILT' };
    expect(resolveWithMap(map, 'UK10YBGBP')).toBe('UKGILT');
    expect(resolveWithMap(map, 'uk10ybgbp')).toBe('UKGILT');
    expect(resolveWithMap(map, 'US30')).toBe('US30');
  });

  it('merge semantics: DB wins over env seed', () => {
    const cfg = loadHitlConfig({ HITL_SYMBOL_MAP: 'US30:US30.cash' } as unknown as NodeJS.ProcessEnv);
    const merged = { ...cfg.symbolMap, US30: 'DJ30' }; // DB overrides env
    expect(resolveWithMap(merged, 'US30')).toBe('DJ30');
  });
});
