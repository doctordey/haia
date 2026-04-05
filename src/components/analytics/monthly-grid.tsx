'use client';

import { cn } from '@/lib/utils';
import { Tooltip } from '@/components/ui/tooltip';
import { formatCurrency, formatPercent } from '@/lib/utils';

interface MonthlyData {
  year: number;
  month: number;
  monthName: string;
  pnl: number;
  pctReturn: number;
  trades: number;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function getCellColor(pct: number, maxAbs: number): string {
  if (maxAbs === 0 || pct === 0) return '';
  const intensity = Math.min(Math.abs(pct) / maxAbs, 1);
  if (pct > 0) return `rgba(0, 220, 130, ${intensity * 0.3 + 0.05})`;
  return `rgba(255, 77, 106, ${intensity * 0.3 + 0.05})`;
}

export function MonthlyGrid({ data }: { data: MonthlyData[] }) {
  if (data.length === 0) {
    return <div className="flex items-center justify-center h-40 text-sm text-text-tertiary">No data</div>;
  }

  // Group by year
  const years = [...new Set(data.map((d) => d.year))].sort();
  const maxAbsPct = Math.max(...data.map((d) => Math.abs(d.pctReturn)), 1);

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="text-xs text-text-secondary uppercase tracking-wider">
            <th className="text-left py-2 px-2 font-medium">Year</th>
            {MONTH_NAMES.map((m) => (
              <th key={m} className="text-center py-2 px-1 font-medium">{m}</th>
            ))}
            <th className="text-center py-2 px-2 font-medium">YTD</th>
          </tr>
        </thead>
        <tbody>
          {years.map((year) => {
            const yearData = data.filter((d) => d.year === year);
            const ytd = yearData.reduce((sum, d) => sum + d.pnl, 0);
            const ytdPct = yearData.reduce((sum, d) => sum + d.pctReturn, 0);

            return (
              <tr key={year} className="border-t border-border-primary">
                <td className="py-1.5 px-2 text-sm font-medium text-text-primary">{year}</td>
                {MONTH_NAMES.map((_, monthIdx) => {
                  const monthData = yearData.find((d) => d.month === monthIdx + 1);
                  if (!monthData) {
                    return <td key={monthIdx} className="py-1.5 px-1 text-center text-xs text-text-tertiary">—</td>;
                  }
                  return (
                    <td key={monthIdx} className="py-1.5 px-1">
                      <Tooltip
                        content={
                          <div>
                            <div>{monthData.monthName} {year}</div>
                            <div>PNL: {formatCurrency(monthData.pnl)}</div>
                            <div>Return: {formatPercent(monthData.pctReturn)}</div>
                            <div>Trades: {monthData.trades}</div>
                          </div>
                        }
                      >
                        <div
                          className={cn(
                            'text-center text-xs font-mono py-1 px-1 rounded-[var(--radius-sm)]',
                            monthData.pctReturn > 0 ? 'text-profit-primary' : monthData.pctReturn < 0 ? 'text-loss-primary' : 'text-text-tertiary'
                          )}
                          style={{ backgroundColor: getCellColor(monthData.pctReturn, maxAbsPct) }}
                        >
                          {monthData.pctReturn > 0 ? '+' : ''}{monthData.pctReturn.toFixed(1)}%
                        </div>
                      </Tooltip>
                    </td>
                  );
                })}
                <td className="py-1.5 px-2">
                  <div className={cn(
                    'text-center text-xs font-mono font-semibold',
                    ytd > 0 ? 'text-profit-primary' : ytd < 0 ? 'text-loss-primary' : 'text-text-tertiary'
                  )}>
                    {ytdPct > 0 ? '+' : ''}{ytdPct.toFixed(1)}%
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
