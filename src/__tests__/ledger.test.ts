import { describe, it, expect } from 'vitest';
import { mapLiveDeal, mapLiveOrder } from '@/lib/accounts/ledger';

describe('mapLiveDeal', () => {
  it('maps a MetaApi trade deal to statement vocabulary', () => {
    const m = mapLiveDeal({
      id: '865298691', type: 'DEAL_TYPE_SELL', entryType: 'DEAL_ENTRY_IN',
      symbol: 'XAUUSD', volume: 18.22, price: 4719.88, orderId: '878696523',
      commission: -40.99, swap: 0, profit: 0, time: '2026-05-12T07:49:33.000Z',
    });
    expect(m).not.toBeNull();
    expect(m!.dealId).toBe('865298691');
    expect(m!.values).toMatchObject({
      type: 'sell', direction: 'in', symbol: 'XAUUSD',
      orderTicket: '878696523', lots: 18.22, price: 4719.88, commission: -40.99,
    });
  });

  it('maps balance deals and the in/out entry type', () => {
    const bal = mapLiveDeal({ id: '1', type: 'DEAL_TYPE_BALANCE', profit: 15000, time: '2026-05-01T00:00:00Z' });
    expect(bal!.values).toMatchObject({ type: 'balance', symbol: null, direction: null, profit: 15000 });

    const inout = mapLiveDeal({ id: '2', type: 'DEAL_TYPE_BUY', entryType: 'DEAL_ENTRY_INOUT', symbol: 'EURUSD', time: '2026-05-01T00:00:00Z' });
    expect(inout!.values.direction).toBe('in/out');
  });

  it('rejects objects without a real id/type/time', () => {
    expect(mapLiveDeal({ type: 'DEAL_TYPE_BUY', time: '2026-05-01T00:00:00Z' })).toBeNull();
    expect(mapLiveDeal({ id: '3', time: '2026-05-01T00:00:00Z' })).toBeNull();
    expect(mapLiveDeal({ id: '3', type: 'DEAL_TYPE_BUY', time: 'not a date' })).toBeNull();
  });
});

describe('mapLiveOrder', () => {
  it('maps a pending-order type and computes filled volume from the remainder', () => {
    const m = mapLiveOrder({
      id: '880127642', symbol: 'BTCUSD', type: 'ORDER_TYPE_BUY_LIMIT', state: 'ORDER_STATE_FILLED',
      volume: 17.94, currentVolume: 0, openPrice: 73299.2,
      time: '2026-05-28T18:37:22.000Z', doneTime: '2026-05-28T18:38:00.000Z',
    });
    expect(m!.ticket).toBe('880127642');
    expect(m!.values).toMatchObject({
      type: 'buy limit', state: 'filled',
      lotsRequested: 17.94, lotsFilled: 17.94, price: 73299.2,
    });
    expect(m!.values.doneTime).toEqual(new Date('2026-05-28T18:38:00.000Z'));
  });

  it('reports zero filled for a fully-canceled order', () => {
    const m = mapLiveOrder({
      id: '9', symbol: 'EURUSD', type: 'ORDER_TYPE_SELL_STOP', state: 'ORDER_STATE_CANCELED',
      volume: 2, currentVolume: 2, time: '2026-05-01T00:00:00Z',
    });
    expect(m!.values).toMatchObject({ state: 'canceled', lotsFilled: 0, lotsRequested: 2 });
  });

  it('trusts a filled state when the remainder is absent', () => {
    const m = mapLiveOrder({
      id: '10', symbol: 'EURUSD', type: 'ORDER_TYPE_BUY', state: 'ORDER_STATE_FILLED',
      volume: 1, time: '2026-05-01T00:00:00Z',
    });
    expect(m!.values.lotsFilled).toBe(1);
  });
});
