'use client';

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceDot } from 'recharts';
import { formatCurrency } from '@/lib/utils';

interface DrawdownData {
  series: { date: string; drawdown: number; drawdownPct: number; equity: number }[];
  maxDrawdownPoint: { date: string; drawdown: number; drawdownPct: number };
}

export function DrawdownChart({ data }: { data: DrawdownData }) {
  if (data.series.length === 0) {
    return <div className="flex items-center justify-center h-64 text-sm text-text-tertiary">No data</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data.series} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
        <defs>
          <linearGradient id="drawdownGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#FF4D6A" stopOpacity={0.4} />
            <stop offset="95%" stopColor="#FF4D6A" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
        <XAxis
          dataKey="date"
          stroke="var(--text-tertiary)"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => {
            const d = new Date(v);
            return `${d.getMonth() + 1}/${d.getDate()}`;
          }}
        />
        <YAxis
          stroke="var(--text-tertiary)"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `$${v.toFixed(0)}`}
          width={55}
          domain={['dataMin', 0]}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--bg-tertiary)',
            border: '1px solid var(--border-secondary)',
            borderRadius: 'var(--radius-md)',
            fontSize: '12px',
            color: 'var(--text-primary)',
          }}
          formatter={(value) => [formatCurrency(Number(value)), 'Drawdown']}
          labelFormatter={(label) => new Date(label).toLocaleDateString()}
        />
        <Area
          type="monotone"
          dataKey="drawdown"
          stroke="var(--loss-primary)"
          strokeWidth={1.5}
          fill="url(#drawdownGradient)"
          dot={false}
        />
        {data.maxDrawdownPoint.date && (
          <ReferenceDot
            x={data.maxDrawdownPoint.date}
            y={data.maxDrawdownPoint.drawdown}
            r={4}
            fill="var(--loss-primary)"
            stroke="var(--bg-primary)"
            strokeWidth={2}
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}
