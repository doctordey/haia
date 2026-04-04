'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { useAccounts } from '@/hooks/useAccounts';
import { formatCurrency, formatNumber, formatDuration, pnlColor } from '@/lib/utils';
import type { Trade } from '@/types';

type SortField = 'closeTime' | 'openTime' | 'symbol' | 'profit' | 'lots' | 'pips';
type SortDir = 'asc' | 'desc';

export default function HistoryPage() {
  const { selectedAccountId } = useAccounts();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState<SortField>('closeTime');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);

  // Filters
  const [symbol, setSymbol] = useState('');
  const [direction, setDirection] = useState('all');
  const [result, setResult] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [minPnl, setMinPnl] = useState('');
  const [maxPnl, setMaxPnl] = useState('');

  const fetchTrades = useCallback(async () => {
    if (!selectedAccountId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '50',
        type: 'closed',
        sortBy,
        sortDir,
      });
      if (symbol) params.set('symbol', symbol);
      if (direction !== 'all') params.set('direction', direction);
      if (result !== 'all') params.set('result', result);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      if (minPnl) params.set('minPnl', minPnl);
      if (maxPnl) params.set('maxPnl', maxPnl);

      const res = await fetch(`/api/trades/${selectedAccountId}?${params}`);
      if (res.ok) {
        const data = await res.json();
        setTrades(data.trades || []);
        setTotalPages(data.pagination?.totalPages || 1);
        setTotal(data.pagination?.total || 0);
      }
    } catch (error) {
      console.error('Failed to fetch trades:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedAccountId, page, sortBy, sortDir, symbol, direction, result, dateFrom, dateTo, minPnl, maxPnl]);

  useEffect(() => {
    fetchTrades();
  }, [fetchTrades]);

  function handleSort(field: SortField) {
    if (sortBy === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDir('desc');
    }
    setPage(1);
  }

  function handleFilter() {
    setPage(1);
    fetchTrades();
  }

  function handleCsvExport() {
    if (!selectedAccountId) return;
    const params = new URLSearchParams({ type: 'closed', export: 'csv', sortBy, sortDir });
    if (symbol) params.set('symbol', symbol);
    if (direction !== 'all') params.set('direction', direction);
    if (result !== 'all') params.set('result', result);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (minPnl) params.set('minPnl', minPnl);
    if (maxPnl) params.set('maxPnl', maxPnl);
    window.open(`/api/trades/${selectedAccountId}?${params}`, '_blank');
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortBy !== field) return <span className="text-text-tertiary ml-1">↕</span>;
    return <span className="text-accent-primary ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Trade History</h1>
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-secondary">{total} trades</span>
          <Button variant="secondary" size="sm" onClick={handleCsvExport}>
            Export CSV
          </Button>
        </div>
      </div>

      {/* Filter Bar */}
      <Card>
        <CardContent className="py-3">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <Input
              placeholder="Symbol (e.g. EURUSD)"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="h-8 text-xs"
            />
            <select
              value={direction}
              onChange={(e) => { setDirection(e.target.value); setPage(1); }}
              className="h-8 px-2 text-xs bg-bg-tertiary border border-border-primary rounded-[var(--radius-md)] text-text-primary"
            >
              <option value="all">All Directions</option>
              <option value="BUY">Buy</option>
              <option value="SELL">Sell</option>
            </select>
            <select
              value={result}
              onChange={(e) => { setResult(e.target.value); setPage(1); }}
              className="h-8 px-2 text-xs bg-bg-tertiary border border-border-primary rounded-[var(--radius-md)] text-text-primary"
            >
              <option value="all">All Results</option>
              <option value="win">Win</option>
              <option value="loss">Loss</option>
            </select>
            <Input
              type="date"
              placeholder="From"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-8 text-xs"
            />
            <Input
              type="date"
              placeholder="To"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-8 text-xs"
            />
            <Input
              type="number"
              placeholder="Min PNL"
              value={minPnl}
              onChange={(e) => setMinPnl(e.target.value)}
              className="h-8 text-xs"
            />
            <Input
              type="number"
              placeholder="Max PNL"
              value={maxPnl}
              onChange={(e) => setMaxPnl(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="mt-2 flex justify-end">
            <Button size="sm" onClick={handleFilter}>Apply Filters</Button>
          </div>
        </CardContent>
      </Card>

      {/* Trade Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-xs text-text-secondary uppercase tracking-wider">
                <th className="text-left py-3 px-3 font-medium">Ticket</th>
                <th className="text-left py-3 px-3 font-medium cursor-pointer" onClick={() => handleSort('openTime')}>
                  Open Time<SortIcon field="openTime" />
                </th>
                <th className="text-left py-3 px-3 font-medium cursor-pointer" onClick={() => handleSort('closeTime')}>
                  Close Time<SortIcon field="closeTime" />
                </th>
                <th className="text-left py-3 px-3 font-medium cursor-pointer" onClick={() => handleSort('symbol')}>
                  Symbol<SortIcon field="symbol" />
                </th>
                <th className="text-left py-3 px-3 font-medium">Dir</th>
                <th className="text-right py-3 px-3 font-medium cursor-pointer" onClick={() => handleSort('lots')}>
                  Lots<SortIcon field="lots" />
                </th>
                <th className="text-right py-3 px-3 font-medium">Entry</th>
                <th className="text-right py-3 px-3 font-medium">Close</th>
                <th className="text-right py-3 px-3 font-medium">SL</th>
                <th className="text-right py-3 px-3 font-medium">TP</th>
                <th className="text-right py-3 px-3 font-medium">Comm</th>
                <th className="text-right py-3 px-3 font-medium">Swap</th>
                <th className="text-right py-3 px-3 font-medium cursor-pointer" onClick={() => handleSort('profit')}>
                  PNL ($)<SortIcon field="profit" />
                </th>
                <th className="text-right py-3 px-3 font-medium cursor-pointer" onClick={() => handleSort('pips')}>
                  Pips<SortIcon field="pips" />
                </th>
                <th className="text-right py-3 px-3 font-medium">Duration</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={15} className="py-12 text-center text-sm text-text-tertiary">Loading...</td></tr>
              ) : trades.length === 0 ? (
                <tr><td colSpan={15} className="py-12 text-center text-sm text-text-tertiary">No trades found</td></tr>
              ) : (
                trades.map((trade) => {
                  const duration = trade.closeTime && trade.openTime
                    ? Math.round((new Date(trade.closeTime).getTime() - new Date(trade.openTime).getTime()) / 60000)
                    : 0;
                  return (
                    <tr
                      key={trade.id}
                      className="border-t border-border-primary hover:bg-bg-hover transition-colors cursor-pointer"
                      onClick={() => setSelectedTrade(trade)}
                    >
                      <td className="py-2 px-3 text-xs font-mono text-text-secondary">{trade.ticket}</td>
                      <td className="py-2 px-3 text-xs text-text-secondary">
                        {new Date(trade.openTime).toLocaleString()}
                      </td>
                      <td className="py-2 px-3 text-xs text-text-secondary">
                        {trade.closeTime ? new Date(trade.closeTime).toLocaleString() : '—'}
                      </td>
                      <td className="py-2 px-3 text-sm font-medium">{trade.symbol}</td>
                      <td className="py-2 px-3">
                        <Badge variant={trade.direction === 'BUY' ? 'profit' : 'loss'}>{trade.direction}</Badge>
                      </td>
                      <td className="py-2 px-3 text-sm font-mono text-right">{formatNumber(trade.lots)}</td>
                      <td className="py-2 px-3 text-sm font-mono text-right">{formatNumber(trade.entryPrice, 5)}</td>
                      <td className="py-2 px-3 text-sm font-mono text-right">
                        {trade.closePrice ? formatNumber(trade.closePrice, 5) : '—'}
                      </td>
                      <td className="py-2 px-3 text-xs font-mono text-right text-text-tertiary">
                        {trade.stopLoss ? formatNumber(trade.stopLoss, 5) : '—'}
                      </td>
                      <td className="py-2 px-3 text-xs font-mono text-right text-text-tertiary">
                        {trade.takeProfit ? formatNumber(trade.takeProfit, 5) : '—'}
                      </td>
                      <td className="py-2 px-3 text-xs font-mono text-right text-text-secondary">
                        {formatCurrency(trade.commission)}
                      </td>
                      <td className="py-2 px-3 text-xs font-mono text-right text-text-secondary">
                        {formatCurrency(trade.swap)}
                      </td>
                      <td className={`py-2 px-3 text-sm font-mono text-right font-medium ${pnlColor(trade.profit)}`}>
                        {trade.profit >= 0 ? '+' : ''}{formatCurrency(trade.profit)}
                      </td>
                      <td className={`py-2 px-3 text-xs font-mono text-right ${pnlColor(trade.pips || 0)}`}>
                        {trade.pips != null ? formatNumber(trade.pips, 1) : '—'}
                      </td>
                      <td className="py-2 px-3 text-xs font-mono text-right text-text-secondary">
                        {formatDuration(duration)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 py-3 border-t border-border-primary">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              Previous
            </Button>
            <span className="text-xs text-text-tertiary">Page {page} of {totalPages}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              Next
            </Button>
          </div>
        )}
      </Card>

      {/* Trade Detail Modal */}
      <Modal
        open={!!selectedTrade}
        onClose={() => setSelectedTrade(null)}
        title={selectedTrade ? `Trade #${selectedTrade.ticket}` : ''}
        className="max-w-lg"
      >
        {selectedTrade && <TradeDetail trade={selectedTrade} />}
      </Modal>
    </div>
  );
}

function TradeDetail({ trade }: { trade: Trade }) {
  const duration = trade.closeTime && trade.openTime
    ? Math.round((new Date(trade.closeTime).getTime() - new Date(trade.openTime).getTime()) / 60000)
    : 0;

  const rows = [
    ['Symbol', trade.symbol],
    ['Direction', trade.direction],
    ['Lots', formatNumber(trade.lots)],
    ['Entry Price', formatNumber(trade.entryPrice, 5)],
    ['Close Price', trade.closePrice ? formatNumber(trade.closePrice, 5) : '—'],
    ['Stop Loss', trade.stopLoss ? formatNumber(trade.stopLoss, 5) : '—'],
    ['Take Profit', trade.takeProfit ? formatNumber(trade.takeProfit, 5) : '—'],
    ['Open Time', new Date(trade.openTime).toLocaleString()],
    ['Close Time', trade.closeTime ? new Date(trade.closeTime).toLocaleString() : '—'],
    ['Duration', formatDuration(duration)],
    ['Commission', formatCurrency(trade.commission)],
    ['Swap', formatCurrency(trade.swap)],
    ['Pips', trade.pips != null ? formatNumber(trade.pips, 1) : '—'],
    ['PNL', `${trade.profit >= 0 ? '+' : ''}${formatCurrency(trade.profit)}`],
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg font-semibold">{trade.symbol}</span>
        <Badge variant={trade.direction === 'BUY' ? 'profit' : 'loss'}>{trade.direction}</Badge>
        <span className={`text-lg font-bold font-mono ml-auto ${pnlColor(trade.profit)}`}>
          {trade.profit >= 0 ? '+' : ''}{formatCurrency(trade.profit)}
        </span>
      </div>
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between py-1.5 border-b border-border-primary last:border-0">
          <span className="text-xs text-text-secondary">{label}</span>
          <span className="text-sm font-mono text-text-primary">{value}</span>
        </div>
      ))}
      {trade.comment && (
        <div className="pt-2">
          <span className="text-xs text-text-secondary">Comment: </span>
          <span className="text-xs text-text-primary">{trade.comment}</span>
        </div>
      )}
    </div>
  );
}
