'use client';

import { useState, useEffect, useMemo } from 'react';
import { format, addMonths, subMonths } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PNLCalendar, type CalendarDay } from '@/components/calendar/pnl-calendar';
import { useAccounts } from '@/hooks/useAccounts';
import { formatCurrency, formatNumber, pnlColor, cn } from '@/lib/utils';
import type { Trade } from '@/types';

export default function CalendarPage() {
  const { selectedAccountId, accounts } = useAccounts();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [streaks, setStreaks] = useState({ currentStreak: 0, bestStreak: 0, bestStreakMonth: '' });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayTrades, setDayTrades] = useState<Trade[]>([]);
  const [dayTradesLoading, setDayTradesLoading] = useState(false);
  const [showWeekly, setShowWeekly] = useState(false);
  const [loading, setLoading] = useState(true);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;

  // Fetch calendar data
  useEffect(() => {
    if (!selectedAccountId) return;

    async function fetchCalendar() {
      setLoading(true);
      try {
        const [calRes, streakRes] = await Promise.all([
          fetch(`/api/calendar/${selectedAccountId}/${year}/${month}`),
          fetch(`/api/calendar/${selectedAccountId}/streaks`),
        ]);

        if (calRes.ok) setDays(await calRes.json());
        if (streakRes.ok) setStreaks(await streakRes.json());
      } catch (error) {
        console.error('Failed to fetch calendar:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchCalendar();
    setSelectedDate(null);
    setDayTrades([]);
  }, [selectedAccountId, year, month]);

  // Fetch trades for selected day
  useEffect(() => {
    if (!selectedAccountId || !selectedDate) return;

    async function fetchDayTrades() {
      setDayTradesLoading(true);
      try {
        const res = await fetch(
          `/api/trades/${selectedAccountId}?type=closed&dateFrom=${selectedDate}T00:00:00&dateTo=${selectedDate}T23:59:59&limit=100`
        );
        if (res.ok) {
          const data = await res.json();
          setDayTrades(data.trades || []);
        }
      } catch (error) {
        console.error('Failed to fetch day trades:', error);
      } finally {
        setDayTradesLoading(false);
      }
    }

    fetchDayTrades();
  }, [selectedAccountId, selectedDate]);

  // Summary calculations
  const summary = useMemo(() => {
    const totalPnl = days.reduce((sum, d) => sum + d.pnl, 0);
    const profitDays = days.filter((d) => d.pnl > 0);
    const lossDays = days.filter((d) => d.pnl < 0);
    const totalProfit = profitDays.reduce((sum, d) => sum + d.pnl, 0);
    const totalLoss = Math.abs(lossDays.reduce((sum, d) => sum + d.pnl, 0));
    const total = totalProfit + totalLoss;
    const profitPct = total > 0 ? (totalProfit / total) * 100 : 50;

    return {
      totalPnl,
      winDays: profitDays.length,
      lossDays: lossDays.length,
      totalProfit,
      totalLoss,
      profitPct,
    };
  }, [days]);

  if (accounts.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-56px)]">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-text-primary mb-1">No accounts connected</h2>
          <p className="text-sm text-text-secondary mb-4">Connect your MetaTrader account to view the PNL calendar.</p>
          <a href="/connect" className="inline-flex items-center px-4 py-2 bg-accent-primary text-white rounded-[var(--radius-md)] text-sm font-medium hover:bg-accent-hover transition-colors">
            Connect Account
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 max-w-6xl mx-auto">
      {/* Calendar Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setCurrentDate(subMonths(currentDate, 1))}
            className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-md)] border border-border-primary text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <h1 className="text-xl font-semibold text-text-primary min-w-[160px] text-center">
            {format(currentDate, 'MMMM yyyy')}
          </h1>
          <button
            onClick={() => setCurrentDate(addMonths(currentDate, 1))}
            className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-md)] border border-border-primary text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant={showWeekly ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setShowWeekly(!showWeekly)}
          >
            Weekly
          </Button>
          <Button variant="ghost" size="sm" disabled title="Share — coming in Phase 4">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
          </Button>
        </div>
      </div>

      {/* Summary Bar */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center justify-between mb-2">
            <p className={cn('text-2xl font-bold font-mono', pnlColor(summary.totalPnl))}>
              {summary.totalPnl >= 0 ? '+' : ''}{formatCurrency(summary.totalPnl)}
            </p>
            <span className="text-xs text-text-secondary">
              {days.filter((d) => d.tradeCount > 0).length} trading days
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-2.5 rounded-full bg-bg-tertiary overflow-hidden flex mb-2">
            <div
              className="bg-profit-primary h-full transition-all"
              style={{ width: `${summary.profitPct}%` }}
            />
            <div
              className="bg-loss-primary h-full transition-all"
              style={{ width: `${100 - summary.profitPct}%` }}
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs font-mono">
              <span className="text-profit-primary">{summary.winDays}</span>
              <span className="text-text-tertiary"> / </span>
              <span className="text-profit-primary">+{formatCurrency(summary.totalProfit)}</span>
            </span>
            <span className="text-xs font-mono">
              <span className="text-loss-primary">{summary.lossDays}</span>
              <span className="text-text-tertiary"> / </span>
              <span className="text-loss-primary">-{formatCurrency(summary.totalLoss)}</span>
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Calendar Grid */}
      <Card>
        <CardContent>
          {loading ? (
            <div className="h-[500px] flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-accent-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <PNLCalendar
              year={year}
              month={month}
              days={days}
              onDayClick={(date) => setSelectedDate(selectedDate === date ? null : date)}
              selectedDate={selectedDate}
              showWeeklySummary={showWeekly}
            />
          )}
        </CardContent>
      </Card>

      {/* Day Detail Panel */}
      {selectedDate && (
        <Card>
          <CardContent>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-text-primary">
                Trades on {format(new Date(selectedDate), 'MMMM d, yyyy')}
              </h3>
              <button
                onClick={() => setSelectedDate(null)}
                className="text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {dayTradesLoading ? (
              <p className="text-sm text-text-tertiary py-4 text-center">Loading trades...</p>
            ) : dayTrades.length === 0 ? (
              <p className="text-sm text-text-tertiary py-4 text-center">No trades closed on this day</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-xs text-text-secondary uppercase tracking-wider">
                      <th className="text-left py-2 px-2 font-medium">Symbol</th>
                      <th className="text-left py-2 px-2 font-medium">Dir</th>
                      <th className="text-right py-2 px-2 font-medium">Lots</th>
                      <th className="text-right py-2 px-2 font-medium">PNL</th>
                      <th className="text-right py-2 px-2 font-medium">Pips</th>
                      <th className="text-right py-2 px-2 font-medium">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dayTrades.map((trade) => {
                      const duration = trade.closeTime && trade.openTime
                        ? Math.round((new Date(trade.closeTime).getTime() - new Date(trade.openTime).getTime()) / 60000)
                        : 0;
                      const hours = Math.floor(duration / 60);
                      const mins = duration % 60;
                      return (
                        <tr key={trade.id} className="border-t border-border-primary">
                          <td className="py-2 px-2 text-sm font-medium">{trade.symbol}</td>
                          <td className="py-2 px-2">
                            <Badge variant={trade.direction === 'BUY' ? 'profit' : 'loss'}>
                              {trade.direction}
                            </Badge>
                          </td>
                          <td className="py-2 px-2 text-sm font-mono text-right">{formatNumber(trade.lots)}</td>
                          <td className={cn('py-2 px-2 text-sm font-mono text-right font-medium', pnlColor(trade.profit))}>
                            {trade.profit >= 0 ? '+' : ''}{formatCurrency(trade.profit)}
                          </td>
                          <td className={cn('py-2 px-2 text-xs font-mono text-right', pnlColor(trade.pips || 0))}>
                            {trade.pips != null ? formatNumber(trade.pips, 1) : '—'}
                          </td>
                          <td className="py-2 px-2 text-xs font-mono text-right text-text-secondary">
                            {hours > 0 ? `${hours}h ` : ''}{mins}m
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Footer — Streaks */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between text-xs text-text-secondary gap-2">
        <div className="flex items-center gap-4">
          <span>
            Current Positive Streak:{' '}
            <span className="font-mono text-profit-primary font-medium">{streaks.currentStreak} days</span>
          </span>
          <span>
            Best Streak in {format(currentDate, 'MMMM')}:{' '}
            <span className="font-mono text-profit-primary font-medium">{streaks.bestStreak} days</span>
          </span>
        </div>
        <span className="text-text-tertiary">haia.app</span>
      </div>
    </div>
  );
}
