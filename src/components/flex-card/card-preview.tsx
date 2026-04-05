'use client';

import { useMemo } from 'react';
import { formatCurrency, formatNumber, formatPercent, cn } from '@/lib/utils';
import { getThemeCss, type ThemeId } from './themes';
import type { CalendarDay } from '@/components/calendar/pnl-calendar';
import { startOfMonth, endOfMonth, eachDayOfInterval, format, startOfWeek, endOfWeek, isSameMonth } from 'date-fns';

export type MetricType = 'pnl' | 'winrate' | 'profitfactor' | 'monthlyreturn' | 'sharpe' | 'pctgain' | 'pips' | 'calendar';
export type AspectRatio = 'square' | 'landscape' | 'story';
export type CardLayout = 'default' | 'terminal';

export interface FlexCardData {
  period: string;
  username?: string;
  avatarUrl?: string;
  totalPnl?: number;
  pctGain?: number;
  tradeCount?: number;
  winRate?: number;
  winningTrades?: number;
  losingTrades?: number;
  profitFactor?: number;
  monthlyReturn?: number;
  startBalance?: number;
  endBalance?: number;
  sharpeRatio?: number;
  meanReturn?: number;
  stdDev?: number;
  totalPips?: number;
  avgPipsPerTrade?: number;
  bestTradePips?: number;
  calendarDays?: CalendarDay[];
  calendarYear?: number;
  calendarMonth?: number;
  winDays?: number;
  lossDays?: number;
  grossProfit?: number;
  grossLoss?: number;
}

export interface CardCustomStyles {
  textColor: string;
  profitColor: string;
  lossColor: string;
  boldText: boolean;
  textShadow: boolean;
  showPnlRectangle: boolean;
  rectangleTextColor: string;
}

export const defaultCardStyles: CardCustomStyles = {
  textColor: '#E8E9ED',
  profitColor: '#00DC82',
  lossColor: '#FF4D6A',
  boldText: true,
  textShadow: false,
  showPnlRectangle: false,
  rectangleTextColor: '#FFFFFF',
};

interface CardPreviewProps {
  metric: MetricType;
  data: FlexCardData;
  theme: ThemeId;
  customBgUrl?: string;
  aspectRatio: AspectRatio;
  layout: CardLayout;
  showUsername: boolean;
  showChart: boolean;
  showWinLoss: boolean;
  showBranding: boolean;
  customStyles?: CardCustomStyles;
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

// Monospace font stack matching terminal/Axiom aesthetic
const MONO_FONT = "'JetBrains Mono', 'SF Mono', 'Fira Code', 'Cascadia Code', monospace";
const SANS_FONT = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";

function useCardData(metric: MetricType, data: FlexCardData, styles: CardCustomStyles = defaultCardStyles) {
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

  const isPositive = useMemo(() => {
    switch (metric) {
      case 'pnl': return (data.totalPnl || 0) >= 0;
      case 'winrate': return true;
      case 'profitfactor': return (data.profitFactor || 0) >= 1;
      case 'monthlyreturn': return (data.monthlyReturn || 0) >= 0;
      case 'sharpe': return (data.sharpeRatio || 0) >= 0;
      case 'pctgain': return (data.pctGain || 0) >= 0;
      case 'pips': return (data.totalPips || 0) >= 0;
      default: return true;
    }
  }, [metric, data]);

  const heroColor = useMemo(() => {
    if (metric === 'calendar') return styles.textColor;
    return isPositive ? styles.profitColor : styles.lossColor;
  }, [metric, isPositive, styles]);

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

  return { heroNumber, heroColor, stats };
}

export function CardPreview(props: CardPreviewProps) {
  const styles = props.customStyles || defaultCardStyles;
  const propsWithStyles = { ...props, customStyles: styles };
  if (props.layout === 'terminal') return <TerminalLayout {...propsWithStyles} />;
  return <DefaultLayout {...propsWithStyles} />;
}

// ─── Default Layout (Haia style) ─────────────────────

function DefaultLayout({
  metric, data, theme, customBgUrl, aspectRatio, showUsername, showChart, showWinLoss, showBranding, customStyles,
}: CardPreviewProps) {
  const bgCss = getThemeCss(theme, customBgUrl);
  const s = customStyles || defaultCardStyles;
  const { heroNumber, heroColor, stats } = useCardData(metric, data, s);
  const textShadow = s.textShadow ? '0 2px 8px rgba(0,0,0,0.6)' : 'none';
  const fontWeight = s.boldText ? 700 : 400;
  const labelColor = s.textColor + '99'; // 60% opacity version

  return (
    <div
      id="flex-card-preview"
      className={cn('relative overflow-hidden rounded-[var(--radius-xl)] w-full', aspectStyles[aspectRatio])}
      style={{ background: bgCss }}
    >
      <div className="absolute inset-0 flex flex-col p-6 justify-between">
        <div className="flex items-center justify-between">
          <div className="w-7 h-7 bg-[#6C5CE7] rounded-md flex items-center justify-center">
            <span className="text-white font-bold text-xs" style={{ fontFamily: SANS_FONT }}>H</span>
          </div>
          <span className="text-sm font-medium" style={{ color: labelColor, fontFamily: SANS_FONT, textShadow }}>Haia</span>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          {metric !== 'calendar' ? (
            <>
              <p className="text-sm" style={{ color: labelColor, fontFamily: SANS_FONT, textShadow }}>{data.period} {metricLabels[metric]}</p>
              {s.showPnlRectangle ? (
                <div className="px-4 py-1 rounded-md" style={{ background: heroColor }}>
                  <p className="text-3xl" style={{ color: s.rectangleTextColor, fontFamily: MONO_FONT, fontWeight, textShadow }}>
                    {heroNumber}
                  </p>
                </div>
              ) : (
                <p className="text-3xl" style={{ color: heroColor, fontFamily: MONO_FONT, fontWeight, textShadow }}>
                  {heroNumber}
                </p>
              )}
              {showWinLoss && (
                <div className="space-y-1.5 mt-2 w-full max-w-[240px]">
                  {stats.map((st) => (
                    <div key={st.label} className="flex justify-between">
                      <span className="text-xs" style={{ color: labelColor, fontFamily: SANS_FONT, textShadow }}>{st.label}</span>
                      <span className="text-xs" style={{ color: s.textColor, fontFamily: MONO_FONT, fontWeight: s.boldText ? 600 : 400, textShadow }}>{st.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <MiniCalendar days={data.calendarDays || []} year={data.calendarYear || new Date().getFullYear()} month={data.calendarMonth || new Date().getMonth() + 1} totalPnl={data.totalPnl || 0} winDays={data.winDays || 0} lossDays={data.lossDays || 0} styles={s} />
          )}
        </div>

        <div>
          {showUsername && data.username && (
            <div className="flex items-center gap-2 mb-2">
              {data.avatarUrl ? (
                <img src={data.avatarUrl} className="w-5 h-5 rounded-full" alt="" />
              ) : (
                <div className="w-5 h-5 rounded-full bg-[#6C5CE7]/30 flex items-center justify-center text-[10px]" style={{ color: '#6C5CE7', fontFamily: SANS_FONT }}>
                  {data.username[0]?.toUpperCase()}
                </div>
              )}
              <span className="text-xs" style={{ color: s.textColor, fontFamily: SANS_FONT, textShadow }}>@{data.username}</span>
            </div>
          )}
          {showBranding && (
            <span className="text-[10px]" style={{ color: labelColor, fontFamily: SANS_FONT, textShadow }}>haia.app</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Terminal Layout (Axiom/Terminal style) ───────────

function TerminalLayout({
  metric, data, theme, customBgUrl, aspectRatio, showUsername, showChart, showWinLoss, showBranding, customStyles,
}: CardPreviewProps) {
  const bgCss = getThemeCss(theme, customBgUrl);
  const s = customStyles || defaultCardStyles;
  const { heroNumber, heroColor, stats } = useCardData(metric, data, s);
  const textShadow = s.textShadow ? '0 2px 8px rgba(0,0,0,0.6)' : 'none';
  const fontWeight = s.boldText ? 700 : 400;
  const labelColor = s.textColor + '80'; // 50% opacity for labels

  return (
    <div
      id="flex-card-preview"
      className={cn('relative overflow-hidden rounded-[var(--radius-lg)] w-full', aspectStyles[aspectRatio])}
      style={{ background: bgCss }}
    >
      <div className="absolute inset-0 flex flex-col p-5 justify-between" style={{ fontFamily: MONO_FONT }}>
        {/* Terminal header bar */}
        <div className="flex items-center justify-between pb-3 mb-3" style={{ borderBottom: '1px solid rgba(42,45,58,0.8)' }}>
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: s.lossColor + '99' }} />
              <div className="w-2.5 h-2.5 rounded-full bg-[#FFB347]/60" />
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: s.profitColor + '99' }} />
            </div>
            <span className="text-[10px] uppercase tracking-[0.15em]" style={{ color: labelColor, textShadow }}>haia terminal</span>
          </div>
          <span className="text-[10px]" style={{ color: labelColor, textShadow }}>{data.period}</span>
        </div>

        {metric !== 'calendar' ? (
          <>
            {/* Metric label */}
            <div className="mb-1">
              <span className="text-[10px] uppercase tracking-[0.12em]" style={{ color: labelColor, textShadow }}>
                {metricLabels[metric]}
              </span>
            </div>

            {/* Hero number — large, left-aligned */}
            <div className="mb-4">
              {s.showPnlRectangle ? (
                <span className="inline-block px-4 py-1 rounded-md text-4xl tracking-tight" style={{ background: heroColor, color: s.rectangleTextColor, fontWeight, textShadow }}>
                  {heroNumber}
                </span>
              ) : (
                <span className="text-4xl tracking-tight" style={{ color: heroColor, fontWeight, textShadow }}>
                  {heroNumber}
                </span>
              )}
            </div>

            {/* Stats grid — terminal rows */}
            {showWinLoss && (
              <div className="flex-1">
                <div className="space-y-0">
                  {stats.map((st, i) => (
                    <div
                      key={st.label}
                      className="flex items-center justify-between py-2"
                      style={{ borderBottom: i < stats.length - 1 ? '1px solid rgba(30,33,48,0.6)' : 'none' }}
                    >
                      <span className="text-xs uppercase tracking-wider" style={{ color: labelColor, textShadow }}>{st.label}</span>
                      <span className="text-sm" style={{ color: s.textColor, fontWeight: s.boldText ? 600 : 400, textShadow }}>{st.value}</span>
                    </div>
                  ))}
                </div>

                {/* Win/Loss bar */}
                {(data.winningTrades || data.losingTrades) ? (
                  <div className="mt-3">
                    <div className="flex justify-between text-[10px] mb-1">
                      <span style={{ color: s.profitColor, textShadow }}>{data.winningTrades || 0}W</span>
                      <span style={{ color: s.lossColor, textShadow }}>{data.losingTrades || 0}L</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden flex" style={{ background: 'rgba(30,33,48,0.8)' }}>
                      <div className="h-full" style={{
                        width: `${((data.winningTrades || 0) / ((data.winningTrades || 0) + (data.losingTrades || 0) || 1)) * 100}%`,
                        background: s.profitColor,
                      }} />
                      <div className="h-full flex-1" style={{ background: s.lossColor }} />
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </>
        ) : (
          <MiniCalendar days={data.calendarDays || []} year={data.calendarYear || new Date().getFullYear()} month={data.calendarMonth || new Date().getMonth() + 1} totalPnl={data.totalPnl || 0} winDays={data.winDays || 0} lossDays={data.lossDays || 0} styles={s} />
        )}

        {/* Footer */}
        <div className="mt-auto pt-3" style={{ borderTop: '1px solid rgba(42,45,58,0.8)' }}>
          <div className="flex items-center justify-between">
            {showUsername && data.username ? (
              <div className="flex items-center gap-2">
                {data.avatarUrl ? (
                  <img src={data.avatarUrl} className="w-4 h-4 rounded-full" alt="" />
                ) : (
                  <div className="w-4 h-4 rounded-full flex items-center justify-center text-[8px]" style={{ background: 'rgba(108,92,231,0.3)', color: '#6C5CE7' }}>
                    {data.username[0]?.toUpperCase()}
                  </div>
                )}
                <span className="text-[11px]" style={{ color: s.textColor + 'CC', textShadow }}>@{data.username}</span>
              </div>
            ) : <div />}
            {showBranding && (
              <span className="text-[9px] uppercase tracking-[0.15em]" style={{ color: labelColor, textShadow }}>haia.app</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Mini Calendar ───────────────────────────────────

function MiniCalendar({
  days, year, month, totalPnl, winDays, lossDays, styles,
}: {
  days: CalendarDay[];
  year: number;
  month: number;
  totalPnl: number;
  winDays: number;
  lossDays: number;
  styles?: CardCustomStyles;
}) {
  const s = styles || defaultCardStyles;
  const monthDate = new Date(year, month - 1, 1);
  const monthStart = startOfMonth(monthDate);
  const monthEnd = endOfMonth(monthDate);
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const allDays = eachDayOfInterval({ start: calStart, end: calEnd });
  const dayMap = new Map(days.map((d) => [d.date, d]));
  const pnlColor = totalPnl >= 0 ? s.profitColor : s.lossColor;

  return (
    <div className="w-full max-w-[300px]" style={{ fontFamily: MONO_FONT }}>
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm font-medium" style={{ color: s.textColor }}>{format(monthDate, 'MMM yyyy')}</span>
        <span className="text-sm font-bold" style={{ color: pnlColor }}>
          {totalPnl >= 0 ? '+' : ''}{formatCurrency(totalPnl)}
        </span>
      </div>
      <div className="grid grid-cols-7 gap-0.5 mb-2">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <div key={i} className="text-center text-[8px]" style={{ color: s.textColor + '66' }}>{d}</div>
        ))}
        {allDays.map((day) => {
          const key = format(day, 'yyyy-MM-dd');
          const inMonth = isSameMonth(day, monthDate);
          if (!inMonth) return <div key={key} className="aspect-square" />;
          const dd = dayMap.get(key);
          const pnl = dd?.pnl || 0;
          const bg = pnl > 0 ? s.profitColor + '33' : pnl < 0 ? s.lossColor + '33' : 'rgba(90,92,102,0.1)';
          const color = pnl > 0 ? s.profitColor : pnl < 0 ? s.lossColor : s.textColor + '66';
          return (
            <div key={key} className="aspect-square rounded-[2px] flex items-center justify-center" style={{ backgroundColor: bg }}>
              <span className="text-[7px]" style={{ color, fontFamily: MONO_FONT }}>
                {pnl === 0 ? '' : pnl > 0 ? `+${Math.round(pnl)}` : Math.round(pnl)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px]">
        <span style={{ color: s.profitColor }}>Win Days: {winDays}</span>
        <span style={{ color: s.lossColor }}>Loss Days: {lossDays}</span>
      </div>
    </div>
  );
}
