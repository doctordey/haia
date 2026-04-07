import { describe, it, expect } from 'vitest';
import { evaluateMargin } from '@/lib/signals/margin';
import type { MarginCheck } from '@/types/signals';

describe('evaluateMargin', () => {
  it('proceeds when utilization is low', () => {
    const check: MarginCheck = {
      requiredMargin: 500,
      freeMargin: 10000,
      sufficient: true,
      marginUtilization: 5,
    };
    const result = evaluateMargin(check, 80, 95);
    expect(result.action).toBe('proceed');
  });

  it('warns when utilization exceeds warning threshold', () => {
    const check: MarginCheck = {
      requiredMargin: 8500,
      freeMargin: 10000,
      sufficient: true,
      marginUtilization: 85,
    };
    const result = evaluateMargin(check, 80, 95);
    expect(result.action).toBe('warn');
    expect(result.message).toContain('warning');
  });

  it('rejects when utilization exceeds reject threshold', () => {
    const check: MarginCheck = {
      requiredMargin: 9600,
      freeMargin: 10000,
      sufficient: true,
      marginUtilization: 96,
    };
    const result = evaluateMargin(check, 80, 95);
    expect(result.action).toBe('reject');
  });

  it('rejects when insufficient margin', () => {
    const check: MarginCheck = {
      requiredMargin: 15000,
      freeMargin: 10000,
      sufficient: false,
      marginUtilization: 150,
    };
    const result = evaluateMargin(check, 80, 95);
    expect(result.action).toBe('reject');
  });

  it('respects custom thresholds', () => {
    const check: MarginCheck = {
      requiredMargin: 6000,
      freeMargin: 10000,
      sufficient: true,
      marginUtilization: 60,
    };
    // With 50% warning threshold, 60% should warn
    const result = evaluateMargin(check, 50, 70);
    expect(result.action).toBe('warn');
  });
});
