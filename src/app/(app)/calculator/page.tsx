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

const freqPerYear: Record<CompoundFreq, number> = {
  daily: 365, weekly: 52, monthly: 12, quarterly: 4, 'semi-annually': 2, annually: 1,
};
const contribPerYear: Record<ContribFreq, number> = {
  daily: 365, weekly: 52, monthly: 12, quarterly: 4, annually: 1,
};

function toAnnualRate(rate: number, unit: RateUnit): number {
  switch (unit) {
    case 'daily': return rate * 365;
    case 'weekly': return rate * 52;
    case 'monthly': return rate * 12;
    case 'annually': return rate;
  }
}

function toDurationMonths(duration: number, unit: DurationUnit): number {
  switch (unit) {
    case 'days': return duration / 30.44;
    case 'weeks': return duration / 4.345;
    case 'months': return duration;
    case 'years': return duration * 12;
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
  principal: number, rate: number, durationMonths: number,
  compoundFreq: CompoundFreq, contribAmount: number, contribFreq: ContribFreq,
): { finalBalance: number; totalInterest: number; totalContributions: number; rows: PeriodRow[] } {
  const n = freqPerYear[compoundFreq];
  const periodsPerMonth = n / 12;
  const totalPeriods = Math.round(durationMonths * periodsPerMonth);
  const ratePerPeriod = rate / 100 / n;

  const contribN = contribPerYear[contribFreq];
  const contribInterval = Math.round(n / contribN);

  let balance = principal;
  let totalInterest = 0;
  let totalContributions = 0;

  // Build monthly summary rows
  const monthlyData: { interest: number; deposits: number; endBalance: number }[] = [];
  let monthInterest = 0;
  let monthDeposits = 0;

  for (let i = 1; i <= totalPeriods; i++) {
    const interest = balance * ratePerPeriod;
    balance += interest;
    totalInterest += interest;
    monthInterest += interest;

    if (contribAmount > 0 && contribInterval > 0 && i % contribInterval === 0) {
      balance += contribAmount;
      totalContributions += contribAmount;
      monthDeposits += contribAmount;
    }

    const monthIndex = Math.ceil(i / periodsPerMonth);
    if (i % Math.round(periodsPerMonth) === 0 || i === totalPeriods) {
      monthlyData.push({ interest: monthInterest, deposits: monthDeposits, endBalance: balance });
      monthInterest = 0;
      monthDeposits = 0;
    }
  }

  // Build period rows (monthly granularity for table)
  const rows: PeriodRow[] = [];
  let cumInterest = 0;
  let prevBalance = principal;

  for (let i = 0; i < monthlyData.length; i++) {
    const m = monthlyData[i];
    cumInterest += m.interest;
    rows.push({
      period: i + 1,
      label: `Month ${i + 1}`,
      startBalance: prevBalance,
      deposits: m.deposits,
      interest: m.interest,
      cumulativeInterest: cumInterest,
      endBalance: m.endBalance,
    });
    prevBalance = m.endBalance;
  }

  return { finalBalance: balance, totalInterest, totalContributions, rows };
}

function computePerformanceFee(
  startBalance: number, returnRate: number, durationMonths: number,
  feePercent: number, compoundFreq: CompoundFreq,
): { grossProfit: number; feeAmount: number; netProfit: number; finalBalance: number; rows: { month: number; balance: number; profit: number; fee: number; net: number }[] } {
  const n = freqPerYear[compoundFreq];
  const periodsPerMonth = n / 12;
  const ratePerPeriod = returnRate / 100 / n;
  const feeRate = feePercent / 100;

  let balance = startBalance;
  let grossProfit = 0;
  let totalFees = 0;
  const rows: { month: number; balance: number; profit: number; fee: number; net: number }[] = [];

  for (let month = 1; month <= durationMonths; month++) {
    const monthStart = balance;
    const periods = Math.round(periodsPerMonth);
    for (let i = 0; i < periods; i++) {
      balance += balance * ratePerPeriod;
    }
    const monthProfit = balance - monthStart;
    const monthFee = monthProfit > 0 ? monthProfit * feeRate : 0;
    balance -= monthFee;
    grossProfit += monthProfit;
    totalFees += monthFee;

    rows.push({
      month,
      balance,
      profit: monthProfit,
      fee: monthFee,
      net: monthProfit - monthFee,
    });
  }

  return {
    grossProfit,
    feeAmount: totalFees,
    netProfit: grossProfit - totalFees,
    finalBalance: balance,
    rows,
  };
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
  const [view, setView] = useState<BreakdownView>('chart');

  const annualRate = toAnnualRate(rate, rateUnit);
  const durationMonths = toDurationMonths(duration, durationUnit);

  const result = useMemo(
    () => computeCompound(principal, annualRate, durationMonths, compoundFreq, contribAmount, contribFreq),
    [principal, annualRate, durationMonths, compoundFreq, contribAmount, contribFreq],
  );

  const chartData = useMemo(() => {
    return result.rows.map((r) => ({
      name: r.label,
      balance: Math.round(r.endBalance * 100) / 100,
      interest: Math.round(r.cumulativeInterest * 100) / 100,
    }));
  }, [result.rows]);

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
                    <XAxis dataKey="name" tick={{ fill: '#5A5C66', fontSize: 10 }} interval={Math.max(1, Math.floor(chartData.length / 12))} />
                    <YAxis tick={{ fill: '#5A5C66', fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      contentStyle={{ background: '#12141A', border: '1px solid #1E2130', borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: '#8B8D98' }}
                      formatter={(value) => [formatCurrency(typeof value === 'number' ? value : 0)]}
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
  const [view, setView] = useState<BreakdownView>('chart');

  const annualRate = toAnnualRate(returnRate, rateUnit);
  const durationMonths = toDurationMonths(duration, durationUnit);

  const result = useMemo(
    () => computePerformanceFee(startBalance, annualRate, Math.max(1, Math.round(durationMonths)), feePercent, compoundFreq),
    [startBalance, annualRate, durationMonths, feePercent, compoundFreq],
  );

  const chartData = useMemo(() => {
    let cumFee = 0;
    let cumNet = 0;
    return result.rows.map((r) => {
      cumFee += r.fee;
      cumNet += r.net;
      return {
        name: `M${r.month}`,
        balance: Math.round(r.balance * 100) / 100,
        cumulativeFees: Math.round(cumFee * 100) / 100,
        cumulativeNet: Math.round(cumNet * 100) / 100,
      };
    });
  }, [result.rows]);

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
          <p className="text-[10px] text-text-tertiary">
            Performance fee is deducted monthly from positive returns only.
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
              <h3 className="text-sm font-medium">Monthly Breakdown</h3>
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
                    <XAxis dataKey="name" tick={{ fill: '#5A5C66', fontSize: 10 }} interval={Math.max(1, Math.floor(chartData.length / 12))} />
                    <YAxis tick={{ fill: '#5A5C66', fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      contentStyle={{ background: '#12141A', border: '1px solid #1E2130', borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: '#8B8D98' }}
                      formatter={(value) => [formatCurrency(typeof value === 'number' ? value : 0)]}
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
                      <th className="text-left pb-2 font-medium">Month</th>
                      <th className="text-right pb-2 font-medium">Balance</th>
                      <th className="text-right pb-2 font-medium">Profit</th>
                      <th className="text-right pb-2 font-medium">Fee ({feePercent}%)</th>
                      <th className="text-right pb-2 font-medium">Net Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((r) => (
                      <tr key={r.month} className="border-b border-border-primary/30 hover:bg-bg-tertiary/30">
                        <td className="py-1.5">Month {r.month}</td>
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
