import { describe, it, expect } from 'vitest';
import { riskForAccount, type RiskSettings } from '@/lib/hitl/risk';

const percent: RiskSettings = { mode: 'percent', riskPct: 1, fixedAmount: 0, maxRiskPct: 5 };
const fixed: RiskSettings = { mode: 'fixed', riskPct: 1, fixedAmount: 50, maxRiskPct: 5 };

describe('riskForAccount', () => {
  it('returns the global settings unchanged when there is no override', () => {
    expect(riskForAccount(percent, null)).toEqual(percent);
    expect(riskForAccount(percent, undefined)).toEqual(percent);
  });

  it('overrides the percent in percent mode', () => {
    expect(riskForAccount(percent, 2.5)).toEqual({ ...percent, riskPct: 2.5 });
  });

  it('overrides the dollar amount in fixed mode', () => {
    expect(riskForAccount(fixed, 100)).toEqual({ ...fixed, fixedAmount: 100 });
  });

  it('never changes the max-risk cap', () => {
    expect(riskForAccount(percent, 999).maxRiskPct).toBe(5);
  });
});
