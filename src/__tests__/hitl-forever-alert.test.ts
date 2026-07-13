import { describe, it, expect } from 'vitest';
import { parseAnyAlert, parseForeverAlert } from '@/lib/hitl/alert';

// Exact texts from the operator's TradingView alert log.
const ENTRY_BULL = 'Bullish Forever Model (5m 90m Cycle) on NAS100';
const ENTRY_BEAR = 'Bearish Forever Model (5m 90m Cycle) on BTCUSD';
const OB_HIT = 'Forever Model (5m 90m Cycle): Bullish Orderblock Projection Hit on ETHUSD';
const OB_HIT_BEAR = 'Forever Model (5m 90m Cycle): Bearish Orderblock Projection Hit on BTCUSD';
const ERL_HIT = 'Forever Model (5m 90m Cycle): Bullish ERL Hit';
const ERL_HIT_SYM = 'Forever Model (5m 90m Cycle): Bullish ERL Hit on NAS100';

describe('parseForeverAlert', () => {
  it('parses a bullish entry (no price — resolved live at confirm)', () => {
    expect(parseForeverAlert(ENTRY_BULL)).toMatchObject({
      strategy: 'forever', type: 'activation', direction: 'BUY', symbol: 'NAS100', price: null,
    });
  });

  it('parses a bearish entry', () => {
    expect(parseForeverAlert(ENTRY_BEAR)).toMatchObject({
      strategy: 'forever', type: 'activation', direction: 'SELL', symbol: 'BTCUSD', price: null,
    });
  });

  it('Orderblock Projection Hit → target_reached (breakeven), with symbol', () => {
    expect(parseForeverAlert(OB_HIT)).toMatchObject({
      strategy: 'forever', type: 'target_reached', direction: 'BUY', symbol: 'ETHUSD',
    });
    expect(parseForeverAlert(OB_HIT_BEAR)).toMatchObject({
      type: 'target_reached', direction: 'SELL', symbol: 'BTCUSD',
    });
  });

  it('ERL Hit → notification only (symbol optional)', () => {
    expect(parseForeverAlert(ERL_HIT)).toMatchObject({
      strategy: 'forever', type: 'notification', direction: 'BUY', symbol: null,
    });
    expect(parseForeverAlert(ERL_HIT_SYM)).toMatchObject({ type: 'notification', symbol: 'NAS100' });
  });
});

describe('parseAnyAlert routing', () => {
  it('routes Forever syntax to the Forever parser', () => {
    expect(parseAnyAlert(ENTRY_BULL).strategy).toBe('forever');
    expect(parseAnyAlert(OB_HIT).strategy).toBe('forever');
  });

  it('routes Unicorn syntax to the Unicorn parser (regression)', () => {
    const a = parseAnyAlert('Activated 5m Bearish Unicorn [1H OHLC] on US30 @ 50788.71');
    expect(a).toMatchObject({ strategy: 'unicorn', type: 'activation', direction: 'SELL', symbol: 'US30', price: 50788.71 });
  });

  it('unknown Forever text stays unactionable', () => {
    const a = parseAnyAlert('Forever Model (5m 90m Cycle): something new');
    expect(a.type).toBe('unknown');
  });
});
