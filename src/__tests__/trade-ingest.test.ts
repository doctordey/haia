import { describe, it, expect } from 'vitest';
import { normalizeTrade } from '@/lib/trades/ingest';
import { parseMt5Csv, parseTradesJson } from '@/lib/import/mt5';
import { generateApiKey, hashApiKey, normalizeScopes } from '@/lib/api/keys';

describe('normalizeTrade', () => {
  const base = {
    symbol: 'eurusd', direction: 'buy', lots: 0.5, entryPrice: 1.1,
    openTime: '2024-01-01T10:00:00Z',
  };

  it('normalizes a closed trade and derives pips', () => {
    const t = normalizeTrade('acc1', { ...base, closePrice: 1.105, closeTime: '2024-01-01T12:00:00Z', profit: 25 }, 'manual');
    expect(t.symbol).toBe('EURUSD');
    expect(t.direction).toBe('BUY');
    expect(t.isOpen).toBe(false);
    expect(t.profit).toBe(25);
    expect(t.pips).toBeCloseTo(50, 1); // 0.005 * 10000
    expect(t.source).toBe('manual');
    // Auto-generated tickets must look like broker tickets — purely numeric,
    // no marker that would let an API consumer spot a manual entry.
    expect(t.ticket).toMatch(/^\d{13,}$/);
  });

  it('treats a trade without close time as open', () => {
    const t = normalizeTrade('acc1', base, 'manual');
    expect(t.isOpen).toBe(true);
    expect(t.closePrice).toBeNull();
    expect(t.closeTime).toBeNull();
  });

  it('accepts long/short aliases and preserves explicit ticket', () => {
    expect(normalizeTrade('a', { ...base, direction: 'short', ticket: 'T1' }, 'manual').direction).toBe('SELL');
    expect(normalizeTrade('a', { ...base, ticket: 'T1' }, 'manual').ticket).toBe('T1');
  });

  it('rejects bad input', () => {
    expect(() => normalizeTrade('a', { ...base, direction: 'x' }, 'manual')).toThrow(/direction/);
    expect(() => normalizeTrade('a', { ...base, lots: 0 }, 'manual')).toThrow(/lots/);
    expect(() => normalizeTrade('a', { ...base, symbol: '' }, 'manual')).toThrow(/symbol/);
    expect(() => normalizeTrade('a', { ...base, openTime: 'nope' }, 'manual')).toThrow(/openTime/);
  });
});

describe('parseMt5Csv', () => {
  it('parses a comma CSV with explicit headers', () => {
    const csv = [
      'Ticket,Open Time,Close Time,Symbol,Type,Volume,Open Price,Close Price,Commission,Swap,Profit',
      '101,2024-01-01 10:00:00,2024-01-01 11:00:00,EURUSD,buy,0.10,1.1000,1.1050,-0.5,0.2,50',
      '102,2024-01-02 10:00:00,2024-01-02 11:00:00,GBPUSD,sell,0.20,1.3000,1.2950,-1,0,100',
    ].join('\n');
    const { rows, skipped } = parseMt5Csv(csv);
    expect(rows).toHaveLength(2);
    expect(skipped).toBe(0);
    expect(rows[0].symbol).toBe('EURUSD');
    expect(rows[0].direction).toBe('buy');
    expect(Number(rows[1].profit)).toBe(100);
  });

  it('disambiguates repeated Time/Price columns (open then close)', () => {
    const csv = [
      'Time\tPosition\tSymbol\tType\tVolume\tPrice\tS / L\tT / P\tTime\tPrice\tCommission\tSwap\tProfit',
      '2024-01-01 10:00:00\t555\tXAUUSD\tbuy\t0.10\t2000.0\t1990\t2020\t2024-01-01 12:00:00\t2010.0\t0\t0\t100',
    ].join('\n');
    const { rows } = parseMt5Csv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].entryPrice).toBe(2000);
    expect(rows[0].closePrice).toBe(2010);
    expect(rows[0].openTime).toBe('2024-01-01 10:00:00');
    expect(rows[0].closeTime).toBe('2024-01-01 12:00:00');
  });

  it('skips non-trade (balance) rows', () => {
    const csv = [
      'Ticket,Time,Symbol,Type,Volume,Price,Profit',
      '1,2024-01-01,,balance,,,1000',
      '2,2024-01-02,EURUSD,buy,0.1,1.1,5',
    ].join('\n');
    const { rows, skipped } = parseMt5Csv(csv);
    expect(rows).toHaveLength(1);
    expect(skipped).toBe(1);
  });
});

describe('parseTradesJson', () => {
  it('accepts an array or a { trades } wrapper', () => {
    expect(parseTradesJson([{ symbol: 'X' }])).toHaveLength(1);
    expect(parseTradesJson({ trades: [{ symbol: 'X' }, { symbol: 'Y' }] })).toHaveLength(2);
  });
  it('throws on non-array', () => {
    expect(() => parseTradesJson({ foo: 'bar' })).toThrow();
  });
});

describe('api keys', () => {
  it('generates a prefixed key whose hash is stable', () => {
    const k = generateApiKey();
    expect(k.plaintext.startsWith('hk_')).toBe(true);
    expect(k.prefix.length).toBe('hk_'.length + 6);
    expect(k.keyHash).toBe(hashApiKey(k.plaintext));
    expect(k.keyHash).toHaveLength(64); // sha256 hex
  });

  it('normalizes scopes and always includes read', () => {
    expect(normalizeScopes('write')).toEqual(['read', 'write']);
    expect(normalizeScopes(['read'])).toEqual(['read']);
    expect(normalizeScopes('bogus')).toEqual(['read']);
    expect(normalizeScopes(undefined)).toEqual(['read']);
  });
});
