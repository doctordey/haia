'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { SummaryCards } from '@/components/dashboard/summary-cards';
import { PerformancePanel } from '@/components/dashboard/performance-panel';
import { EquityCurve } from '@/components/charts/equity-curve';
import { TradeTable } from '@/components/dashboard/trade-table';
import { useAccounts } from '@/hooks/useAccounts';
import { formatCurrency, formatNumber, formatPercent, formatDuration } from '@/lib/utils';
import type { DashboardData, EquityPoint } from '@/types';

export default function DashboardPage() {
  const { selectedAccountId, accounts } = useAccounts();
  const [dashData, setDashData] = useState<DashboardData | null>(null);
  const [equityData, setEquityData] = useState<EquityPoint[]>([]);
  const [range, setRange] = useState('MAX');
  const [fullStats, setFullStats] = useState<Record<string, number | string> | null>(null);

  useEffect(() => {
    if (!selectedAccountId) return;

    async function fetchDashboard() {
      try {
        const res = await fetch(`/api/dashboard/${selectedAccountId}`);
        if (res.ok) {
          const data = await res.json();
          setDashData(data);
          setFullStats({
            'Profit Factor': formatNumber(data.profitFactor),
            'Sharpe Ratio': formatNumber(data.sharpeRatio),
            'Max Drawdown': formatPercent(data.maxDrawdownPct),
            'Max Drawdown ($)': formatCurrency(data.maxDrawdownAbs),
            'Best Trade': formatCurrency(data.bestTrade),
            'Worst Trade': formatCurrency(data.worstTrade),
            'Avg Duration': formatDuration(data.avgTradeDuration),
            'Win Streak': data.longestWinStreak,
            'Loss Streak': data.longestLossStreak,
            'Total Lots': formatNumber(data.totalLots),
            'Total Commission': formatCurrency(data.totalCommission),
            'Total Swap': formatCurrency(data.totalSwap),
          });
        }
      } catch (error) {
        console.error('Failed to fetch dashboard:', error);
      }
    }

    fetchDashboard();
  }, [selectedAccountId]);

  useEffect(() => {
    if (!selectedAccountId) return;

    async function fetchEquity() {
      try {
        const res = await fetch(`/api/dashboard/${selectedAccountId}/equity-curve?range=${range}`);
        if (res.ok) {
          const data = await res.json();
          setEquityData(data);
        }
      } catch (error) {
        console.error('Failed to fetch equity data:', error);
      }
    }

    fetchEquity();
  }, [selectedAccountId, range]);

  if (accounts.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-56px)]">
        <div className="text-center">
          <div className="w-16 h-16 bg-bg-secondary border border-border-primary rounded-xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-text-primary mb-1">No accounts connected</h2>
          <p className="text-sm text-text-secondary mb-4">Connect your MetaTrader account to start tracking performance.</p>
          <a
            href="/connect"
            className="inline-flex items-center px-4 py-2 bg-accent-primary text-white rounded-[var(--radius-md)] text-sm font-medium hover:bg-accent-hover transition-colors"
          >
            Connect Account
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <SummaryCards data={dashData} />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_350px] gap-4">
        {/* Equity Curve */}
        <Card>
          <CardHeader>
            <h3 className="text-sm font-medium text-text-primary">Equity Curve</h3>
          </CardHeader>
          <CardContent className="h-80">
            <EquityCurve data={equityData} range={range} onRangeChange={setRange} />
          </CardContent>
        </Card>

        {/* Performance Summary */}
        <Card>
          <CardHeader>
            <h3 className="text-sm font-medium text-text-primary">Performance Summary</h3>
          </CardHeader>
          <CardContent>
            <PerformancePanel
              data={
                dashData
                  ? {
                      totalPnl: dashData.totalPnl,
                      realizedPnl: dashData.totalPnl,
                      totalTrades: dashData.winningTrades + dashData.losingTrades,
                      winningTrades: dashData.winningTrades,
                      losingTrades: dashData.losingTrades,
                    }
                  : null
              }
            />
          </CardContent>
        </Card>
      </div>

      {/* Trade Tables */}
      <Card>
        <CardContent className="p-0">
          <TradeTable accountId={selectedAccountId} stats={fullStats || undefined} />
        </CardContent>
      </Card>
    </div>
  );
}
