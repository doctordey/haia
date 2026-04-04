'use client';

import { useMemo } from 'react';
import { formatCurrency, formatNumber, formatPercent, cn } from '@/lib/utils';
import { getThemeCss, type ThemeId } from './themes';
import type { CalendarDay } from '@/components/calendar/pnl-calendar';
import { startOfMonth, endOfMonth, eachDayOfInterval, format, startOfWeek, endOfWeek, isSameMonth } from 'date-fns';

export type MetricType = 'pnl' | 'winrate' | 'profitfactor' | 'monthlyreturn' | 'sharpe' | 'pctgain' | 'pips' | 'calendar';
export type AspectRatio = 'square' | 'landscape' | 'story';

export interface FlexCardData {
  // Common
  period: string;
  username?: string;
  avatarUrl?: string;
  // PNL
  totalPnl?: number;
  pctGain?: number;
  tradeCount?: number;
  // Win Rate
  winRate?: number;
  winningTrades?: number;
  losingTrades?: number;
  profitFactor?: number;
  // Monthly Return
  monthlyReturn?: number;
  startBalance?: number;
  endBalance?: number;
  // Sharpe
  sharpeRatio?: number;
  meanReturn?: number;
  stdDev?: number;
  // Pips
  totalPips?: number;
  avgPipsPerTrade?: number;
  bestTradePips?: number;
  // Calendar
  calendarDays?: CalendarDay[];
  calendarYear?: number;
  calendarMonth?: number;
  winDays?: number;
  lossDays?: number;
  // Gross
  grossProfit?: number;
  grossLoss?: number;
}

interface CardPreviewProps {
  metric: MetricType;
  data: FlexCardData;
  theme: ThemeId;
  customBgUrl?: string;
  aspectRatio: AspectRatio;
  showUsername: boolean;
  showChart: boolean;
  showWinLoss: boolean;
  showBranding: boolean;
}

const aspectStyles: Record<AspectRatio, string> = {
  square: 'aspect-square',
  landscape: 'aspect-[1200/630]',
  story: 'aspect-[1080/1920]',
};

const metricLabels: Record<MetricType, string> = {
  pnl: 'Realized PNL',
  winrate: 'Win Rate',
  profitfactor: 'Profit Factor',
  monthlyreturn: 'Monthly Return',
  sharpe: 'Sharpe Ratio',
  pctgain: '% Gain',
  pips: 'Total Pips',
  calendar: 'PNL Calendar',
};

export function CardPreview({
  metric, data, theme, customBgUrl, aspectRatio, showUsername, showChart, showWinLoss, showBranding,
}: CardPreviewProps) {
  const bgCss = getThemeCss(theme, customBgUrl);

  const heroNumber = useMemo(() => {
    switch (metric) {
      case 'pnl': return `${(data.totalPnl || 0) >= 0 ? '+' : ''}${formatCurrency(data.totalPnl || 0)}`;
      case 'winrate': return `${formatNumber(data.winRate || 0)}%`;
      case 'profitfactor': return `${formatNumber(data.profitFactor || 0)}x`;
      case 'monthlyreturn': return formatPercent(data.monthlyReturn || 0);
      case 'sharpe': return formatNumber(data.sharpeRatio || 0);
      case 'pctgain': return formatPercent(data.pctGain || 0);
      case 'pips': return `${(data.totalPips || 0) >= 0 ? '+' : ''}${formatNumber(data.totalPips || 0, 0)} pips`;
      case 'calendar': return '';
      default: return '';
    }
  }, [metric, data]);

  const heroColor = useMemo(() => {
    switch (metric) {
      case 'pnl': return (data.totalPnl || 0) >= 0 ? '#00DC82' : '#FF4D6A';
      case 'winrate': return '#00DC82';
      case 'profitfactor': return (data.profitFactor || 0) >= 1 ? '#00DC82' : '#FF4D6A';
      case 'monthlyreturn': return (data.monthlyReturn || 0) >= 0 ? '#00DC82' : '#FF4D6A';
      case 'sharpe': return (data.sharpeRatio || 0) >= 0 ? '#00DC82' : '#FF4D6A';
      case 'pctgain': return (data.pctGain || 0) >= 0 ? '#00DC82' : '#FF4D6A';
      case 'pips': return (data.totalPips || 0) >= 0 ? '#00DC82' : '#FF4D6A';
      default: return '#E8E9ED';
    }
  }, [metric, data]);

  const stats = useMemo(() => {
    switch (metric) {
      case 'pnl': return [
        { label: 'PNL %', value: formatPercent(data.pctGain || 0) },
        { label: 'Win Rate', value: `${formatNumber(data.winRate || 0)}%` },
        { label: 'Trades', value: String(data.tradeCount || 0) },
      ];
      case 'winrate': return [
        { label: 'Wins / Losses', value: `${data.winningTrades || 0} / ${data.losingTrades || 0}` },
        { label: 'Profit Factor', value: `${formatNumber(data.profitFactor || 0)}x` },
        { label: 'Trades', value: String(data.tradeCount || 0) },
      ];
      case 'profitfactor': return [
        { label: 'Gross Profit', value: formatCurrency(data.grossProfit || 0) },
        { label: 'Gross Loss', value: formatCurrency(data.grossLoss || 0) },
        { label: 'Trades', value: String(data.tradeCount || 0) },
      ];
      case 'monthlyreturn': return [
        { label: 'Start Balance', value: formatCurrency(data.startBalance || 0) },
        { label: 'End Balance', value: formatCurrency(data.endBalance || 0) },
        { label: 'PNL', value: formatCurrency(data.totalPnl || 0) },
      ];
      case 'sharpe': return [
        { label: 'Mean Return', value: formatCurrency(data.meanReturn || 0) },
        { label: 'Std Dev', value: formatCurrency(data.stdDev || 0) },
        { label: 'Trades', value: String(data.tradeCount || 0) },
      ];
      case 'pctgain': return [
        { label: 'Start Balance', value: formatCurrency(data.startBalance || 0) },
        { label: 'End Balance', value: formatCurrency(data.endBalance || 0) },
        { label: 'Difference', value: formatCurrency((data.endBalance || 0) - (data.startBalance || 0)) },
      ];
      case 'pips': return [
        { label: 'Avg/Trade', value: `${formatNumber(data.avgPipsPerTrade || 0, 1)} pips` },
        { label: 'Best Trade', value: `${formatNumber(data.bestTradePips || 0, 1)} pips` },
        { label: 'Trades', value: String(data.tradeCount || 0) },
      ];
      default: return [];
    }
  }, [metric, data]);

  return (
    <div
      id="flex-card-preview"
      className={cn('relative overflow-hidden rounded-[var(--radius-xl)] w-full', aspectStyles[aspectRatio])}
      style={{ background: bgCss }}
    >
      <div className="absolute inset-0 flex flex-col p-6 justify-between">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="w-7 h-7 bg-[#6C5CE7] rounded-md flex items-center justify-center">
            <span className="text-white font-bold text-xs">H</span>
          </div>
          <span className="text-[#8B8D98] text-sm font-medium">Haia</span>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          {metric !== 'calendar' ? (
            <>
              <p className="text-[#8B8D98] text-sm">{data.period} {metricLabels[metric]}</p>
              <p className="text-3xl font-bold font-mono" style={{ color: heroColor }}>{heroNumber}</p>

              {showWinLoss && (
                <div className="space-y-1.5 mt-2 w-full max-w-[240px]">
                  {stats.map((s) => (
                    <div key={s.label} className="flex justify-between">
                      <span className="text-[#8B8D98] text-xs">{s.label}</span>
                      <span className="text-[#E8E9ED] text-xs font-mono">{s.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <MiniCalendar
              days={data.calendarDays || []}
              year={data.calendarYear || new Date().getFullYear()}
              month={data.calendarMonth || new Date().getMonth() + 1}
              totalPnl={data.totalPnl || 0}
              winDays={data.winDays || 0}
              lossDays={data.lossDays || 0}
            />
          )}
        </div>

        {/* Footer */}
        <div>
          {showUsername && data.username && (
            <div className="flex items-center gap-2 mb-2">
              {data.avatarUrl ? (
                <img src={data.avatarUrl} className="w-5 h-5 rounded-full" alt="" />
              ) : (
                <div className="w-5 h-5 rounded-full bg-[#6C5CE7]/30 flex items-center justify-center text-[10px] text-[#6C5CE7]">
                  {data.username[0]?.toUpperCase()}
                </div>
              )}
              <span className="text-[#E8E9ED] text-xs">@{data.username}</span>
            </div>
          )}
          {showBranding && (
            <div className="flex items-center justify-between">
              <span className="text-[#5A5C66] text-[10px]">haia.app</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Mini calendar for the calendar card type
function MiniCalendar({
  days, year, month, totalPnl, winDays, lossDays,
}: {
  days: CalendarDay[];
  year: number;
  month: number;
  totalPnl: number;
  winDays: number;
  lossDays: number;
}) {
  const monthDate = new Date(year, month - 1, 1);
  const monthStart = startOfMonth(monthDate);
  const monthEnd = endOfMonth(monthDate);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const allDays = eachDayOfInterval({ start: calStart, end: calEnd });

  const dayMap = new Map(days.map((d) => [d.date, d]));
  const pnlColor = totalPnl >= 0 ? '#00DC82' : '#FF4D6A';

  return (
    <div className="w-full max-w-[300px]">
      <div className="flex justify-between items-center mb-2">
        <span className="text-[#E8E9ED] text-sm font-medium">{format(monthDate, 'MMM yyyy')}</span>
        <span className="text-sm font-mono font-bold" style={{ color: pnlColor }}>
          {totalPnl >= 0 ? '+' : ''}{formatCurrency(totalPnl)}
        </span>
      </div>

      <div className="grid grid-cols-7 gap-0.5 mb-2">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <div key={i} className="text-center text-[8px] text-[#5A5C66]">{d}</div>
        ))}
        {allDays.map((day) => {
          const key = format(day, 'yyyy-MM-dd');
          const inMonth = isSameMonth(day, monthDate);
          const data = dayMap.get(key);
          const pnl = data?.pnl || 0;

          if (!inMonth) return <div key={key} className="aspect-square" />;

          const bg = pnl > 0 ? 'rgba(0,220,130,0.2)' : pnl < 0 ? 'rgba(255,77,106,0.2)' : 'rgba(90,92,102,0.1)';
          const color = pnl > 0 ? '#00DC82' : pnl < 0 ? '#FF4D6A' : '#5A5C66';

          return (
            <div
              key={key}
              className="aspect-square rounded-[2px] flex items-center justify-center"
              style={{ backgroundColor: bg }}
            >
              <span className="text-[7px] font-mono" style={{ color }}>
                {pnl === 0 ? '' : pnl > 0 ? `+${Math.round(pnl)}` : Math.round(pnl)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex justify-between text-[10px]">
        <span className="text-[#00DC82]">Win Days: {winDays}</span>
        <span className="text-[#FF4D6A]">Loss Days: {lossDays}</span>
      </div>
    </div>
  );
}
