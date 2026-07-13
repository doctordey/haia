import { describe, it, expect } from 'vitest';
import { riskForAccount, type RiskSettings } from '@/lib/hitl/risk';

const percent: RiskSettings = { mode: 'percent', riskPct: 1, fixedAmount: 0, maxRiskPct: 5 };
const fixed: RiskSettings = { mode: 'fixed', riskPct: 1, fixedAmount: 50, maxRiskPct: 5 };

describe('riskForAccount', () => {
  it('returns the strategy settings unchanged when there is no override', () => {
    expect(riskForAccount(percent, null)).toEqual(percent);
    expect(riskForAccount(percent, undefined)).toEqual(percent);
  });

  it('overrides the percent in percent mode', () => {
    expect(riskForAccount(percent, { value: 2.5, mode: 'percent' })).toEqual({ ...percent, riskPct: 2.5 });
  });

  it('overrides the dollar amount in fixed mode', () => {
    expect(riskForAccount(fixed, { value: 100, mode: 'fixed' })).toEqual({ ...fixed, fixedAmount: 100 });
  });

  it('ignores an override recorded under a different mode (no silent reinterpretation)', () => {
    // "2" entered as 2% must not become $2 for a fixed-mode strategy.
    expect(riskForAccount(fixed, { value: 2, mode: 'percent' })).toEqual(fixed);
    expect(riskForAccount(percent, { value: 100, mode: 'fixed' })).toEqual(percent);
  });

  it('legacy overrides (no recorded mode) apply in any mode', () => {
    expect(riskForAccount(percent, { value: 2.5 })).toEqual({ ...percent, riskPct: 2.5 });
    expect(riskForAccount(fixed, { value: 100 })).toEqual({ ...fixed, fixedAmount: 100 });
  });

  it('never changes the max-risk cap', () => {
    expect(riskForAccount(percent, { value: 999, mode: 'percent' }).maxRiskPct).toBe(5);
  });
});
