import { describe, it, expect } from 'vitest';
import { suggestSymbolMatches } from '@/lib/hitl/symbol-suggest';

describe('suggestSymbolMatches', () => {
  const symbols = ['US30.cash', 'US30m', 'USDJPY', 'US500.cash', 'DJ30', 'EURUSD', 'XAUUSD'];

  it('suggests suffixed variants of the requested symbol', () => {
    const out = suggestSymbolMatches('US30', symbols);
    expect(out).toContain('US30.cash');
    expect(out).toContain('US30m');
    // prefix matches rank above unrelated symbols
    expect(out[0]).toMatch(/^US30/);
    expect(out).not.toContain('EURUSD');
  });

  it('does not suggest the exact symbol that failed', () => {
    expect(suggestSymbolMatches('US30.cash', symbols)).not.toContain('US30.cash');
  });

  it('respects the limit', () => {
    expect(suggestSymbolMatches('US30', symbols, 1)).toHaveLength(1);
  });

  it('returns nothing for an empty query', () => {
    expect(suggestSymbolMatches('', symbols)).toEqual([]);
  });

  it('returns nothing when no symbol is similar', () => {
    expect(suggestSymbolMatches('BTCUSD', ['EURUSD', 'GBPUSD'])).toEqual([]);
  });
});
