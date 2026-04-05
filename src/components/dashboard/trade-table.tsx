'use client';

import { useState, useEffect } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, formatNumber, formatDuration, pnlColor } from '@/lib/utils';
import type { Trade } from '@/types';

interface TradeTableProps {
  accountId: string | null;
  stats?: Record<string, number | string>;
}

export function TradeTable({ accountId, stats }: TradeTableProps) {
  const [openTrades, setOpenTrades] = useState<Trade[]>([]);
  const [closedTrades, setClosedTrades] = useState<Trade[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!accountId) return;

    async function fetchTrades() {
      setLoading(true);
      try {
        const [openRes, closedRes] = await Promise.all([
          fetch(`/api/trades/${accountId}?type=open&limit=50`),
          fetch(`/api/trades/${accountId}?type=closed&page=${page}&limit=50`),
        ]);

        if (openRes.ok) {
          const openData = await openRes.json();
          setOpenTrades(openData.trades || []);
        }

        if (closedRes.ok) {
          const closedData = await closedRes.json();
          setClosedTrades(closedData.trades || []);
          setTotalPages(closedData.pagination?.totalPages || 1);
        }
      } catch (error) {
        console.error('Failed to fetch trades:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchTrades();
  }, [accountId, page]);

  return (
    <Tabs defaultValue="history">
      <TabsList>
        <TabsTrigger value="open">Open Positions{openTrades.length > 0 ? ` (${openTrades.length})` : ''}</TabsTrigger>
        <TabsTrigger value="history">Trade History</TabsTrigger>
        <TabsTrigger value="stats">Statistics</TabsTrigger>
      </TabsList>

      <TabsContent value="open" className="mt-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-xs text-text-secondary uppercase tracking-wider">
                <th className="text-left py-3 px-3 font-medium">Symbol</th>
                <th className="text-left py-3 px-3 font-medium">Direction</th>
                <th className="text-right py-3 px-3 font-medium">Lots</th>
                <th className="text-right py-3 px-3 font-medium">Entry</th>
                <th className="text-right py-3 px-3 font-medium">SL</th>
                <th className="text-right py-3 px-3 font-medium">TP</th>
                <th className="text-right py-3 px-3 font-medium">PNL</th>
              </tr>
            </thead>
            <tbody>
              {openTrades.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-sm text-text-tertiary">
                    No open positions
                  </td>
                </tr>
              ) : (
                openTrades.map((trade) => (
                  <tr key={trade.id} className="border-t border-border-primary hover:bg-bg-hover transition-colors">
                    <td className="py-2.5 px-3 text-sm font-medium">{trade.symbol}</td>
                    <td className="py-2.5 px-3">
                      <Badge variant={trade.direction === 'BUY' ? 'profit' : 'loss'}>
                        {trade.direction}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3 text-sm font-mono text-right">{formatNumber(trade.lots)}</td>
                    <td className="py-2.5 px-3 text-sm font-mono text-right">{formatNumber(trade.entryPrice, 5)}</td>
                    <td className="py-2.5 px-3 text-sm font-mono text-right text-text-secondary">
                      {trade.stopLoss ? formatNumber(trade.stopLoss, 5) : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-sm font-mono text-right text-text-secondary">
                      {trade.takeProfit ? formatNumber(trade.takeProfit, 5) : '—'}
                    </td>
                    <td className={`py-2.5 px-3 text-sm font-mono text-right font-medium ${pnlColor(trade.profit)}`}>
                      {trade.profit >= 0 ? '+' : ''}{formatCurrency(trade.profit)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </TabsContent>

      <TabsContent value="history" className="mt-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-xs text-text-secondary uppercase tracking-wider">
                <th className="text-left py-3 px-3 font-medium">Date</th>
                <th className="text-left py-3 px-3 font-medium">Symbol</th>
                <th className="text-left py-3 px-3 font-medium">Dir</th>
                <th className="text-right py-3 px-3 font-medium">Lots</th>
                <th className="text-right py-3 px-3 font-medium">Entry</th>
                <th className="text-right py-3 px-3 font-medium">Close</th>
                <th className="text-right py-3 px-3 font-medium">PNL</th>
                <th className="text-right py-3 px-3 font-medium">Duration</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-sm text-text-tertiary">Loading...</td>
                </tr>
              ) : closedTrades.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-sm text-text-tertiary">No trades yet</td>
                </tr>
              ) : (
                closedTrades.map((trade) => {
                  const duration = trade.closeTime && trade.openTime
                    ? Math.round((new Date(trade.closeTime).getTime() - new Date(trade.openTime).getTime()) / 60000)
                    : 0;
                  return (
                    <tr key={trade.id} className="border-t border-border-primary hover:bg-bg-hover transition-colors">
                      <td className="py-2.5 px-3 text-sm text-text-secondary">
                        {trade.closeTime ? new Date(trade.closeTime).toLocaleDateString() : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-sm font-medium">{trade.symbol}</td>
                      <td className="py-2.5 px-3">
                        <Badge variant={trade.direction === 'BUY' ? 'profit' : 'loss'}>
                          {trade.direction}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3 text-sm font-mono text-right">{formatNumber(trade.lots)}</td>
                      <td className="py-2.5 px-3 text-sm font-mono text-right">{formatNumber(trade.entryPrice, 5)}</td>
                      <td className="py-2.5 px-3 text-sm font-mono text-right">
                        {trade.closePrice ? formatNumber(trade.closePrice, 5) : '—'}
                      </td>
                      <td className={`py-2.5 px-3 text-sm font-mono text-right font-medium ${pnlColor(trade.profit)}`}>
                        {trade.profit >= 0 ? '+' : ''}{formatCurrency(trade.profit)}
                      </td>
                      <td className="py-2.5 px-3 text-sm font-mono text-right text-text-secondary">
                        {formatDuration(duration)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 py-3 border-t border-border-primary">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 text-xs text-text-secondary hover:text-text-primary disabled:opacity-50 cursor-pointer"
            >
              Previous
            </button>
            <span className="text-xs text-text-tertiary">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1 text-xs text-text-secondary hover:text-text-primary disabled:opacity-50 cursor-pointer"
            >
              Next
            </button>
          </div>
        )}
      </TabsContent>

      <TabsContent value="stats" className="mt-0">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 p-4">
          {stats ? (
            Object.entries(stats).map(([key, value]) => (
              <div key={key}>
                <p className="text-xs text-text-secondary uppercase tracking-wide font-medium mb-1">
                  {key.replace(/([A-Z])/g, ' $1').trim()}
                </p>
                <p className="text-sm font-mono text-text-primary">{String(value)}</p>
              </div>
            ))
          ) : (
            <p className="col-span-3 py-8 text-center text-sm text-text-tertiary">
              No statistics available — sync your account first
            </p>
          )}
        </div>
      </TabsContent>
    </Tabs>
  );
}
