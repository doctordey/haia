'use client';

import { formatCurrency, pnlColor } from '@/lib/utils';

interface PerformancePanelProps {
  data: {
    totalPnl: number;
    realizedPnl: number;
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
  } | null;
}

const returnRanges = [
  { label: '> 500%', color: 'bg-profit-primary' },
  { label: '200%-500%', color: 'bg-profit-primary/80' },
  { label: '0%-200%', color: 'bg-profit-primary/50' },
  { label: '0% to -50%', color: 'bg-loss-primary/50' },
  { label: '< -50%', color: 'bg-loss-primary' },
];

export function PerformancePanel({ data }: PerformancePanelProps) {
  if (!data) {
    return <div className="h-full animate-pulse bg-bg-tertiary rounded" />;
  }

  const total = data.winningTrades + data.losingTrades;
  const winPct = total > 0 ? (data.winningTrades / total) * 100 : 0;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-text-secondary uppercase tracking-wide font-medium">Total PNL</p>
        <p className={`text-xl font-bold font-mono ${pnlColor(data.totalPnl)}`}>
          {data.totalPnl >= 0 ? '+' : ''}{formatCurrency(data.totalPnl)}
        </p>
      </div>

      <div>
        <p className="text-xs text-text-secondary uppercase tracking-wide font-medium">Realized PNL</p>
        <p className={`text-sm font-mono ${pnlColor(data.realizedPnl)}`}>
          {data.realizedPnl >= 0 ? '+' : ''}{formatCurrency(data.realizedPnl)}
        </p>
      </div>

      <div>
        <p className="text-xs text-text-secondary uppercase tracking-wide font-medium mb-1">Total Trades</p>
        <p className="text-sm font-mono text-text-primary">
          {data.totalTrades}{' '}
          <span className="text-xs">
            (<span className="text-profit-primary">{data.winningTrades}</span>
            {' / '}
            <span className="text-loss-primary">{data.losingTrades}</span>)
          </span>
        </p>
      </div>

      {/* Win/Loss progress bar */}
      <div>
        <div className="flex justify-between text-xs text-text-secondary mb-1">
          <span>Win</span>
          <span>Loss</span>
        </div>
        <div className="h-2 rounded-full bg-bg-tertiary overflow-hidden flex">
          <div className="bg-profit-primary h-full transition-all" style={{ width: `${winPct}%` }} />
          <div className="bg-loss-primary h-full transition-all" style={{ width: `${100 - winPct}%` }} />
        </div>
      </div>

      {/* Trade distribution placeholder */}
      <div>
        <p className="text-xs text-text-secondary uppercase tracking-wide font-medium mb-2">Distribution</p>
        <div className="space-y-1.5">
          {returnRanges.map((range) => (
            <div key={range.label} className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${range.color}`} />
              <span className="text-xs text-text-secondary flex-1">{range.label}</span>
              <span className="text-xs font-mono text-text-tertiary">—</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
