'use client';

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import type { EquityPoint } from '@/types';
import { formatCurrency } from '@/lib/utils';

interface EquityCurveProps {
  data: EquityPoint[];
  range: string;
  onRangeChange: (range: string) => void;
}

const ranges = ['1D', '7D', '30D', '90D', '1Y', 'MAX'];

export function EquityCurve({ data, range, onRangeChange }: EquityCurveProps) {
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1 mb-3">
        {ranges.map((r) => (
          <button
            key={r}
            onClick={() => onRangeChange(r)}
            className={`px-2.5 py-1 text-xs rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
              range === r
                ? 'bg-accent-primary text-white'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <defs>
              <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#00DC82" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#00DC82" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
            <XAxis
              dataKey="date"
              stroke="var(--text-tertiary)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => {
                const d = new Date(value);
                return `${d.getMonth() + 1}/${d.getDate()}`;
              }}
            />
            <YAxis
              stroke="var(--text-tertiary)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => `$${(value / 1000).toFixed(1)}k`}
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
              formatter={(value) => [formatCurrency(Number(value)), 'Equity']}
              labelFormatter={(label) => new Date(label).toLocaleDateString()}
            />
            <Area
              type="monotone"
              dataKey="equity"
              stroke="var(--chart-line)"
              strokeWidth={2}
              fill="url(#equityGradient)"
              dot={false}
              activeDot={{ r: 3, fill: 'var(--chart-line)', stroke: 'var(--bg-primary)', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
