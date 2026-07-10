import { describe, it, expect } from 'vitest';
import { parseMt5Html, parseMt5Csv, cleanImportText } from '@/lib/import/mt5';
import { isManualDuplicate } from '@/lib/trades/reconcile';

// A trimmed-down MT5 "Report → HTML" statement: Positions table (the one we
// want), followed by an Orders section that must NOT be imported.
const MT5_REPORT = `
<html><body>
<table>
<tr><td colspan="13"><b>Positions</b></td></tr>
<tr align="center"><th>Time</th><th>Position</th><th>Symbol</th><th>Type</th><th>Volume</th><th>Price</th><th>S / L</th><th>T / P</th><th>Time</th><th>Price</th><th>Commission</th><th>Swap</th><th>Profit</th></tr>
<tr align="right"><td>2024.01.02 10:00:00</td><td>301</td><td><b>EURUSD</b></td><td>buy</td><td>0.10</td><td>1.10000</td><td>1.09500</td><td>1.11000</td><td>2024.01.02 12:00:00</td><td>1.10500</td><td>-0.50</td><td>0.00</td><td>50.00</td></tr>
<tr align="right"><td>2024.01.03 09:00:00</td><td>302</td><td><b>XAUUSD</b></td><td>sell</td><td>0.05</td><td>2&nbsp;000.00</td><td></td><td></td><td>2024.01.03 15:00:00</td><td>1&nbsp;990.00</td><td>0.00</td><td>-2.00</td><td>50.00</td></tr>
<tr><td colspan="13"><b>Orders</b></td></tr>
<tr align="center"><th>Open Time</th><th>Order</th><th>Symbol</th><th>Type</th><th>Volume</th><th>Price</th><th>S / L</th><th>T / P</th><th>Time</th><th>State</th><th>Comment</th></tr>
<tr align="right"><td>2024.01.04 10:00:00</td><td>401</td><td>EURUSD</td><td>buy limit</td><td>0.10</td><td>1.09000</td><td></td><td></td><td>2024.01.04 10:00:00</td><td>canceled</td><td></td></tr>
</table>
</body></html>`;

describe('parseMt5Html', () => {
  it('parses the Positions table and excludes the Orders section', () => {
    const { rows, warnings } = parseMt5Html(MT5_REPORT);
    expect(warnings).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.ticket)).toEqual(['301', '302']);
    expect(rows[0].symbol).toBe('EURUSD');
    expect(rows[0].direction).toBe('buy');
    expect(rows[0].entryPrice).toBe(1.1);
    expect(rows[0].closePrice).toBe(1.105);
    expect(rows[0].stopLoss).toBe(1.095);
    expect(rows[0].profit).toBe(50);
  });

  it('handles &nbsp; thousand separators and dotted MT5 dates', () => {
    const { rows } = parseMt5Html(MT5_REPORT);
    expect(rows[1].entryPrice).toBe(2000);
    expect(rows[1].closePrice).toBe(1990);
    expect(rows[1].openTime).toBe('2024-01-03 09:00:00');
    expect(rows[1].closeTime).toBe('2024-01-03 15:00:00');
    expect(new Date(rows[1].openTime as string).getTime()).not.toBeNaN();
  });

  it('survives UTF-16 mojibake (NUL bytes between characters)', () => {
    const mangled = MT5_REPORT.split('').join('\u0000');
    const { rows } = parseMt5Html(mangled);
    expect(rows).toHaveLength(2);
    expect(rows[0].symbol).toBe('EURUSD');
  });

  it('returns a warning (not a crash) for HTML without a trade table', () => {
    const { rows, warnings } = parseMt5Html('<html><body><p>hello</p></body></html>');
    expect(rows).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe('cleanImportText', () => {
  it('strips NULs and a leading BOM/replacement chars', () => {
    expect(cleanImportText('a\u0000b\u0000c')).toBe('abc');
    expect(cleanImportText('\uFEFF\uFFFD\uFFFD<html>')).toBe('<html>');
  });
});

describe('parseMt5Csv (broker formats)', () => {
  it('handles dotted dates and space thousand separators', () => {
    const csv = [
      'Ticket,Open Time,Close Time,Symbol,Type,Volume,Open Price,Close Price,Profit',
      '7,2024.01.05 08:00:00,2024.01.05 09:00:00,XAUUSD,buy,0.10,"2 000.00","2 010.00","1 000.00"',
    ].join('\n');
    const { rows } = parseMt5Csv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].entryPrice).toBe(2000);
    expect(rows[0].closePrice).toBe(2010);
    expect(rows[0].profit).toBe(1000);
    expect(rows[0].openTime).toBe('2024-01-05 08:00:00');
  });
});

describe('isManualDuplicate', () => {
  const base = { symbol: 'EURUSD', direction: 'BUY', lots: 0.1, openTime: new Date('2024-01-02T10:00:00Z') };

  it('matches identical trades and small open-time offsets', () => {
    expect(isManualDuplicate(base, { ...base })).toBe(true);
    expect(isManualDuplicate(base, { ...base, openTime: new Date('2024-01-02T10:01:30Z') })).toBe(true);
  });

  it('rejects mismatched symbol/direction/lots or distant open times', () => {
    expect(isManualDuplicate(base, { ...base, symbol: 'GBPUSD' })).toBe(false);
    expect(isManualDuplicate(base, { ...base, direction: 'SELL' })).toBe(false);
    expect(isManualDuplicate(base, { ...base, lots: 0.2 })).toBe(false);
    expect(isManualDuplicate(base, { ...base, openTime: new Date('2024-01-02T10:05:00Z') })).toBe(false);
  });
});
