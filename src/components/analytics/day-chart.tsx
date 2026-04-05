'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { formatCurrency } from '@/lib/utils';

interface DayData {
  day: string;
  pnl: number;
  avgPnl: number;
  count: number;
}

export function DayChart({ data }: { data: DayData[] }) {
  if (data.length === 0) {
    return <div className="flex items-center justify-center h-64 text-sm text-text-tertiary">No data</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
        <XAxis
          dataKey="day"
          stroke="var(--text-tertiary)"
          fontSize={12}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          stroke="var(--text-tertiary)"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `$${v.toFixed(0)}`}
          width={55}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--bg-tertiary)',
            border: '1px solid var(--border-secondary)',
            borderRadius: 'var(--radius-md)',
            fontSize: '12px',
            color: 'var(--text-primary)',
          }}
          formatter={(value, name) => [
            formatCurrency(Number(value)),
            name === 'avgPnl' ? 'Avg PNL' : 'Total PNL',
          ]}
        />
        <Bar dataKey="avgPnl" radius={[4, 4, 0, 0]}>
          {data.map((entry, index) => (
            <Cell key={index} fill={entry.avgPnl >= 0 ? 'var(--profit-primary)' : 'var(--loss-primary)'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
