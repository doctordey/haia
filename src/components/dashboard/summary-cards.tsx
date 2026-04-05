'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, formatPercent, formatNumber } from '@/lib/utils';
import type { DashboardData } from '@/types';

interface SummaryCardsProps {
  data: DashboardData | null;
  onSync?: () => void;
  syncing?: boolean;
}

export function SummaryCards({ data, onSync, syncing }: SummaryCardsProps) {
  if (!data) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardContent className="py-4">
              <div className="h-16 animate-pulse bg-bg-tertiary rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const cards = [
    {
      label: 'Account Balance',
      value: formatCurrency(data.balance),
      mono: true,
    },
    {
      label: 'Total PNL',
      value: formatCurrency(data.totalPnl),
      badge: formatPercent(data.pnlPercent),
      badgeVariant: (data.totalPnl >= 0 ? 'profit' : 'loss') as 'profit' | 'loss',
      mono: true,
      color: data.totalPnl >= 0 ? 'text-profit-primary' : 'text-loss-primary',
    },
    {
      label: 'Win Rate',
      value: `${data.winRate.toFixed(1)}%`,
      sub: `${data.winningTrades}W / ${data.losingTrades}L`,
      mono: true,
    },
    {
      label: 'Active Trades',
      value: String(data.openTradesCount),
      sub: data.unrealizedPnl !== 0 ? formatCurrency(data.unrealizedPnl) : undefined,
      subColor: data.unrealizedPnl >= 0 ? 'text-profit-primary' : 'text-loss-primary',
      mono: true,
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card, i) => (
        <Card key={card.label} hover>
          <CardContent className="py-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-text-secondary uppercase tracking-wide font-medium">{card.label}</p>
              {i === 0 && onSync && (
                <button
                  onClick={onSync}
                  disabled={syncing}
                  className="text-xs text-accent-primary hover:text-accent-hover disabled:opacity-50 cursor-pointer"
                  title="Re-sync trades from MetaTrader"
                >
                  {syncing ? 'Syncing...' : 'Sync'}
                </button>
              )}
            </div>
            <div className="flex items-baseline gap-2">
              <span className={`text-2xl font-bold ${card.mono ? 'font-mono' : ''} ${card.color || 'text-text-primary'}`}>
                {card.value}
              </span>
              {card.badge && <Badge variant={card.badgeVariant}>{card.badge}</Badge>}
            </div>
            {card.sub && (
              <p className={`text-xs mt-1 font-mono ${card.subColor || 'text-text-secondary'}`}>{card.sub}</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
