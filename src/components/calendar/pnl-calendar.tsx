'use client';

import { useState, useMemo } from 'react';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, format, isSameMonth, getDay, addDays,
} from 'date-fns';
import { Tooltip } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, formatNumber, pnlColor } from '@/lib/utils';
import { cn } from '@/lib/utils';

export interface CalendarDay {
  date: string;
  pnl: number;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  pips: number;
}

interface PNLCalendarProps {
  year: number;
  month: number;
  days: CalendarDay[];
  onDayClick?: (date: string) => void;
  selectedDate?: string | null;
  showWeeklySummary?: boolean;
}

const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getCellStyle(pnl: number) {
  if (pnl > 0) return { bg: 'bg-profit-bg', border: 'border-profit-border', text: 'text-profit-primary' };
  if (pnl < 0) return { bg: 'bg-loss-bg', border: 'border-loss-border', text: 'text-loss-primary' };
  return { bg: '', border: 'border-border-primary', text: 'text-text-tertiary' };
}

export function PNLCalendar({ year, month, days, onDayClick, selectedDate, showWeeklySummary = false }: PNLCalendarProps) {
  const dayMap = useMemo(() => {
    const map = new Map<string, CalendarDay>();
    for (const d of days) map.set(d.date, d);
    return map;
  }, [days]);

  // Build calendar grid (always start on Monday)
  const monthDate = new Date(year, month - 1, 1);
  const monthStart = startOfMonth(monthDate);
  const monthEnd = endOfMonth(monthDate);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const allDays = eachDayOfInterval({ start: calStart, end: calEnd });

  // Group into weeks for weekly summary
  const weeks: Date[][] = [];
  for (let i = 0; i < allDays.length; i += 7) {
    weeks.push(allDays.slice(i, i + 7));
  }

  return (
    <>
      {/* Desktop Grid */}
      <div className="hidden md:block">
        <div className={cn('grid gap-1', showWeeklySummary ? 'grid-cols-[repeat(7,1fr)_80px]' : 'grid-cols-7')}>
          {/* Day headers */}
          {DAY_HEADERS.map((d) => (
            <div key={d} className="text-center text-xs text-text-secondary uppercase tracking-wider font-medium py-1.5">
              {d}
            </div>
          ))}
          {showWeeklySummary && (
            <div className="text-center text-xs text-text-secondary uppercase tracking-wider font-medium py-1.5">Week</div>
          )}

          {/* Calendar cells */}
          {weeks.map((week, wi) => {
            const weekPnl = week.reduce((sum, day) => {
              if (!isSameMonth(day, monthDate)) return sum;
              const key = format(day, 'yyyy-MM-dd');
              return sum + (dayMap.get(key)?.pnl || 0);
            }, 0);

            return (
              <div key={wi} className={cn('contents')}>
                {week.map((day) => {
                  const key = format(day, 'yyyy-MM-dd');
                  const inMonth = isSameMonth(day, monthDate);
                  const data = dayMap.get(key);
                  const pnl = data?.pnl || 0;
                  const style = getCellStyle(inMonth ? pnl : 0);
                  const isSelected = selectedDate === key;

                  if (!inMonth) {
                    return (
                      <div key={key} className="min-h-[80px] rounded-[var(--radius-sm)] bg-bg-primary/50 opacity-30" />
                    );
                  }

                  return (
                    <Tooltip
                      key={key}
                      content={
                        data && data.tradeCount > 0 ? (
                          <div className="text-xs">
                            <div className="font-medium">{format(day, 'MMM d, yyyy')}</div>
                            <div>PNL: {formatCurrency(pnl)}</div>
                            <div>{data.tradeCount} trades ({data.winCount}W / {data.lossCount}L)</div>
                            {data.pips !== 0 && <div>Pips: {formatNumber(data.pips, 1)}</div>}
                          </div>
                        ) : (
                          <div className="text-xs">{format(day, 'MMM d, yyyy')} — No trades</div>
                        )
                      }
                    >
                      <button
                        onClick={() => onDayClick?.(key)}
                        className={cn(
                          'min-h-[80px] rounded-[var(--radius-sm)] border p-2 flex flex-col items-center justify-center gap-1',
                          'transition-all cursor-pointer',
                          style.bg, style.border,
                          isSelected && 'ring-1 ring-accent-primary',
                          'hover:brightness-125'
                        )}
                      >
                        <span className="text-xs text-text-tertiary self-start">{format(day, 'd')}</span>
                        <span className={cn('text-sm font-mono font-semibold', style.text)}>
                          {pnl === 0 ? '$0' : `${pnl > 0 ? '+' : ''}${formatCurrency(pnl)}`}
                        </span>
                        {data && data.tradeCount > 0 && (
                          <span className="text-[10px] text-text-tertiary">{data.tradeCount} trades</span>
                        )}
                      </button>
                    </Tooltip>
                  );
                })}

                {showWeeklySummary && (
                  <div className={cn(
                    'min-h-[80px] rounded-[var(--radius-sm)] border flex items-center justify-center',
                    weekPnl > 0 ? 'bg-profit-bg border-profit-border' : weekPnl < 0 ? 'bg-loss-bg border-loss-border' : 'border-border-primary'
                  )}>
                    <span className={cn('text-xs font-mono font-semibold', pnlColor(weekPnl))}>
                      {weekPnl === 0 ? '$0' : `${weekPnl > 0 ? '+' : ''}${formatCurrency(weekPnl)}`}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile List View */}
      <div className="md:hidden space-y-1">
        {eachDayOfInterval({ start: monthStart, end: monthEnd }).map((day) => {
          const key = format(day, 'yyyy-MM-dd');
          const data = dayMap.get(key);
          const pnl = data?.pnl || 0;
          const style = getCellStyle(pnl);

          return (
            <button
              key={key}
              onClick={() => onDayClick?.(key)}
              className={cn(
                'w-full flex items-center justify-between px-3 py-2.5 rounded-[var(--radius-sm)] border transition-colors cursor-pointer',
                style.bg, style.border,
                selectedDate === key && 'ring-1 ring-accent-primary'
              )}
            >
              <div className="flex items-center gap-3">
                <span className="text-sm text-text-secondary w-16">{format(day, 'EEE d')}</span>
                {data && data.tradeCount > 0 && (
                  <span className="text-xs text-text-tertiary">{data.tradeCount} trades</span>
                )}
              </div>
              <span className={cn('text-sm font-mono font-semibold', style.text)}>
                {pnl === 0 ? '$0' : `${pnl > 0 ? '+' : ''}${formatCurrency(pnl)}`}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}
