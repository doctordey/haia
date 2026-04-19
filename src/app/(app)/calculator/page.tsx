'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn, formatCurrency, formatNumber } from '@/lib/utils';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';

type CalcTab = 'compound' | 'performance-fee';
type CompoundFreq = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'semi-annually' | 'annually';
type ContribFreq = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annually';
type DurationUnit = 'days' | 'weeks' | 'months' | 'years';
type RateUnit = 'daily' | 'weekly' | 'monthly' | 'annually';
type BreakdownView = 'table' | 'chart';
type RowGranularity = 'daily' | 'weekly' | 'monthly' | 'yearly';

const freqPerYear: Record<CompoundFreq, number> = {
  daily: 365, weekly: 52, monthly: 12, quarterly: 4, 'semi-annually': 2, annually: 1,
};
const contribPerYear: Record<ContribFreq, number> = {
  daily: 365, weekly: 52, monthly: 12, quarterly: 4, annually: 1,
};

function toAnnualRate(rate: number, unit: RateUnit, skipWeekends = false): number {
  switch (unit) {
    case 'daily': return rate * (skipWeekends ? 252 : 365);
    case 'weekly': return rate * 52;
    case 'monthly': return rate * 12;
    case 'annually': return rate;
  }
}

function toDurationDays(duration: number, unit: DurationUnit): number {
  switch (unit) {
    case 'days': return duration;
    case 'weeks': return duration * 7;
    case 'months': return duration * 30.44;
    case 'years': return duration * 365;
  }
}

function autoGranularity(unit: DurationUnit, duration: number): RowGranularity {
  switch (unit) {
    case 'days': return 'daily';
    case 'weeks': return 'weekly';
    case 'months': return duration <= 36 ? 'monthly' : 'yearly';
    case 'years': return duration <= 3 ? 'monthly' : 'yearly';
  }
}

interface PeriodRow {
  period: number;
  label: string;
  startBalance: number;
  deposits: number;
  interest: number;
  cumulativeInterest: number;
  endBalance: number;
}

function computeCompound(
  principal: number, annualRate: number, durationDays: number,
  compoundFreq: CompoundFreq, contribAmount: number, contribFreq: ContribFreq,
  skipWeekends: boolean, granularity: RowGranularity,
): { finalBalance: number; totalInterest: number; totalContributions: number; rows: PeriodRow[] } {
  // Effective periods per year — daily compounding with weekend skip uses 252 trading days
  const periodsPerYear = (compoundFreq === 'daily' && skipWeekends) ? 252 : freqPerYear[compoundFreq];
  const ratePerPeriod = annualRate / 100 / periodsPerYear;

  const contribN = (contribFreq === 'daily' && skipWeekends) ? 252 : contribPerYear[contribFreq];
  const contribInterval = Math.max(1, Math.round(periodsPerYear / contribN));

  // Total compounding periods over the duration
  const totalPeriods = (compoundFreq === 'daily' && skipWeekends)
    ? Math.max(1, Math.round(durationDays * 5 / 7))
    : Math.max(1, Math.round((durationDays / 365) * freqPerYear[compoundFreq]));

  // How many compounding periods make up one row of the requested granularity
  // (clamped to at least 1; can't show finer rows than the compounding frequency)
  const granularityPeriodsPerYear =
    granularity === 'daily' ? (skipWeekends ? 252 : 365)
    : granularity === 'weekly' ? 52
    : granularity === 'monthly' ? 12
    : 1;
  const periodsPerRow = Math.max(1, Math.round(periodsPerYear / granularityPeriodsPerYear));

  const labelPrefix =
    granularity === 'daily' ? 'Day'
    : granularity === 'weekly' ? 'Week'
    : granularity === 'monthly' ? 'Month'
    : 'Year';

  let balance = principal;
  let totalInterest = 0;
  let totalContributions = 0;
  let rowInterest = 0;
  let rowDeposits = 0;
  let rowStartBalance = principal;
  let cumInterest = 0;
  let rowIndex = 0;

  const rows: PeriodRow[] = [];

  for (let i = 1; i <= totalPeriods; i++) {
    const interest = balance * ratePerPeriod;
    balance += interest;
    totalInterest += interest;
    rowInterest += interest;

    if (contribAmount > 0 && i % contribInterval === 0) {
      balance += contribAmount;
      totalContributions += contribAmount;
      rowDeposits += contribAmount;
    }

    if (i % periodsPerRow === 0 || i === totalPeriods) {
      rowIndex += 1;
      cumInterest += rowInterest;
      rows.push({
        period: rowIndex,
        label: `${labelPrefix} ${rowIndex}`,
        startBalance: rowStartBalance,
        deposits: rowDeposits,
        interest: rowInterest,
        cumulativeInterest: cumInterest,
        endBalance: balance,
      });
      rowStartBalance = balance;
      rowInterest = 0;
      rowDeposits = 0;
    }
  }

  return { finalBalance: balance, totalInterest, totalContributions, rows };
}

interface FeePeriodRow {
  period: number;
  label: string;
  balance: number;
  profit: number;
  fee: number;
  net: number;
}

function computePerformanceFee(
  startBalance: number, annualRate: number, durationDays: number,
  feePercent: number, compoundFreq: CompoundFreq,
  skipWeekends: boolean, granularity: RowGranularity,
): { grossProfit: number; feeAmount: number; netProfit: number; finalBalance: number; rows: FeePeriodRow[] } {
  const periodsPerYear = (compoundFreq === 'daily' && skipWeekends) ? 252 : freqPerYear[compoundFreq];
  const ratePerPeriod = annualRate / 100 / periodsPerYear;
  const feeRate = feePercent / 100;

  const totalPeriods = (compoundFreq === 'daily' && skipWeekends)
    ? Math.max(1, Math.round(durationDays * 5 / 7))
    : Math.max(1, Math.round((durationDays / 365) * freqPerYear[compoundFreq]));

  // Periods per row at requested granularity (fee charged at end of each row)
  const granularityPeriodsPerYear =
    granularity === 'daily' ? (skipWeekends ? 252 : 365)
    : granularity === 'weekly' ? 52
    : granularity === 'monthly' ? 12
    : 1;
  const periodsPerRow = Math.max(1, Math.round(periodsPerYear / granularityPeriodsPerYear));

  const labelPrefix =
    granularity === 'daily' ? 'Day'
    : granularity === 'weekly' ? 'Week'
    : granularity === 'monthly' ? 'Month'
    : 'Year';

  let balance = startBalance;
  let grossProfit = 0;
  let totalFees = 0;
  let rowStart = startBalance;
  let rowIndex = 0;
  const rows: FeePeriodRow[] = [];

  for (let i = 1; i <= totalPeriods; i++) {
    balance += balance * ratePerPeriod;

    if (i % periodsPerRow === 0 || i === totalPeriods) {
      rowIndex += 1;
      const rowProfit = balance - rowStart;
      const rowFee = rowProfit > 0 ? rowProfit * feeRate : 0;
      balance -= rowFee;
      grossProfit += rowProfit;
      totalFees += rowFee;
      rows.push({
        period: rowIndex,
        label: `${labelPrefix} ${rowIndex}`,
        balance,
        profit: rowProfit,
        fee: rowFee,
        net: rowProfit - rowFee,
      });
      rowStart = balance;
    }
  }

  return {
    grossProfit,
    feeAmount: totalFees,
    netProfit: grossProfit - totalFees,
    finalBalance: balance,
    rows,
  };
}

interface TooltipRow { label: string; value: number; color: string; }

function CustomTooltip({ active, label, rows }: { active?: boolean; label?: string; rows: TooltipRow[] }) {
  if (!active || !rows.length) return null;
  return (
    <div className="bg-bg-secondary border border-border-primary rounded-md px-3 py-2 text-xs" style={{ minWidth: 140 }}>
      <p className="text-text-tertiary mb-1">{label}</p>
      {rows.map((r) => (
        <div key={r.label} className="flex justify-between gap-3">
          <span style={{ color: r.color }}>{r.label}</span>
          <span className="font-mono" style={{ color: r.color }}>{formatCurrency(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function CalculatorPage() {
  const [tab, setTab] = useState<CalcTab>('compound');

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-semibold">Performance Calculator</h1>

      <div className="flex gap-2">
        {([
          { id: 'compound' as CalcTab, label: 'Compound Interest' },
          { id: 'performance-fee' as CalcTab, label: 'Performance Fees' },
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-4 py-2 text-sm rounded-[var(--radius-md)] transition-colors cursor-pointer',
              tab === t.id ? 'bg-accent-primary text-white' : 'bg-bg-secondary text-text-secondary hover:text-text-primary border border-border-primary'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'compound' ? <CompoundCalculator /> : <PerformanceFeeCalculator />}
    </div>
  );
}

// ─── Compound Interest Calculator ─────────────────────

function CompoundCalculator() {
  const [principal, setPrincipal] = useState(10000);
  const [rate, setRate] = useState(5);
  const [rateUnit, setRateUnit] = useState<RateUnit>('annually');
  const [duration, setDuration] = useState(5);
  const [durationUnit, setDurationUnit] = useState<DurationUnit>('years');
  const [compoundFreq, setCompoundFreq] = useState<CompoundFreq>('monthly');
  const [contribAmount, setContribAmount] = useState(0);
  const [contribFreq, setContribFreq] = useState<ContribFreq>('monthly');
  const [skipWeekends, setSkipWeekends] = useState(false);
  const [view, setView] = useState<BreakdownView>('chart');

  const annualRate = toAnnualRate(rate, rateUnit, skipWeekends);
  const durationDays = toDurationDays(duration, durationUnit);
  const granularity = autoGranularity(durationUnit, duration);

  const result = useMemo(
    () => computeCompound(principal, annualRate, durationDays, compoundFreq, contribAmount, contribFreq, skipWeekends, granularity),
    [principal, annualRate, durationDays, compoundFreq, contribAmount, contribFreq, skipWeekends, granularity],
  );

  const chartData = useMemo(() => {
    const today = new Date();
    return result.rows.map((r) => {
      const d = new Date(today);
      if (granularity === 'daily') d.setDate(d.getDate() + r.period);
      else if (granularity === 'weekly') d.setDate(d.getDate() + r.period * 7);
      else if (granularity === 'monthly') d.setMonth(d.getMonth() + r.period);
      else d.setFullYear(d.getFullYear() + r.period);
      const label = granularity === 'yearly'
        ? d.getFullYear().toString()
        : `${d.getMonth() + 1}/${d.getDate()}`;
      return {
        name: label,
        balance: Math.round(r.endBalance * 100) / 100,
        interest: Math.round(r.cumulativeInterest * 100) / 100,
        periodInterest: Math.round(r.interest * 100) / 100,
      };
    });
  }, [result.rows, granularity]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4">
      {/* Inputs */}
      <div className="space-y-3">
        <Card>
          <CardHeader><h3 className="text-xs font-medium text-text-secondary uppercase tracking-wide">Inputs</h3></CardHeader>
          <CardContent className="pt-0 space-y-3">
            <div>
              <label className="text-xs text-text-secondary mb-1 block">Initial Investment</label>
              <Input type="number" value={principal} onChange={(e) => setPrincipal(parseFloat(e.target.value) || 0)} className="h-9 text-sm font-mono" />
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <div>
                <label className="text-xs text-text-secondary mb-1 block">Return Rate (%)</label>
                <Input type="number" value={rate} step={0.1} onChange={(e) => setRate(parseFloat(e.target.value) || 0)} className="h-9 text-sm font-mono" />
              </div>
              <div>
                <label className="text-xs text-text-secondary mb-1 block">Per</label>
                <select value={rateUnit} onChange={(e) => setRateUnit(e.target.value as RateUnit)}
                  className="w-full h-9 px-2 bg-bg-tertiary border border-border-primary rounded-[var(--radius-sm)] text-sm text-text-primary">
                  <option value="daily">Day</option>
                  <option value="weekly">Week</option>
                  <option value="monthly">Month</option>
                  <option value="annually">Year</option>
                </select>
              </div>
            </div>
            {rateUnit !== 'annually' && (
              <p className="text-[10px] text-text-tertiary">= {formatNumber(annualRate, 2)}% annualized</p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-text-secondary mb-1 block">Duration</label>
                <Input type="number" value={duration} onChange={(e) => setDuration(parseFloat(e.target.value) || 1)} className="h-9 text-sm font-mono" />
              </div>
              <div>
                <label className="text-xs text-text-secondary mb-1 block">Unit</label>
                <select value={durationUnit} onChange={(e) => setDurationUnit(e.target.value as DurationUnit)}
                  className="w-full h-9 px-2 bg-bg-tertiary border border-border-primary rounded-[var(--radius-sm)] text-sm text-text-primary">
                  <option value="days">Days</option>
                  <option value="weeks">Weeks</option>
                  <option value="months">Months</option>
                  <option value="years">Years</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-text-secondary mb-1 block">Compounding Frequency</label>
              <select value={compoundFreq} onChange={(e) => setCompoundFreq(e.target.value as CompoundFreq)}
                className="w-full h-9 px-2 bg-bg-tertiary border border-border-primary rounded-[var(--radius-sm)] text-sm text-text-primary">
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="semi-annually">Semi-Annually</option>
                <option value="annually">Annually</option>
              </select>
            </div>
            <label className="flex items-center justify-between cursor-pointer pt-1">
              <span className="text-xs text-text-secondary">Skip Weekends (252 trading days/year)</span>
              <button
                role="switch"
                aria-checked={skipWeekends}
                onClick={() => setSkipWeekends(!skipWeekends)}
                className={cn(
                  'w-9 h-5 rounded-full transition-colors relative cursor-pointer',
                  skipWeekends ? 'bg-accent-primary' : 'bg-bg-tertiary'
                )}
              >
                <div className={cn(
                  'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform',
                  skipWeekends ? 'translate-x-4' : 'translate-x-0.5'
                )} />
              </button>
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><h3 className="text-xs font-medium text-text-secondary uppercase tracking-wide">Additional Contributions</h3></CardHeader>
          <CardContent className="pt-0 space-y-3">
            <div>
              <label className="text-xs text-text-secondary mb-1 block">Contribution Amount</label>
              <Input type="number" value={contribAmount} onChange={(e) => setContribAmount(parseFloat(e.target.value) || 0)} className="h-9 text-sm font-mono" />
            </div>
            <div>
              <label className="text-xs text-text-secondary mb-1 block">Contribution Frequency</label>
              <select value={contribFreq} onChange={(e) => setContribFreq(e.target.value as ContribFreq)}
                className="w-full h-9 px-2 bg-bg-tertiary border border-border-primary rounded-[var(--radius-sm)] text-sm text-text-primary">
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annually">Annually</option>
              </select>
            </div>
            <p className="text-[10px] text-text-tertiary">Set to 0 to calculate without additional contributions.</p>
          </CardContent>
        </Card>
      </div>

      {/* Results */}
      <div className="space-y-3">
        {/* Summary */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card>
            <CardContent className="py-3">
              <p className="text-[10px] text-text-tertiary uppercase tracking-wide mb-1">Final Balance</p>
              <p className="text-lg font-bold text-profit-primary font-mono">{formatCurrency(result.finalBalance)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3">
              <p className="text-[10px] text-text-tertiary uppercase tracking-wide mb-1">Total Interest</p>
              <p className="text-lg font-bold text-text-primary font-mono">{formatCurrency(result.totalInterest)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3">
              <p className="text-[10px] text-text-tertiary uppercase tracking-wide mb-1">Total Contributions</p>
              <p className="text-lg font-bold text-text-primary font-mono">{formatCurrency(result.totalContributions)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3">
              <p className="text-[10px] text-text-tertiary uppercase tracking-wide mb-1">Total Return</p>
              <p className="text-lg font-bold text-text-primary font-mono">
                {principal > 0 ? `${formatNumber(((result.finalBalance - principal - result.totalContributions) / principal) * 100)}%` : '0%'}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Chart / Table Toggle */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Growth Breakdown</h3>
              <div className="flex gap-1">
                {(['chart', 'table'] as const).map((v) => (
                  <button key={v} onClick={() => setView(v)}
                    className={cn(
                      'px-3 py-1 text-xs rounded-[var(--radius-sm)] transition-colors cursor-pointer capitalize',
                      view === v ? 'bg-accent-primary text-white' : 'bg-bg-tertiary text-text-secondary'
                    )}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {view === 'chart' ? (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="name" tick={{ fill: '#5A5C66', fontSize: 10 }} interval={0} angle={chartData.length > 14 ? -45 : 0} textAnchor={chartData.length > 14 ? 'end' : 'middle'} height={chartData.length > 14 ? 50 : 30} />
                    <YAxis tick={{ fill: '#5A5C66', fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      content={(props) => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const p = props as any;
                        if (!p.active || !p.payload?.length) return null;
                        const d = p.payload[0].payload;
                        return (
                          <CustomTooltip
                            active
                            label={p.label}
                            rows={[
                              { label: 'Balance', value: d.balance, color: '#00DC82' },
                              { label: 'Period Interest', value: d.periodInterest, color: '#E8E9ED' },
                              { label: 'Cumulative Interest', value: d.interest, color: '#6C5CE7' },
                            ]}
                          />
                        );
                      }}
                    />
                    <Area type="monotone" dataKey="balance" stroke="#00DC82" fill="#00DC82" fillOpacity={0.1} strokeWidth={2} name="Balance" />
                    <Area type="monotone" dataKey="interest" stroke="#6C5CE7" fill="#6C5CE7" fillOpacity={0.1} strokeWidth={1.5} name="Cumulative Interest" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="max-h-[400px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-bg-secondary">
                    <tr className="text-text-tertiary uppercase tracking-wide border-b border-border-primary">
                      <th className="text-left pb-2 font-medium">Period</th>
                      <th className="text-right pb-2 font-medium">Start Balance</th>
                      <th className="text-right pb-2 font-medium">Deposits</th>
                      <th className="text-right pb-2 font-medium">Interest</th>
                      <th className="text-right pb-2 font-medium">Cumulative Int.</th>
                      <th className="text-right pb-2 font-medium">End Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((r) => (
                      <tr key={r.period} className="border-b border-border-primary/30 hover:bg-bg-tertiary/30">
                        <td className="py-1.5">{r.label}</td>
                        <td className="py-1.5 text-right font-mono">{formatCurrency(r.startBalance)}</td>
                        <td className="py-1.5 text-right font-mono">{r.deposits > 0 ? formatCurrency(r.deposits) : '—'}</td>
                        <td className="py-1.5 text-right font-mono text-profit-primary">{formatCurrency(r.interest)}</td>
                        <td className="py-1.5 text-right font-mono">{formatCurrency(r.cumulativeInterest)}</td>
                        <td className="py-1.5 text-right font-mono font-medium">{formatCurrency(r.endBalance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Performance Fee Calculator ───────────────────────

function PerformanceFeeCalculator() {
  const [startBalance, setStartBalance] = useState(100000);
  const [returnRate, setReturnRate] = useState(5);
  const [rateUnit, setRateUnit] = useState<RateUnit>('annually');
  const [duration, setDuration] = useState(12);
  const [durationUnit, setDurationUnit] = useState<DurationUnit>('months');
  const [compoundFreq, setCompoundFreq] = useState<CompoundFreq>('monthly');
  const [feePercent, setFeePercent] = useState(20);
  const [skipWeekends, setSkipWeekends] = useState(false);
  const [view, setView] = useState<BreakdownView>('chart');

  const annualRate = toAnnualRate(returnRate, rateUnit, skipWeekends);
  const durationDays = toDurationDays(duration, durationUnit);
  const granularity = autoGranularity(durationUnit, duration);

  const result = useMemo(
    () => computePerformanceFee(startBalance, annualRate, durationDays, feePercent, compoundFreq, skipWeekends, granularity),
    [startBalance, annualRate, durationDays, feePercent, compoundFreq, skipWeekends, granularity],
  );

  const chartData = useMemo(() => {
    const today = new Date();
    let cumFee = 0;
    let cumNet = 0;
    return result.rows.map((r) => {
      cumFee += r.fee;
      cumNet += r.net;
      const d = new Date(today);
      if (granularity === 'daily') d.setDate(d.getDate() + r.period);
      else if (granularity === 'weekly') d.setDate(d.getDate() + r.period * 7);
      else if (granularity === 'monthly') d.setMonth(d.getMonth() + r.period);
      else d.setFullYear(d.getFullYear() + r.period);
      const label = granularity === 'yearly'
        ? d.getFullYear().toString()
        : `${d.getMonth() + 1}/${d.getDate()}`;
      return {
        name: label,
        balance: Math.round(r.balance * 100) / 100,
        cumulativeFees: Math.round(cumFee * 100) / 100,
        cumulativeNet: Math.round(cumNet * 100) / 100,
        periodProfit: Math.round(r.profit * 100) / 100,
        periodFee: Math.round(r.fee * 100) / 100,
        periodNet: Math.round(r.net * 100) / 100,
      };
    });
  }, [result.rows, granularity]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4">
      {/* Inputs */}
      <Card>
        <CardHeader><h3 className="text-xs font-medium text-text-secondary uppercase tracking-wide">Performance Fee Calculator</h3></CardHeader>
        <CardContent className="pt-0 space-y-3">
          <p className="text-xs text-text-tertiary">
            Calculate how much you&apos;d earn in performance fees on managed capital.
          </p>
          <div>
            <label className="text-xs text-text-secondary mb-1 block">Starting Capital</label>
            <Input type="number" value={startBalance} onChange={(e) => setStartBalance(parseFloat(e.target.value) || 0)} className="h-9 text-sm font-mono" />
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div>
              <label className="text-xs text-text-secondary mb-1 block">Return Rate (%)</label>
              <Input type="number" value={returnRate} step={0.1} onChange={(e) => setReturnRate(parseFloat(e.target.value) || 0)} className="h-9 text-sm font-mono" />
            </div>
            <div>
              <label className="text-xs text-text-secondary mb-1 block">Per</label>
              <select value={rateUnit} onChange={(e) => setRateUnit(e.target.value as RateUnit)}
                className="w-full h-9 px-2 bg-bg-tertiary border border-border-primary rounded-[var(--radius-sm)] text-sm text-text-primary">
                <option value="daily">Day</option>
                <option value="weekly">Week</option>
                <option value="monthly">Month</option>
                <option value="annually">Year</option>
              </select>
            </div>
          </div>
          {rateUnit !== 'annually' && (
            <p className="text-[10px] text-text-tertiary">= {formatNumber(annualRate, 2)}% annualized</p>
          )}
          <div>
            <label className="text-xs text-text-secondary mb-1 block">Performance Fee (%)</label>
            <Input type="number" value={feePercent} step={1} onChange={(e) => setFeePercent(parseFloat(e.target.value) || 0)} className="h-9 text-sm font-mono" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-text-secondary mb-1 block">Duration</label>
              <Input type="number" value={duration} onChange={(e) => setDuration(parseFloat(e.target.value) || 1)} className="h-9 text-sm font-mono" />
            </div>
            <div>
              <label className="text-xs text-text-secondary mb-1 block">Unit</label>
              <select value={durationUnit} onChange={(e) => setDurationUnit(e.target.value as DurationUnit)}
                className="w-full h-9 px-2 bg-bg-tertiary border border-border-primary rounded-[var(--radius-sm)] text-sm text-text-primary">
                <option value="days">Days</option>
                <option value="weeks">Weeks</option>
                <option value="months">Months</option>
                <option value="years">Years</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-text-secondary mb-1 block">Compounding Frequency</label>
            <select value={compoundFreq} onChange={(e) => setCompoundFreq(e.target.value as CompoundFreq)}
              className="w-full h-9 px-2 bg-bg-tertiary border border-border-primary rounded-[var(--radius-sm)] text-sm text-text-primary">
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="annually">Annually</option>
            </select>
          </div>
          <label className="flex items-center justify-between cursor-pointer pt-1">
            <span className="text-xs text-text-secondary">Skip Weekends (252 trading days/year)</span>
            <button
              role="switch"
              aria-checked={skipWeekends}
              onClick={() => setSkipWeekends(!skipWeekends)}
              className={cn(
                'w-9 h-5 rounded-full transition-colors relative cursor-pointer',
                skipWeekends ? 'bg-accent-primary' : 'bg-bg-tertiary'
              )}
            >
              <div className={cn(
                'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform',
                skipWeekends ? 'translate-x-4' : 'translate-x-0.5'
              )} />
            </button>
          </label>
          <p className="text-[10px] text-text-tertiary">
            Performance fee is deducted from positive returns only at the end of each row period.
          </p>
        </CardContent>
      </Card>

      {/* Results */}
      <div className="space-y-3">
        {/* Summary */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card>
            <CardContent className="py-3">
              <p className="text-[10px] text-text-tertiary uppercase tracking-wide mb-1">Gross Profit</p>
              <p className="text-lg font-bold text-profit-primary font-mono">{formatCurrency(result.grossProfit)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3">
              <p className="text-[10px] text-text-tertiary uppercase tracking-wide mb-1">Total Fees Earned</p>
              <p className="text-lg font-bold text-accent-primary font-mono">{formatCurrency(result.feeAmount)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3">
              <p className="text-[10px] text-text-tertiary uppercase tracking-wide mb-1">Net Profit (After Fees)</p>
              <p className="text-lg font-bold text-text-primary font-mono">{formatCurrency(result.netProfit)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3">
              <p className="text-[10px] text-text-tertiary uppercase tracking-wide mb-1">Final Balance</p>
              <p className="text-lg font-bold text-text-primary font-mono">{formatCurrency(result.finalBalance)}</p>
            </CardContent>
          </Card>
        </div>

        {/* Chart / Table */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Breakdown</h3>
              <div className="flex gap-1">
                {(['chart', 'table'] as const).map((v) => (
                  <button key={v} onClick={() => setView(v)}
                    className={cn(
                      'px-3 py-1 text-xs rounded-[var(--radius-sm)] transition-colors cursor-pointer capitalize',
                      view === v ? 'bg-accent-primary text-white' : 'bg-bg-tertiary text-text-secondary'
                    )}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {view === 'chart' ? (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="name" tick={{ fill: '#5A5C66', fontSize: 10 }} interval={0} angle={chartData.length > 14 ? -45 : 0} textAnchor={chartData.length > 14 ? 'end' : 'middle'} height={chartData.length > 14 ? 50 : 30} />
                    <YAxis tick={{ fill: '#5A5C66', fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      content={(props) => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const p = props as any;
                        if (!p.active || !p.payload?.length) return null;
                        const d = p.payload[0].payload;
                        return (
                          <CustomTooltip
                            active
                            label={p.label}
                            rows={[
                              { label: 'Balance', value: d.balance, color: '#00DC82' },
                              { label: 'Period Profit', value: d.periodProfit, color: '#E8E9ED' },
                              { label: 'Period Fee', value: d.periodFee, color: '#FFB347' },
                              { label: 'Period Net', value: d.periodNet, color: '#E8E9ED' },
                              { label: 'Cumulative Fees', value: d.cumulativeFees, color: '#6C5CE7' },
                            ]}
                          />
                        );
                      }}
                    />
                    <Area type="monotone" dataKey="balance" stroke="#00DC82" fill="#00DC82" fillOpacity={0.1} strokeWidth={2} name="Account Balance" />
                    <Area type="monotone" dataKey="cumulativeFees" stroke="#6C5CE7" fill="#6C5CE7" fillOpacity={0.15} strokeWidth={2} name="Cumulative Fees" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="max-h-[400px] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-bg-secondary">
                    <tr className="text-text-tertiary uppercase tracking-wide border-b border-border-primary">
                      <th className="text-left pb-2 font-medium">Period</th>
                      <th className="text-right pb-2 font-medium">Balance</th>
                      <th className="text-right pb-2 font-medium">Profit</th>
                      <th className="text-right pb-2 font-medium">Fee ({feePercent}%)</th>
                      <th className="text-right pb-2 font-medium">Net Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((r) => (
                      <tr key={r.period} className="border-b border-border-primary/30 hover:bg-bg-tertiary/30">
                        <td className="py-1.5">{r.label}</td>
                        <td className="py-1.5 text-right font-mono">{formatCurrency(r.balance)}</td>
                        <td className="py-1.5 text-right font-mono text-profit-primary">{formatCurrency(r.profit)}</td>
                        <td className="py-1.5 text-right font-mono text-accent-primary">{formatCurrency(r.fee)}</td>
                        <td className="py-1.5 text-right font-mono">{formatCurrency(r.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
