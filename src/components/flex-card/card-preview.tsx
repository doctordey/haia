'use client';

import { useMemo } from 'react';
import { formatCurrency, formatNumber, formatPercent, cn } from '@/lib/utils';
import { getThemeCss, type ThemeId } from './themes';
import { getFontStack, type FontFamilyId } from './fonts';
import type { CalendarDay } from '@/components/calendar/pnl-calendar';
import { startOfMonth, endOfMonth, eachDayOfInterval, format, startOfWeek, endOfWeek, isSameMonth } from 'date-fns';

export type MetricType = 'pnl' | 'winrate' | 'profitfactor' | 'monthlyreturn' | 'sharpe' | 'pctgain' | 'pips' | 'calendar';
export type AspectRatio = 'square' | 'landscape' | 'story';
export type CardLayout = 'default' | 'terminal' | 'hero' | 'axiom';

export interface CardStyling {
  fontFamily: FontFamilyId;
  heroFontFamily: FontFamilyId | null;   // null = inherit from fontFamily
  valueFontFamily: FontFamilyId | null;  // null = inherit from fontFamily
  heroColor: string | null;      // null = auto (green/red based on value)
  labelColor: string;
  valueColor: string;
  usernameColor: string;
  brandingColor: string;
  heroBoxColor: string | null;   // null = match heroColor
  heroBoxTextColor: string;
}

export const DEFAULT_STYLING: CardStyling = {
  fontFamily: 'inter',
  heroFontFamily: null,
  valueFontFamily: null,
  heroColor: null,
  labelColor: '#8B8D98',
  valueColor: '#E8E9ED',
  usernameColor: '#E8E9ED',
  brandingColor: '#5A5C66',
  heroBoxColor: null,
  heroBoxTextColor: '#0B0C10',
};

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
  equityCurve?: { date: string; equity: number }[];
  ctaTopLine?: string;
  ctaBottomLine?: string;
}

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
  styling?: CardStyling;
  visibleStats?: [boolean, boolean, boolean]; // per-stat toggle for bottom row
  showHeroBox?: boolean; // colored box behind hero number
}

const aspectStyles: Record<AspectRatio, string> = {
  square: 'aspect-square',
  landscape: 'aspect-[16/9]',
  story: 'aspect-[1080/1920]',
};

// Landscape is much shorter — use tighter padding/gaps/font sizes
function useLandscapeCompact(aspectRatio: AspectRatio) {
  const isLandscape = aspectRatio === 'landscape';
  return {
    pad: isLandscape ? 'p-4' : 'p-6',
    padTerminal: isLandscape ? 'p-3' : 'p-5',
    gap: isLandscape ? 'gap-1' : 'gap-3',
    heroSize: isLandscape ? 'text-2xl' : 'text-3xl',
    heroSizeLg: isLandscape ? 'text-3xl' : 'text-4xl',
    terminalHero: isLandscape ? 'text-3xl' : 'text-4xl',
    statLabel: isLandscape ? 'text-[10px]' : 'text-xs',
    statValue: isLandscape ? 'text-sm' : 'text-xl',
    statGap: isLandscape ? 'gap-4' : 'gap-8',
    sparkH: isLandscape ? 28 : 48,
    sparkHSm: isLandscape ? 24 : 36,
    sparkW: isLandscape ? 180 : 280,
    sparkWSm: isLandscape ? 160 : 220,
    mb: isLandscape ? 'mb-1' : 'mb-2',
    mt: isLandscape ? 'mt-2' : 'mt-4',
  };
}

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

function useCardData(metric: MetricType, data: FlexCardData, overrideHeroColor: string | null) {
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
    if (overrideHeroColor) return overrideHeroColor;
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
  }, [metric, data, overrideHeroColor]);

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
  if (props.layout === 'terminal') return <TerminalLayout {...props} />;
  if (props.layout === 'hero') return <HeroLayout {...props} />;
  if (props.layout === 'axiom') return <AxiomLayout {...props} />;
  return <DefaultLayout {...props} />;
}

// ─── Sparkline ───────────────────────────────────────

function Sparkline({
  points,
  color,
  width = 220,
  height = 50,
  strokeWidth = 2,
}: {
  points: { equity: number }[];
  color: string;
  width?: number;
  height?: number;
  strokeWidth?: number;
}) {
  if (!points || points.length < 2) return null;

  const values = points.map((p) => p.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const stepX = width / (points.length - 1);
  const coords = points.map((p, i) => {
    const x = i * stepX;
    const y = height - ((p.equity - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const linePath = `M ${coords.join(' L ')}`;
  const areaPath = `${linePath} L ${width},${height} L 0,${height} Z`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id={`spark-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#spark-${color.replace('#', '')})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ─── Default Layout (Haia style) ─────────────────────

function DefaultLayout({
  metric, data, theme, customBgUrl, aspectRatio, showUsername, showChart, showWinLoss, showBranding, styling,
}: CardPreviewProps) {
  const style = styling ?? DEFAULT_STYLING;
  const fontStack = getFontStack(style.fontFamily);
  const heroFontStack = getFontStack(style.heroFontFamily ?? style.fontFamily);
  const valueFontStack = getFontStack(style.valueFontFamily ?? style.fontFamily);
  const bgCss = getThemeCss(theme, customBgUrl);
  const { heroNumber, heroColor, stats } = useCardData(metric, data, style.heroColor);
  const c = useLandscapeCompact(aspectRatio);

  return (
    <div
      id="flex-card-preview"
      className={cn('relative overflow-hidden rounded-[var(--radius-xl)] w-full', aspectStyles[aspectRatio])}
      style={{ background: bgCss }}
    >
      <div className={cn('absolute inset-0 flex flex-col justify-between', c.pad)}>
        <div className="flex items-center justify-between">
          <div className="w-7 h-7 bg-[#6C5CE7] rounded-md flex items-center justify-center">
            <span className="text-white font-bold text-xs" style={{ fontFamily: fontStack }}>H</span>
          </div>
          <span className="text-sm font-medium" style={{ color: style.labelColor, fontFamily: fontStack }}>Haia</span>
        </div>

        <div className={cn('flex-1 flex flex-col items-center justify-center', c.gap)}>
          {metric !== 'calendar' ? (
            <>
              <p className="text-sm" style={{ color: style.labelColor, fontFamily: fontStack }}>{data.period} {metricLabels[metric]}</p>
              <p className={cn(c.heroSize, 'font-bold')} style={{ color: heroColor, fontFamily: heroFontStack }}>{heroNumber}</p>
              {showChart && data.equityCurve && data.equityCurve.length > 1 && (
                <div className="opacity-80 -mt-1">
                  <Sparkline points={data.equityCurve} color={heroColor} width={c.sparkWSm} height={c.sparkHSm} />
                </div>
              )}
              {showWinLoss && (
                <div className="space-y-1 mt-1 w-full max-w-[240px]">
                  {stats.map((s) => (
                    <div key={s.label} className="flex justify-between">
                      <span className={c.statLabel} style={{ color: style.labelColor, fontFamily: fontStack }}>{s.label}</span>
                      <span className={c.statLabel} style={{ color: style.valueColor, fontFamily: valueFontStack }}>{s.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <MiniCalendar days={data.calendarDays || []} year={data.calendarYear || new Date().getFullYear()} month={data.calendarMonth || new Date().getMonth() + 1} totalPnl={data.totalPnl || 0} winDays={data.winDays || 0} lossDays={data.lossDays || 0} fontStack={fontStack} labelColor={style.labelColor} valueColor={style.valueColor} />
          )}
        </div>

        <div>
          {showUsername && data.username && (
            <div className="flex items-center gap-2 mb-2">
              {data.avatarUrl ? (
                <img src={data.avatarUrl} className="w-5 h-5 rounded-full" alt="" />
              ) : (
                <div className="w-5 h-5 rounded-full bg-[#6C5CE7]/30 flex items-center justify-center text-[10px]" style={{ color: '#6C5CE7', fontFamily: fontStack }}>
                  {data.username[0]?.toUpperCase()}
                </div>
              )}
              <span className="text-xs" style={{ color: style.usernameColor, fontFamily: fontStack }}>@{data.username}</span>
            </div>
          )}
          {showBranding && (
            <span className="text-[10px]" style={{ color: style.brandingColor, fontFamily: fontStack }}>haia.app</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Terminal Layout (Axiom/Terminal style) ───────────

function TerminalLayout({
  metric, data, theme, customBgUrl, aspectRatio, showUsername, showChart, showWinLoss, showBranding, styling,
}: CardPreviewProps) {
  const style = styling ?? DEFAULT_STYLING;
  const fontStack = getFontStack(style.fontFamily);
  const heroFontStack = getFontStack(style.heroFontFamily ?? style.fontFamily);
  const valueFontStack = getFontStack(style.valueFontFamily ?? style.fontFamily);
  const bgCss = getThemeCss(theme, customBgUrl);
  const { heroNumber, heroColor, stats } = useCardData(metric, data, style.heroColor);
  const c = useLandscapeCompact(aspectRatio);

  // Terminal style: left-aligned, compact rows, subtle grid lines
  return (
    <div
      id="flex-card-preview"
      className={cn('relative overflow-hidden rounded-[var(--radius-lg)] w-full', aspectStyles[aspectRatio])}
      style={{ background: bgCss }}
    >
      <div className={cn('absolute inset-0 flex flex-col justify-between', c.padTerminal)} style={{ fontFamily: fontStack }}>
        {/* Terminal header bar */}
        <div className="flex items-center justify-between pb-2 mb-2" style={{ borderBottom: '1px solid rgba(42,45,58,0.8)' }}>
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              <div className="w-2.5 h-2.5 rounded-full bg-[#FF4D6A]/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#FFB347]/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#00DC82]/60" />
            </div>
            <span className="text-[10px] uppercase tracking-[0.15em]" style={{ color: style.brandingColor }}>haia terminal</span>
          </div>
          <span className="text-[10px]" style={{ color: style.brandingColor }}>{data.period}</span>
        </div>

        {metric !== 'calendar' ? (
          <>
            {/* Metric label */}
            <div className="mb-0.5">
              <span className="text-[10px] uppercase tracking-[0.12em]" style={{ color: style.labelColor }}>
                {metricLabels[metric]}
              </span>
            </div>

            {/* Hero number — large, left-aligned */}
            <div className={c.mb}>
              <span className={cn(c.terminalHero, 'font-bold tracking-tight')} style={{ color: heroColor, fontFamily: heroFontStack }}>
                {heroNumber}
              </span>
            </div>

            {showChart && data.equityCurve && data.equityCurve.length > 1 && (
              <div className={cn(c.mb, 'opacity-80')}>
                <Sparkline points={data.equityCurve} color={heroColor} width={c.sparkW} height={c.sparkHSm} />
              </div>
            )}

            {/* Stats grid — terminal rows */}
            {showWinLoss && (
              <div className="flex-1">
                <div className="space-y-0">
                  {stats.map((s, i) => (
                    <div
                      key={s.label}
                      className="flex items-center justify-between py-1"
                      style={{ borderBottom: i < stats.length - 1 ? '1px solid rgba(30,33,48,0.6)' : 'none' }}
                    >
                      <span className={cn(c.statLabel, 'uppercase tracking-wider')} style={{ color: style.labelColor }}>{s.label}</span>
                      <span className={cn(c.statLabel, 'font-semibold')} style={{ color: style.valueColor, fontFamily: valueFontStack }}>{s.value}</span>
                    </div>
                  ))}
                </div>

                {/* Win/Loss bar */}
                {(data.winningTrades || data.losingTrades) ? (
                  <div className="mt-2">
                    <div className="flex justify-between text-[10px] mb-1">
                      <span style={{ color: '#00DC82' }}>{data.winningTrades || 0}W</span>
                      <span style={{ color: '#FF4D6A' }}>{data.losingTrades || 0}L</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden flex" style={{ background: 'rgba(30,33,48,0.8)' }}>
                      <div className="h-full" style={{
                        width: `${((data.winningTrades || 0) / ((data.winningTrades || 0) + (data.losingTrades || 0) || 1)) * 100}%`,
                        background: '#00DC82'
                      }} />
                      <div className="h-full flex-1" style={{ background: '#FF4D6A' }} />
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </>
        ) : (
          <MiniCalendar days={data.calendarDays || []} year={data.calendarYear || new Date().getFullYear()} month={data.calendarMonth || new Date().getMonth() + 1} totalPnl={data.totalPnl || 0} winDays={data.winDays || 0} lossDays={data.lossDays || 0} fontStack={fontStack} labelColor={style.labelColor} valueColor={style.valueColor} />
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
                <span className="text-[11px]" style={{ color: style.usernameColor }}>@{data.username}</span>
              </div>
            ) : <div />}
            {showBranding && (
              <span className="text-[9px] uppercase tracking-[0.15em]" style={{ color: style.brandingColor }}>haia.app</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Hero Layout (big hero number, horizontal stats, Axiom-inspired) ───

function HeroLayout({
  metric, data, theme, customBgUrl, aspectRatio, showUsername, showChart, showWinLoss, showBranding, styling, visibleStats, showHeroBox,
}: CardPreviewProps) {
  const style = styling ?? DEFAULT_STYLING;
  const fontStack = getFontStack(style.fontFamily);
  const heroFontStack = getFontStack(style.heroFontFamily ?? style.fontFamily);
  const valueFontStack = getFontStack(style.valueFontFamily ?? style.fontFamily);
  const bgCss = getThemeCss(theme, customBgUrl);
  const { heroNumber, heroColor, stats } = useCardData(metric, data, style.heroColor);
  const c = useLandscapeCompact(aspectRatio);

  const vis = visibleStats ?? [true, true, true];
  const filteredStats = stats.filter((_, i) => vis[i]);

  return (
    <div
      id="flex-card-preview"
      className={cn('relative overflow-hidden rounded-[var(--radius-xl)] w-full', aspectStyles[aspectRatio])}
      style={{ background: bgCss, fontFamily: fontStack }}
    >
      {/* subtle dark gradient overlay for text legibility */}
      <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.25) 50%, rgba(0,0,0,0.15) 100%)' }} />

      <div className={cn('absolute inset-0 flex flex-col justify-between', c.pad)}>
        {/* Header: logo + HAIA × username  (left)   |   CTA (right) */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-[#6C5CE7] rounded-md flex items-center justify-center">
              <span className="text-white font-bold text-[10px]" style={{ fontFamily: fontStack }}>H</span>
            </div>
            <span className="text-sm font-bold tracking-[0.2em] uppercase" style={{ color: style.valueColor }}>
              HAIA
            </span>
            {showUsername && data.username && (
              <>
                <span className="text-sm font-light" style={{ color: style.labelColor }}>×</span>
                <span className="text-sm font-medium" style={{ color: style.usernameColor }}>
                  {data.username}
                </span>
              </>
            )}
          </div>

          {(data.ctaTopLine || data.ctaBottomLine) && (
            <div className="text-right">
              {data.ctaTopLine && (
                <p className="text-[10px] leading-tight" style={{ color: style.labelColor }}>
                  {data.ctaTopLine}
                </p>
              )}
              {data.ctaBottomLine && (
                <p className="text-[10px] font-semibold leading-tight" style={{ color: style.usernameColor }}>
                  {data.ctaBottomLine}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Hero: period label + big number, left-aligned, vertically centered */}
        <div className="flex-1 flex flex-col justify-center">
          {metric !== 'calendar' ? (
            <>
              <p className={cn('font-medium', c.mb)} style={{ color: style.labelColor }}>
                {data.period}
              </p>
              {showHeroBox ? (
                <div className="inline-block self-start px-3 py-1.5 rounded-md" style={{ backgroundColor: style.heroBoxColor || heroColor }}>
                  <p className={cn(c.heroSizeLg, 'font-bold leading-none tracking-tight')} style={{ color: style.heroBoxTextColor, fontFamily: heroFontStack }}>
                    {heroNumber}
                  </p>
                </div>
              ) : (
                <p className={cn(c.heroSizeLg, 'font-bold leading-none tracking-tight')} style={{ color: heroColor, fontFamily: heroFontStack }}>
                  {heroNumber}
                </p>
              )}

              {showChart && data.equityCurve && data.equityCurve.length > 1 && (
                <div className={cn(c.mt, '-ml-1 opacity-80')}>
                  <Sparkline points={data.equityCurve} color={heroColor} width={c.sparkW} height={c.sparkH} />
                </div>
              )}
            </>
          ) : (
            <MiniCalendar days={data.calendarDays || []} year={data.calendarYear || new Date().getFullYear()} month={data.calendarMonth || new Date().getMonth() + 1} totalPnl={data.totalPnl || 0} winDays={data.winDays || 0} lossDays={data.lossDays || 0} fontStack={fontStack} labelColor={style.labelColor} valueColor={style.valueColor} />
          )}
        </div>

        {/* Stats row: horizontal, left-aligned, individually toggleable */}
        {showWinLoss && metric !== 'calendar' && filteredStats.length > 0 && (
          <div className={cn('flex', c.statGap)}>
            {filteredStats.map((s) => (
              <div key={s.label} className="flex flex-col">
                <span className={cn(c.statLabel, 'font-normal mb-0.5')} style={{ color: style.labelColor }}>
                  {s.label}
                </span>
                <span className={cn(c.statValue, 'font-bold')} style={{ color: style.valueColor, fontFamily: valueFontStack }}>
                  {s.value}
                </span>
              </div>
            ))}
            {showBranding && (
              <div className="ml-auto flex items-end">
                <span className="text-[10px] tracking-[0.15em] uppercase" style={{ color: style.brandingColor }}>
                  haia.app
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Axiom Layout (vertical stats list, hero box, bottom username) ──

function AxiomLayout({
  metric, data, theme, customBgUrl, aspectRatio, showUsername, showChart, showWinLoss, showBranding, styling, visibleStats, showHeroBox,
}: CardPreviewProps) {
  const style = styling ?? DEFAULT_STYLING;
  const fontStack = getFontStack(style.fontFamily);
  const heroFontStack = getFontStack(style.heroFontFamily ?? style.fontFamily);
  const valueFontStack = getFontStack(style.valueFontFamily ?? style.fontFamily);
  const bgCss = getThemeCss(theme, customBgUrl);
  const { heroNumber, heroColor, stats } = useCardData(metric, data, style.heroColor);
  const c = useLandscapeCompact(aspectRatio);

  const vis = visibleStats ?? [true, true, true];
  const filteredStats = stats.filter((_, i) => vis[i]);

  return (
    <div
      id="flex-card-preview"
      className={cn('relative overflow-hidden rounded-[var(--radius-xl)] w-full', aspectStyles[aspectRatio])}
      style={{ background: bgCss, fontFamily: fontStack }}
    >
      {/* dark overlay for legibility */}
      <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.3) 40%, rgba(0,0,0,0.1) 100%)' }} />

      <div className={cn('absolute inset-0 flex flex-col justify-between', c.pad)}>
        {/* Header: Haia logo (left) + HAIA Pro (right) */}
        <div className="flex items-start justify-between">
          <div className="w-7 h-7">
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M16 4L4 12v8l12 8 12-8v-8L16 4z" fill="white" fillOpacity="0.9" />
              <path d="M16 8L8 13v6l8 5 8-5v-6l-8-5z" fill="#0B0C10" />
            </svg>
          </div>
          <div className="text-right">
            <span className="text-sm font-bold tracking-wide" style={{ color: style.valueColor }}>HAIA</span>
            <span className="text-sm font-light ml-0.5" style={{ color: style.labelColor }}>Pro</span>
          </div>
        </div>

        {/* Middle: period label + hero number (with optional box) */}
        <div className="flex-1 flex flex-col justify-center">
          {metric !== 'calendar' ? (
            <>
              <p className={cn('font-semibold', c.mb)} style={{ color: style.valueColor }}>
                {data.period}
              </p>

              {showHeroBox ? (
                <div className={cn('inline-block self-start px-3 py-1.5 rounded-md', c.mb)} style={{ backgroundColor: style.heroBoxColor || heroColor }}>
                  <p className={cn(c.heroSizeLg, 'font-bold leading-none tracking-tight')} style={{ color: style.heroBoxTextColor, fontFamily: heroFontStack }}>
                    {heroNumber}
                  </p>
                </div>
              ) : (
                <p className={cn(c.heroSizeLg, 'font-bold leading-none tracking-tight', c.mb)} style={{ color: heroColor, fontFamily: heroFontStack }}>
                  {heroNumber}
                </p>
              )}

              {/* Vertical stats list — label left, value right */}
              {showWinLoss && filteredStats.length > 0 && (
                <div className="space-y-1">
                  {filteredStats.map((s) => (
                    <div key={s.label} className="flex items-center gap-6">
                      <span className={cn(c.statLabel, 'font-medium w-24')} style={{ color: style.labelColor }}>
                        {s.label}
                      </span>
                      <span className={cn(c.statLabel, 'font-bold')} style={{ color: style.valueColor, fontFamily: valueFontStack }}>
                        {s.value}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {showChart && data.equityCurve && data.equityCurve.length > 1 && (
                <div className="mt-3 opacity-80">
                  <Sparkline points={data.equityCurve} color={heroColor} width={240} height={36} />
                </div>
              )}
            </>
          ) : (
            <MiniCalendar days={data.calendarDays || []} year={data.calendarYear || new Date().getFullYear()} month={data.calendarMonth || new Date().getMonth() + 1} totalPnl={data.totalPnl || 0} winDays={data.winDays || 0} lossDays={data.lossDays || 0} fontStack={fontStack} labelColor={style.labelColor} valueColor={style.valueColor} />
          )}
        </div>

        {/* Footer: avatar + username (left), branding + CTA (right) */}
        <div className="flex items-end justify-between">
          <div>
            {showUsername && data.username && (
              <div className="flex items-center gap-2">
                {data.avatarUrl ? (
                  <img src={data.avatarUrl} className="w-8 h-8 rounded-lg" alt="" />
                ) : (
                  <div className="w-8 h-8 rounded-lg bg-[#6C5CE7] flex items-center justify-center text-sm font-bold" style={{ color: 'white' }}>
                    {data.username[0]?.toUpperCase()}
                  </div>
                )}
                <span className="text-base font-semibold" style={{ color: style.usernameColor }}>
                  @{data.username}
                </span>
              </div>
            )}
          </div>

          <div className="text-right">
            {showBranding && (
              <p className="text-xs" style={{ color: style.brandingColor }}>haia.app</p>
            )}
            {data.ctaTopLine && (
              <p className="text-[10px]" style={{ color: style.labelColor }}>{data.ctaTopLine}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Mini Calendar ───────────────────────────────────

function MiniCalendar({
  days, year, month, totalPnl, winDays, lossDays, fontStack, labelColor, valueColor,
}: {
  days: CalendarDay[];
  year: number;
  month: number;
  totalPnl: number;
  winDays: number;
  lossDays: number;
  fontStack: string;
  labelColor: string;
  valueColor: string;
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
    <div className="w-full max-w-[300px]" style={{ fontFamily: fontStack }}>
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm font-medium" style={{ color: valueColor }}>{format(monthDate, 'MMM yyyy')}</span>
        <span className="text-sm font-bold" style={{ color: pnlColor }}>
          {totalPnl >= 0 ? '+' : ''}{formatCurrency(totalPnl)}
        </span>
      </div>
      <div className="grid grid-cols-7 gap-0.5 mb-2">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <div key={i} className="text-center text-[8px]" style={{ color: labelColor }}>{d}</div>
        ))}
        {allDays.map((day) => {
          const key = format(day, 'yyyy-MM-dd');
          const inMonth = isSameMonth(day, monthDate);
          if (!inMonth) return <div key={key} className="aspect-square" />;
          const dd = dayMap.get(key);
          const pnl = dd?.pnl || 0;
          const bg = pnl > 0 ? 'rgba(0,220,130,0.2)' : pnl < 0 ? 'rgba(255,77,106,0.2)' : 'rgba(90,92,102,0.1)';
          const color = pnl > 0 ? '#00DC82' : pnl < 0 ? '#FF4D6A' : labelColor;
          return (
            <div key={key} className="aspect-square rounded-[2px] flex items-center justify-center" style={{ backgroundColor: bg }}>
              <span className="text-[7px]" style={{ color, fontFamily: fontStack }}>
                {pnl === 0 ? '' : pnl > 0 ? `+${Math.round(pnl)}` : Math.round(pnl)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px]">
        <span style={{ color: '#00DC82' }}>Win Days: {winDays}</span>
        <span style={{ color: '#FF4D6A' }}>Loss Days: {lossDays}</span>
      </div>
    </div>
  );
}
