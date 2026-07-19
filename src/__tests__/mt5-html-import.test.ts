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
<tr><td colspan="15"><b>Deals</b></td></tr>
<tr align="center"><th>Time</th><th>Deal</th><th>Symbol</th><th>Type</th><th>Direction</th><th>Volume</th><th>Price</th><th>Order</th><th>Cost</th><th>Commission</th><th>Fee</th><th>Swap</th><th>Profit</th><th>Balance</th><th>Comment</th></tr>
<tr align="right"><td>2024.01.01 12:00:00</td><td>90001</td><td></td><td>balance</td><td></td><td></td><td></td><td></td><td></td><td>0.00</td><td>0.00</td><td>0.00</td><td>15&nbsp;000.00</td><td>15&nbsp;000.00</td><td>wire #ABC123</td></tr>
<tr align="right"><td>2024.01.05 12:00:00</td><td>90002</td><td></td><td>balance</td><td></td><td></td><td></td><td></td><td></td><td>0.00</td><td>0.00</td><td>0.00</td><td>-5&nbsp;000.00</td><td>10&nbsp;000.00</td><td>withdrawal #XYZ</td></tr>
<tr align="right"><td>2024.01.02 10:00:00</td><td>90003</td><td>EURUSD</td><td>buy</td><td>in</td><td>0.10</td><td>1.10000</td><td>77</td><td>0</td><td>-0.50</td><td>0</td><td>0</td><td>0.00</td><td></td><td></td></tr>
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

  it('captures deposits/withdrawals from the Deals section (real deal ids, trade deals excluded)', () => {
    const { balanceOps } = parseMt5Html(MT5_REPORT);
    expect(balanceOps).toHaveLength(2);
    expect(balanceOps[0]).toMatchObject({ dealId: '90001', amount: 15000, comment: 'wire #ABC123' });
    expect(balanceOps[1]).toMatchObject({ dealId: '90002', amount: -5000 });
    expect(balanceOps[0].time).toBe('2024-01-01 12:00:00');
  });

  it('captures the Orders section (its header is the one with a State column)', () => {
    const { orders } = parseMt5Html(MT5_REPORT);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      ticket: '401', symbol: 'EURUSD', type: 'buy limit', state: 'canceled',
      price: 1.09, lotsFilled: 0.1, lotsRequested: 0.1,
      setupTime: '2024-01-04 10:00:00', doneTime: '2024-01-04 10:00:00',
    });
  });

  it('captures the full Deals ledger (balance and trade deals, with order linkage)', () => {
    const { deals } = parseMt5Html(MT5_REPORT);
    expect(deals).toHaveLength(3);
    expect(deals[0]).toMatchObject({ dealId: '90001', type: 'balance', symbol: null, profit: 15000, balance: 15000 });
    expect(deals[1]).toMatchObject({ dealId: '90002', type: 'balance', profit: -5000 });
    expect(deals[2]).toMatchObject({
      dealId: '90003', symbol: 'EURUSD', type: 'buy', direction: 'in',
      lots: 0.1, price: 1.1, orderTicket: '77', commission: -0.5, balance: null,
    });
    expect(deals[2].time).toBe('2024-01-02 10:00:00');
  });

  // Real reports end with a Results block ("Total Net Profit: | 692 395.85 |
  // …") whose rows have enough cells to masquerade as deal data. Numeric deal
  // ids + parseable timestamps must keep them out.
  it('rejects the summary rows that follow the Deals table', () => {
    const html = `
<table>
<tr><td colspan="15"><b>Deals</b></td></tr>
<tr><th>Time</th><th>Deal</th><th>Symbol</th><th>Type</th><th>Direction</th><th>Volume</th><th>Price</th><th>Order</th><th>Commission</th><th>Fee</th><th>Swap</th><th>Profit</th><th>Balance</th><th>Comment</th></tr>
<tr><td>2026.05.12 07:49:33</td><td>865298691</td><td>XAUUSD</td><td>sell</td><td>in</td><td>18.22</td><td>4719.88</td><td>878696523</td><td>-40.99</td><td>0.00</td><td>0.00</td><td>0.00</td><td>12&nbsp;232&nbsp;063.70</td><td></td></tr>
<tr><td>Total Net Profit:</td><td>692&nbsp;395.85</td><td>Gross Profit:</td><td>835&nbsp;420.61</td><td>Gross Loss:</td><td>-132&nbsp;033.95</td></tr>
<tr><td>Profit Factor:</td><td>6.33</td><td>Expected Payoff:</td><td>69&nbsp;239.59</td></tr>
</table>`;
    const { deals } = parseMt5Html(html);
    expect(deals).toHaveLength(1);
    expect(deals[0].dealId).toBe('865298691');
  });

  // Real MT5 ReportHistory exports (e.g. FusionMarkets): the header row has 13
  // cells (last one colspan=2) while data rows have 14 — an empty spacer cell
  // after Type — shifting every column from Volume onward. Regression for the
  // realignment that drops excess empty cells.
  it('realigns data rows that have an extra empty spacer cell (real broker report)', () => {
    const html = `
<table>
<tr><td colspan="13"><b>Positions</b></td></tr>
<tr><td>Time</td><td>Position</td><td>Symbol</td><td>Type</td><td>Volume</td><td>Price</td><td>S / L</td><td>T / P</td><td>Time</td><td>Price</td><td>Commission</td><td>Swap</td><td colspan="2">Profit</td></tr>
<tr><td>2026.06.14 23:26:00</td><td>175373857</td><td>BTCUSD</td><td>buy</td><td></td><td>100</td><td>63891.00</td><td>63631.39</td><td>64710.05</td><td>2026.06.15 00:18:58</td><td>64710.05</td><td>-450.00</td><td>0.00</td><td>81&nbsp;905.00</td></tr>
</table>`;
    const { rows } = parseMt5Html(html);
    expect(rows).toHaveLength(1);
    const t = rows[0];
    expect(t.ticket).toBe('175373857');
    expect(t.lots).toBe(100);
    expect(t.entryPrice).toBe(63891);
    expect(t.stopLoss).toBe(63631.39);
    expect(t.takeProfit).toBe(64710.05);
    expect(t.closePrice).toBe(64710.05);
    expect(t.closeTime).toBe('2026-06-15 00:18:58');
    expect(t.profit).toBe(81905);
    expect(t.commission).toBe(-450);
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
