import { describe, it, expect } from 'vitest';
import { exposeAccount, exposeTrade } from '@/lib/api/serialize';
import { normalizeTrade } from '@/lib/trades/ingest';

// Label overrides and manual entries must be undetectable to API consumers:
// no flags revealing that a value is overridden, no config metadata hinting
// that manual entries exist, and no ticket markers on hand-entered trades.

type AccountRow = Parameters<typeof exposeAccount>[0];
type TradeRow = Parameters<typeof exposeTrade>[0];

const account = {
  id: 'acc1', userId: 'u1', name: 'Real Name', platform: 'MT5',
  metaApiId: 'meta-1', server: 'Broker-Live', login: '12345', broker: null,
  leverage: null, currency: 'USD', accountType: 'demo',
  accessMode: 'investor', hitlEnabled: false,
  labelName: 'Alpha Fund', labelLogin: 'FUND-001', labelType: 'live',
  labelServer: null, labelBroker: null, labelLeverage: null, beginningDate: null,
  distinguishManual: false, isActive: true, lastSyncAt: null,
  syncStatus: 'synced', syncError: null,
  createdAt: new Date(), updatedAt: new Date(),
} as AccountRow;

describe('exposeAccount indistinguishability', () => {
  it('applies overrides with no flag revealing them', () => {
    const out = exposeAccount(account);
    expect(out.name).toBe('Alpha Fund');
    expect(out.accountNumber).toBe('FUND-001');
    expect(out.accountType).toBe('live');
    expect(out.isDemo).toBe(false);
    expect(out).not.toHaveProperty('labeled');
    expect(out).not.toHaveProperty('distinguishManual');
    // Nothing else leaks the real values or the broker linkage.
    const json = JSON.stringify(out);
    expect(json).not.toContain('Real Name');
    expect(json).not.toContain('12345');
    expect(json).not.toContain('meta-1');
    expect(json).not.toContain('label');
  });

  it('produces the identical shape whether or not overrides are set', () => {
    const plain = exposeAccount({ ...account, labelName: null, labelLogin: null, labelType: null } as AccountRow);
    expect(Object.keys(plain).sort()).toEqual(Object.keys(exposeAccount(account)).sort());
  });

  it('applies server/broker/leverage overrides and exposes beginningDate', () => {
    const out = exposeAccount({
      ...account,
      labelServer: 'Prime-Live', labelBroker: 'Prime Brokerage', labelLeverage: 500,
      beginningDate: '2026-01-01',
    } as AccountRow);
    expect(out.server).toBe('Prime-Live');
    expect(out.broker).toBe('Prime Brokerage');
    expect(out.leverage).toBe(500);
    expect(out.beginningDate).toBe('2026-01-01');
    // real server value not leaked
    expect(JSON.stringify(out)).not.toContain('Broker-Live');
  });

  it('omits winRate/profitFactor/maxDrawdownPct/createdAt from the payload', () => {
    const out = exposeAccount(account, {
      balance: 100, equity: 100, totalPnl: 10, realizedPnl: 10, unrealizedPnl: 0,
      totalTrades: 3, winRate: 66, profitFactor: 2, maxDrawdownPct: 5, lastCalculatedAt: new Date(),
    } as Parameters<typeof exposeAccount>[1]);
    expect(out).not.toHaveProperty('createdAt');
    expect(out.stats).not.toHaveProperty('winRate');
    expect(out.stats).not.toHaveProperty('profitFactor');
    expect(out.stats).not.toHaveProperty('maxDrawdownPct');
    expect(out.stats?.balance).toBe(100);
    expect(out.stats?.totalTrades).toBe(3);
  });
});

describe('exposeTrade indistinguishability', () => {
  const manual = {
    ...normalizeTrade('acc1', {
      symbol: 'EURUSD', direction: 'buy', lots: 0.1, entryPrice: 1.1,
      openTime: '2024-01-01T10:00:00Z', closeTime: '2024-01-01T12:00:00Z',
      closePrice: 1.105, profit: 50,
    }, 'manual'),
    id: 't1',
  } as TradeRow;

  it('drops the source field when distinction is off', () => {
    const out = exposeTrade(manual, false);
    expect(out).not.toHaveProperty('source');
    expect(JSON.stringify(out)).not.toContain('manual');
  });

  it('keeps the source field when distinction is on (deliberate)', () => {
    expect(exposeTrade(manual, true).source).toBe('manual');
  });
});
