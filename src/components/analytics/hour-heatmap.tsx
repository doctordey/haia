'use client';

import { Tooltip } from '@/components/ui/tooltip';
import { formatCurrency } from '@/lib/utils';

interface HourData {
  hour: number;
  day: number;
  dayName: string;
  pnl: number;
  count: number;
}

function getHeatColor(pnl: number, maxAbs: number): string {
  if (maxAbs === 0 || pnl === 0) return 'var(--bg-tertiary)';
  const intensity = Math.min(Math.abs(pnl) / maxAbs, 1);
  if (pnl > 0) {
    const alpha = Math.round(intensity * 80 + 20);
    return `rgba(0, 220, 130, ${alpha / 100})`;
  } else {
    const alpha = Math.round(intensity * 80 + 20);
    return `rgba(255, 77, 106, ${alpha / 100})`;
  }
}

export function HourHeatmap({ data }: { data: HourData[] }) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const maxAbs = Math.max(...data.map((d) => Math.abs(d.pnl)), 1);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[700px]">
        {/* Hour labels */}
        <div className="flex ml-10 mb-1">
          {hours.map((h) => (
            <div key={h} className="flex-1 text-center text-[10px] text-text-tertiary">
              {h.toString().padStart(2, '0')}
            </div>
          ))}
        </div>

        {/* Grid rows */}
        {days.map((dayName, dayIdx) => (
          <div key={dayName} className="flex items-center mb-0.5">
            <span className="w-10 text-xs text-text-secondary text-right pr-2 shrink-0">{dayName}</span>
            <div className="flex flex-1 gap-0.5">
              {hours.map((hour) => {
                const cell = data.find((d) => d.day === dayIdx && d.hour === hour);
                const pnl = cell?.pnl || 0;
                const count = cell?.count || 0;
                return (
                  <Tooltip
                    key={hour}
                    content={
                      <div>
                        <div>{dayName} {hour}:00</div>
                        <div>PNL: {formatCurrency(pnl)}</div>
                        <div>Trades: {count}</div>
                      </div>
                    }
                  >
                    <div
                      className="flex-1 aspect-square rounded-sm min-w-[20px]"
                      style={{ backgroundColor: getHeatColor(pnl, maxAbs) }}
                    />
                  </Tooltip>
                );
              })}
            </div>
          </div>
        ))}

        {/* Legend */}
        <div className="flex items-center justify-center gap-4 mt-3">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(255, 77, 106, 0.8)' }} />
            <span className="text-[10px] text-text-tertiary">Loss</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm bg-bg-tertiary" />
            <span className="text-[10px] text-text-tertiary">Neutral</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(0, 220, 130, 0.8)' }} />
            <span className="text-[10px] text-text-tertiary">Profit</span>
          </div>
        </div>
      </div>
    </div>
  );
}
