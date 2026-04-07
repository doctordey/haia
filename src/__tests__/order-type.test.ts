import { describe, it, expect } from 'vitest';
import { determineOrderType } from '@/lib/signals/order-type';

describe('determineOrderType', () => {
  const threshold = 5.0;

  // LONG scenarios
  it('LONG: market within threshold → MARKET', () => {
    const result = determineOrderType('LONG', 24000, 24003, threshold);
    expect(result.orderType).toBe('MARKET');
    expect(result.reason).toContain('MARKET');
  });

  it('LONG: market exactly at threshold → MARKET', () => {
    const result = determineOrderType('LONG', 24000, 24005, threshold);
    expect(result.orderType).toBe('MARKET');
  });

  it('LONG: market below entry → BUY_STOP', () => {
    const result = determineOrderType('LONG', 24000, 23980, threshold);
    expect(result.orderType).toBe('BUY_STOP');
    expect(result.reason).toContain('BELOW');
  });

  it('LONG: market above entry → BUY_LIMIT', () => {
    const result = determineOrderType('LONG', 24000, 24020, threshold);
    expect(result.orderType).toBe('BUY_LIMIT');
    expect(result.reason).toContain('ABOVE');
  });

  // SHORT scenarios
  it('SHORT: market within threshold → MARKET', () => {
    const result = determineOrderType('SHORT', 24000, 23998, threshold);
    expect(result.orderType).toBe('MARKET');
  });

  it('SHORT: market below entry → SELL_LIMIT', () => {
    const result = determineOrderType('SHORT', 24000, 23980, threshold);
    expect(result.orderType).toBe('SELL_LIMIT');
    expect(result.reason).toContain('BELOW');
  });

  it('SHORT: market above entry → SELL_STOP', () => {
    const result = determineOrderType('SHORT', 24000, 24020, threshold);
    expect(result.orderType).toBe('SELL_STOP');
    expect(result.reason).toContain('ABOVE');
  });

  // Custom threshold
  it('uses custom threshold', () => {
    // 8 pts diff, default threshold 5 → would be BUY_STOP
    const defaultResult = determineOrderType('LONG', 24000, 23992, 5);
    expect(defaultResult.orderType).toBe('BUY_STOP');

    // 8 pts diff, threshold 10 → MARKET
    const customResult = determineOrderType('LONG', 24000, 23992, 10);
    expect(customResult.orderType).toBe('MARKET');
  });
});
