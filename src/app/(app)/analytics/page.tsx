'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { StatCard } from '@/components/analytics/stat-card';
import { SymbolChart } from '@/components/analytics/symbol-chart';
import { DayChart } from '@/components/analytics/day-chart';
import { HourHeatmap } from '@/components/analytics/hour-heatmap';
import { MonthlyGrid } from '@/components/analytics/monthly-grid';
import { DrawdownChart } from '@/components/analytics/drawdown-chart';
import { useAccounts } from '@/hooks/useAccounts';
import { formatCurrency, formatNumber, formatPercent, formatDuration } from '@/lib/utils';

export default function AnalyticsPage() {
  const { selectedAccountId, accounts } = useAccounts();
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [symbolData, setSymbolData] = useState([]);
  const [dayData, setDayData] = useState([]);
  const [hourData, setHourData] = useState([]);
  const [monthlyData, setMonthlyData] = useState([]);
  const [drawdownData, setDrawdownData] = useState<{ series: never[]; maxDrawdownPoint: { date: ''; drawdown: 0; drawdownPct: 0 } } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!selectedAccountId) return;

    async function fetchAll() {
      setLoading(true);
      try {
        const [statsRes, symbolRes, dayRes, hourRes, monthlyRes, drawdownRes] = await Promise.all([
          fetch(`/api/analytics/${selectedAccountId}/stats`),
          fetch(`/api/analytics/${selectedAccountId}/by-symbol`),
          fetch(`/api/analytics/${selectedAccountId}/by-day`),
          fetch(`/api/analytics/${selectedAccountId}/by-hour`),
          fetch(`/api/analytics/${selectedAccountId}/monthly`),
          fetch(`/api/analytics/${selectedAccountId}/drawdown`),
        ]);

        if (statsRes.ok) setStats(await statsRes.json());
        if (symbolRes.ok) setSymbolData(await symbolRes.json());
        if (dayRes.ok) setDayData(await dayRes.json());
        if (hourRes.ok) setHourData(await hourRes.json());
        if (monthlyRes.ok) setMonthlyData(await monthlyRes.json());
        if (drawdownRes.ok) setDrawdownData(await drawdownRes.json());
      } catch (error) {
        console.error('Failed to fetch analytics:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchAll();
  }, [selectedAccountId]);

  if (accounts.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-56px)]">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-text-primary mb-1">No accounts connected</h2>
          <p className="text-sm text-text-secondary mb-4">Connect your MetaTrader account to view analytics.</p>
          <a href="/connect" className="inline-flex items-center px-4 py-2 bg-accent-primary text-white rounded-[var(--radius-md)] text-sm font-medium hover:bg-accent-hover transition-colors">
            Connect Account
          </a>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <h1 className="text-xl font-semibold">Analytics</h1>
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-40 bg-bg-secondary border border-border-primary rounded-[var(--radius-md)] animate-pulse" />
        ))}
      </div>
    );
  }

  // Build stat card data
  const statCards = stats ? [
    { label: 'Profit Factor', value: formatNumber(stats.profitFactor) },
    { label: 'Sharpe Ratio', value: formatNumber(stats.sharpeRatio) },
    { label: 'Sortino Ratio', value: formatNumber(stats.sortinoRatio) },
    { label: 'Max Drawdown (%)', value: formatPercent(stats.maxDrawdownPct), color: 'text-loss-primary' },
    { label: 'Max Drawdown ($)', value: formatCurrency(stats.maxDrawdownAbs), color: 'text-loss-primary' },
    { label: 'Expectancy', value: formatCurrency(stats.expectancy), color: stats.expectancy >= 0 ? 'text-profit-primary' : 'text-loss-primary' },
    { label: 'Average Win', value: formatCurrency(stats.averageWin), color: 'text-profit-primary' },
    { label: 'Average Loss', value: formatCurrency(stats.averageLoss), color: 'text-loss-primary' },
    { label: 'Average Trade', value: formatCurrency(stats.averageTrade || (stats.totalPnl / (stats.totalTrades || 1))) },
    { label: 'Risk/Reward', value: formatNumber(stats.riskRewardRatio) },
    { label: 'Win Rate', value: `${formatNumber(stats.winRate)}%`, color: 'text-profit-primary' },
    { label: 'Loss Rate', value: `${formatNumber(100 - stats.winRate)}%`, color: 'text-loss-primary' },
    { label: 'Best Trade', value: formatCurrency(stats.bestTrade), color: 'text-profit-primary' },
    { label: 'Worst Trade', value: formatCurrency(stats.worstTrade), color: 'text-loss-primary' },
    { label: 'Win Streak', value: String(stats.longestWinStreak) },
    { label: 'Loss Streak', value: String(stats.longestLossStreak) },
    { label: 'Avg Duration', value: formatDuration(stats.avgTradeDuration) },
    { label: 'Total Commission', value: formatCurrency(stats.totalCommission) },
    { label: 'Long Win Rate', value: `${formatNumber(stats.longWinRate || 0)}%` },
    { label: 'Short Win Rate', value: `${formatNumber(stats.shortWinRate || 0)}%` },
    { label: 'Total Pips', value: formatNumber(stats.totalPips) },
    { label: 'Avg Pips/Trade', value: formatNumber(stats.avgPipsPerTrade) },
    { label: 'Best Trade (Pips)', value: formatNumber(stats.bestTradePips), color: 'text-profit-primary' },
    { label: 'Worst Trade (Pips)', value: formatNumber(stats.worstTradePips), color: 'text-loss-primary' },
  ] : [];

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-semibold">Analytics</h1>

      {/* Statistics Grid */}
      <Card>
        <CardHeader>
          <h3 className="text-sm font-medium text-text-primary">Trading Statistics</h3>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {statCards.map((card) => (
              <StatCard key={card.label} label={card.label} value={card.value} color={card.color} />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Performance by Symbol */}
      <Card>
        <CardHeader>
          <h3 className="text-sm font-medium text-text-primary">Performance by Symbol</h3>
        </CardHeader>
        <CardContent>
          <SymbolChart data={symbolData} />
        </CardContent>
      </Card>

      {/* Performance by Day + Hour side by side on desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <h3 className="text-sm font-medium text-text-primary">Performance by Day of Week</h3>
          </CardHeader>
          <CardContent>
            <DayChart data={dayData} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h3 className="text-sm font-medium text-text-primary">Performance by Hour</h3>
          </CardHeader>
          <CardContent>
            <HourHeatmap data={hourData} />
          </CardContent>
        </Card>
      </div>

      {/* Monthly Returns */}
      <Card>
        <CardHeader>
          <h3 className="text-sm font-medium text-text-primary">Monthly Returns</h3>
        </CardHeader>
        <CardContent>
          <MonthlyGrid data={monthlyData} />
        </CardContent>
      </Card>

      {/* Drawdown Chart */}
      <Card>
        <CardHeader>
          <h3 className="text-sm font-medium text-text-primary">Drawdown</h3>
        </CardHeader>
        <CardContent>
          {drawdownData ? (
            <DrawdownChart data={drawdownData} />
          ) : (
            <div className="flex items-center justify-center h-64 text-sm text-text-tertiary">No data</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
