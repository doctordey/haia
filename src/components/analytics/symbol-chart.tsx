'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { formatCurrency } from '@/lib/utils';

interface SymbolData {
  symbol: string;
  pnl: number;
  trades: number;
  wins: number;
  losses: number;
}

export function SymbolChart({ data }: { data: SymbolData[] }) {
  if (data.length === 0) {
    return <div className="flex items-center justify-center h-64 text-sm text-text-tertiary">No data</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(250, data.length * 36)}>
      <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 70 }}>
        <XAxis
          type="number"
          stroke="var(--text-tertiary)"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)}`}
        />
        <YAxis
          type="category"
          dataKey="symbol"
          stroke="var(--text-tertiary)"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          width={65}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--bg-tertiary)',
            border: '1px solid var(--border-secondary)',
            borderRadius: 'var(--radius-md)',
            fontSize: '12px',
            color: 'var(--text-primary)',
          }}
          formatter={(value) => [formatCurrency(Number(value)), 'PNL']}
          labelStyle={{ color: 'var(--text-secondary)' }}
        />
        <Bar dataKey="pnl" radius={[0, 4, 4, 0]}>
          {data.map((entry, index) => (
            <Cell key={index} fill={entry.pnl >= 0 ? 'var(--profit-primary)' : 'var(--loss-primary)'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
