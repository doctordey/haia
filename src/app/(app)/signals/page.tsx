'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';

// ─── Types ────────────────────────────────────────────

interface Stats {
  total: number;
  filled: number;
  sent: number;
  errors: number;
  dryRuns: number;
  fillRate: string;
  avgLatency: number;
  byInstrument: {
    NQ: { total: number; filled: number };
    ES: { total: number; filled: number };
  };
}

interface Execution {
  id: string;
  signalId: string;
  tradeNumber: number | null;
  splitIndex: number | null;
  linkedExecutionId: string | null;
  chunkIndex: number | null;
  totalChunks: number | null;
  instrument: string;
  fusionSymbol: string;
  direction: string;
  signalEntry: number;
  signalSl: number;
  signalTp1: number;
  signalTp2: number;
  signalSize: string;
  lotSize: number;
  offsetApplied: number | null;
  offsetIsStale: boolean;
  adjustedEntry: number | null;
  adjustedSl: number | null;
  adjustedTp1: number | null;
  adjustedTp2: number | null;
  orderType: string | null;
  orderReason: string | null;
  status: string;
  metaapiOrderId: string | null;
  fillPrice: number | null;
  slippage: number | null;
  errorMessage: string | null;
  totalLatencyMs: number | null;
  breakevenMovedAt: string | null;
  isDryRun: boolean;
  createdAt: string;
}

interface OffsetPoint {
  receivedAt: string;
  nqOffset: number;
  esOffset: number;
}

interface OffsetCurrent {
  nqOffset: number;
  esOffset: number;
  age: string;
  ageMs: number;
  isStale: boolean;
}

interface SignalConfig {
  isEnabled: boolean;
  dryRun: boolean;
}

// ─── Dashboard Page ───────────────────────────────────

export default function SignalDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [offsetCurrent, setOffsetCurrent] = useState<OffsetCurrent | null>(null);
  const [offsetHistory, setOffsetHistory] = useState<OffsetPoint[]>([]);
  const [config, setConfig] = useState<SignalConfig | null>(null);
  const [filter, setFilter] = useState<'all' | 'NQ' | 'ES'>('all');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [statsRes, execsRes, offsetRes, historyRes, configRes] = await Promise.all([
        fetch(`/api/signals/stats?from=${today.toISOString()}`),
        fetch(`/api/signals/executions?limit=100${filter !== 'all' ? `&instrument=${filter}` : ''}`),
        fetch('/api/signals/offset/current'),
        fetch('/api/signals/offset/history?limit=200'),
        fetch('/api/signals/config'),
      ]);

      if (statsRes.ok) setStats(await statsRes.json());
      if (execsRes.ok) {
        const data = await execsRes.json();
        setExecutions(data.executions || []);
      }
      if (offsetRes.ok) {
        const data = await offsetRes.json();
        if (data) setOffsetCurrent(data);
      }
      if (historyRes.ok) setOffsetHistory(await historyRes.json());
      if (configRes.ok) {
        const data = await configRes.json();
        if (data) setConfig(data);
      }
    } catch (err) {
      console.error('Failed to fetch signal data:', err);
    }
  }, [filter]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Signal Dashboard</h1>
        <Link href="/signals/settings">
          <Button variant="secondary" size="sm">Settings</Button>
        </Link>
      </div>

      {/* Summary cards */}
      <SummaryCards stats={stats} offsetCurrent={offsetCurrent} config={config} />

      {/* Signal table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Recent Executions</h3>
            <div className="flex gap-1">
              {(['all', 'NQ', 'ES'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2.5 py-1 text-xs rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
                    filter === f
                      ? 'bg-accent-primary text-white'
                      : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                  }`}
                >
                  {f === 'all' ? 'All' : f}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <SignalTable
            executions={executions}
            expandedRow={expandedRow}
            onToggleRow={(id) => setExpandedRow(expandedRow === id ? null : id)}
          />
        </CardContent>
      </Card>

      {/* Bottom row: charts + performance */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
        <Card>
          <CardHeader><h3 className="text-sm font-medium">Offset History</h3></CardHeader>
          <CardContent>
            <OffsetCharts data={offsetHistory} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><h3 className="text-sm font-medium">Performance</h3></CardHeader>
          <CardContent>
            <PerformancePanel stats={stats} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Summary Cards ────────────────────────────────────

function SummaryCards({
  stats,
  offsetCurrent,
  config,
}: {
  stats: Stats | null;
  offsetCurrent: OffsetCurrent | null;
  config: SignalConfig | null;
}) {
  if (!stats) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {[...Array(5)].map((_, i) => (
          <Card key={i}><CardContent className="py-4"><div className="h-14 animate-pulse bg-bg-tertiary rounded" /></CardContent></Card>
        ))}
      </div>
    );
  }

  const pipelineStatus = !config ? 'Not Set Up' : config.isEnabled ? 'Active' : 'Paused';
  const pipelineBadge: 'profit' | 'loss' | 'warning' | 'default' =
    !config ? 'default' : config.isEnabled ? (config.dryRun ? 'warning' : 'profit') : 'loss';

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
      <Card hover>
        <CardContent className="py-4">
          <p className="text-xs text-text-secondary uppercase tracking-wide font-medium mb-2">Pipeline</p>
          <Badge variant={pipelineBadge}>{pipelineStatus}</Badge>
          {config?.dryRun && config.isEnabled && (
            <p className="text-xs text-warning mt-1">Dry Run</p>
          )}
        </CardContent>
      </Card>

      <Card hover>
        <CardContent className="py-4">
          <p className="text-xs text-text-secondary uppercase tracking-wide font-medium mb-2">Today&apos;s Signals</p>
          <span className="text-2xl font-bold font-mono">{stats.total}</span>
          <p className="text-xs text-text-secondary mt-1">
            {stats.filled + stats.sent} fills &middot; {stats.fillRate}% rate
          </p>
        </CardContent>
      </Card>

      <Card hover>
        <CardContent className="py-4">
          <p className="text-xs text-text-secondary uppercase tracking-wide font-medium mb-2">Avg Latency</p>
          <span className="text-2xl font-bold font-mono">{stats.avgLatency}<span className="text-sm text-text-tertiary">ms</span></span>
        </CardContent>
      </Card>

      <Card hover>
        <CardContent className="py-4">
          <p className="text-xs text-text-secondary uppercase tracking-wide font-medium mb-2">NQ Offset</p>
          <span className="text-2xl font-bold font-mono">
            {offsetCurrent ? `+${offsetCurrent.nqOffset.toFixed(1)}` : '—'}
          </span>
          <p className={`text-xs mt-1 ${offsetCurrent?.isStale ? 'text-warning' : 'text-text-tertiary'}`}>
            {offsetCurrent?.age || 'No data'}
          </p>
        </CardContent>
      </Card>

      <Card hover>
        <CardContent className="py-4">
          <p className="text-xs text-text-secondary uppercase tracking-wide font-medium mb-2">ES Offset</p>
          <span className="text-2xl font-bold font-mono">
            {offsetCurrent ? `+${offsetCurrent.esOffset.toFixed(1)}` : '—'}
          </span>
          <p className={`text-xs mt-1 ${offsetCurrent?.isStale ? 'text-warning' : 'text-text-tertiary'}`}>
            {offsetCurrent?.age || 'No data'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Signal Table ─────────────────────────────────────

function statusBadge(status: string): { variant: 'profit' | 'loss' | 'warning' | 'info' | 'default'; label: string } {
  switch (status) {
    case 'filled': return { variant: 'profit', label: 'Filled' };
    case 'sent': return { variant: 'warning', label: 'Pending' };
    case 'error': return { variant: 'loss', label: 'Error' };
    case 'rejected': return { variant: 'loss', label: 'Rejected' };
    case 'cancelled': return { variant: 'default', label: 'Cancelled' };
    case 'dry_run': return { variant: 'info', label: 'Dry Run' };
    default: return { variant: 'default', label: status };
  }
}

function formatTime(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function SignalTable({
  executions,
  expandedRow,
  onToggleRow,
}: {
  executions: Execution[];
  expandedRow: string | null;
  onToggleRow: (id: string) => void;
}) {
  if (executions.length === 0) {
    return (
      <div className="p-8 text-center text-text-tertiary text-sm">
        No executions yet. Signals will appear here when received.
      </div>
    );
  }

  // Group by signalId + tradeNumber for split/chunk grouping
  const grouped = groupExecutions(executions);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-text-tertiary uppercase tracking-wide border-b border-border-primary">
            <th className="text-left px-4 py-2.5 font-medium">Time</th>
            <th className="text-left px-2 py-2.5 font-medium">Sym</th>
            <th className="text-left px-2 py-2.5 font-medium">Dir</th>
            <th className="text-right px-2 py-2.5 font-medium">Signal</th>
            <th className="text-right px-2 py-2.5 font-medium">Adj.</th>
            <th className="text-left px-2 py-2.5 font-medium">Type</th>
            <th className="text-right px-2 py-2.5 font-medium">Lots</th>
            <th className="text-right px-2 py-2.5 font-medium">Fill</th>
            <th className="text-right px-2 py-2.5 font-medium">Lat.</th>
            <th className="text-left px-2 py-2.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {grouped.map((group) => (
            <ExecutionGroup
              key={group.id}
              group={group}
              isExpanded={expandedRow === group.id}
              onToggle={() => onToggleRow(group.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface ExecutionGroup {
  id: string;
  primary: Execution;
  children: Execution[];
  totalLots: number;
  chunkCount: number;
  isSplit: boolean;
}

function groupExecutions(executions: Execution[]): ExecutionGroup[] {
  const groups = new Map<string, Execution[]>();

  for (const exec of executions) {
    // Group key: signalId + tradeNumber + splitIndex (or 'single')
    const key = `${exec.signalId}-${exec.tradeNumber}-${exec.splitIndex ?? 'single'}`;
    const arr = groups.get(key) || [];
    arr.push(exec);
    groups.set(key, arr);
  }

  const result: ExecutionGroup[] = [];
  const processed = new Set<string>();

  for (const [key, execs] of groups) {
    if (processed.has(key)) continue;

    const primary = execs[0];
    const totalLots = parseFloat(execs.reduce((s, e) => s + e.lotSize, 0).toFixed(2));
    const chunkCount = execs.length;

    // Check for split pair
    const splitKey = primary.splitIndex === 1
      ? `${primary.signalId}-${primary.tradeNumber}-2`
      : primary.splitIndex === 2
      ? `${primary.signalId}-${primary.tradeNumber}-1`
      : null;

    const pairedExecs = splitKey ? groups.get(splitKey) : null;
    const children = execs.length > 1 ? execs.slice(1) : [];

    if (pairedExecs && primary.splitIndex === 1) {
      // TP1 row — add TP2 rows as children
      children.push(...pairedExecs);
      processed.add(splitKey!);
    }

    result.push({
      id: key,
      primary,
      children,
      totalLots,
      chunkCount,
      isSplit: primary.splitIndex != null,
    });
    processed.add(key);
  }

  return result;
}

function ExecutionGroup({
  group,
  isExpanded,
  onToggle,
}: {
  group: ExecutionGroup;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const e = group.primary;
  const badge = statusBadge(e.status);
  const hasChildren = group.children.length > 0;
  const lotsDisplay = group.chunkCount > 1
    ? `${group.totalLots} (${group.chunkCount}×)`
    : e.lotSize.toFixed(2);

  return (
    <>
      <tr
        onClick={onToggle}
        className={`border-b border-border-primary hover:bg-bg-hover cursor-pointer transition-colors ${
          e.status === 'rejected' || e.status === 'error' ? 'bg-loss-bg/30' : ''
        }`}
      >
        <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">
          {hasChildren && <span className="mr-1 text-text-tertiary">{isExpanded ? '▾' : '▸'}</span>}
          {e.splitIndex === 1 && <span className="text-accent-primary mr-1">TP1</span>}
          {e.splitIndex === 2 && <span className="text-info mr-1">TP2</span>}
          {formatTime(e.createdAt)}
        </td>
        <td className="px-2 py-2.5 text-xs">{e.fusionSymbol === 'NAS100' ? 'NAS' : 'US5'}</td>
        <td className={`px-2 py-2.5 text-xs font-medium ${e.direction === 'LONG' ? 'text-profit-primary' : 'text-loss-primary'}`}>
          {e.direction === 'LONG' ? 'BUY' : 'SELL'}
        </td>
        <td className="px-2 py-2.5 text-right font-mono text-xs">{e.signalEntry.toLocaleString()}</td>
        <td className="px-2 py-2.5 text-right font-mono text-xs">{e.adjustedEntry?.toLocaleString() ?? '—'}</td>
        <td className="px-2 py-2.5 text-xs">{e.orderType ? shortOrderType(e.orderType) : '—'}</td>
        <td className="px-2 py-2.5 text-right font-mono text-xs">{lotsDisplay}</td>
        <td className="px-2 py-2.5 text-right font-mono text-xs">{e.fillPrice?.toLocaleString() ?? 'pnd'}</td>
        <td className="px-2 py-2.5 text-right font-mono text-xs">{e.totalLatencyMs ?? '—'}</td>
        <td className="px-2 py-2.5">
          <Badge variant={badge.variant}>{badge.label}</Badge>
          {e.breakevenMovedAt && <Badge variant="info" className="ml-1">BE</Badge>}
        </td>
      </tr>

      {/* Expanded detail */}
      {isExpanded && (
        <tr className="bg-bg-tertiary/50">
          <td colSpan={10} className="px-6 py-3">
            <ExecutionDetail exec={e} />
            {group.children.map((child) => (
              <div key={child.id} className="mt-2 pt-2 border-t border-border-primary">
                <div className="flex items-center gap-2 mb-1">
                  {child.splitIndex === 2 && <Badge variant="info">TP2</Badge>}
                  {child.chunkIndex && <Badge>Chunk {child.chunkIndex}/{child.totalChunks}</Badge>}
                  <Badge variant={statusBadge(child.status).variant}>{statusBadge(child.status).label}</Badge>
                  {child.breakevenMovedAt && <Badge variant="info">BE moved {new Date(child.breakevenMovedAt).toLocaleTimeString()}</Badge>}
                </div>
                <ExecutionDetail exec={child} />
              </div>
            ))}
          </td>
        </tr>
      )}
    </>
  );
}

function ExecutionDetail({ exec: e }: { exec: Execution }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 text-xs">
      <DetailField label="Offset Applied" value={e.offsetApplied != null ? `${e.offsetApplied.toFixed(2)} pts${e.offsetIsStale ? ' (stale)' : ''}` : '—'} />
      <DetailField label="Lot Size" value={`${e.lotSize} lots`} />
      <DetailField label="Signal Size" value={e.signalSize} />
      <DetailField label="Slippage" value={e.slippage != null ? `${e.slippage.toFixed(1)} pts` : '—'} />
      <DetailField label="Adjusted SL" value={e.adjustedSl?.toLocaleString() ?? '—'} />
      <DetailField label="Adjusted TP1" value={e.adjustedTp1?.toLocaleString() ?? '—'} />
      <DetailField label="Adjusted TP2" value={e.adjustedTp2?.toLocaleString() ?? '—'} />
      <DetailField label="Order ID" value={e.metaapiOrderId ?? '—'} />
      {e.orderReason && (
        <div className="col-span-2 md:col-span-4">
          <DetailField label="Reason" value={e.orderReason} />
        </div>
      )}
      {e.errorMessage && (
        <div className="col-span-2 md:col-span-4">
          <span className="text-loss-primary">{e.errorMessage}</span>
        </div>
      )}
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-text-tertiary">{label}: </span>
      <span className="text-text-primary font-mono">{value}</span>
    </div>
  );
}

function shortOrderType(type: string): string {
  const map: Record<string, string> = {
    MARKET: 'MKT', BUY_STOP: 'B.STP', BUY_LIMIT: 'B.LMT',
    SELL_STOP: 'S.STP', SELL_LIMIT: 'S.LMT',
  };
  return map[type] || type;
}

// ─── Offset Charts ────────────────────────────────────

function OffsetCharts({ data }: { data: OffsetPoint[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-text-tertiary py-4">No offset data yet. Configure the TradingView webhook.</p>;
  }

  const chartData = data.map((d) => ({
    time: new Date(d.receivedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
    nqOffset: d.nqOffset,
    esOffset: d.esOffset,
  }));

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-text-secondary mb-2">NQ — NAS100 Spread</p>
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="time" stroke="var(--text-tertiary)" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="var(--text-tertiary)" fontSize={10} tickLine={false} axisLine={false} width={40} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-secondary)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '11px',
                  color: 'var(--text-primary)',
                }}
              />
              <Line type="monotone" dataKey="nqOffset" stroke="#6C5CE7" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div>
        <p className="text-xs text-text-secondary mb-2">ES — US500 Spread</p>
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="time" stroke="var(--text-tertiary)" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="var(--text-tertiary)" fontSize={10} tickLine={false} axisLine={false} width={40} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-secondary)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '11px',
                  color: 'var(--text-primary)',
                }}
              />
              <Line type="monotone" dataKey="esOffset" stroke="#00DC82" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ─── Performance Panel ────────────────────────────────

function PerformancePanel({ stats }: { stats: Stats | null }) {
  if (!stats) {
    return <div className="animate-pulse h-32 bg-bg-tertiary rounded" />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-secondary">NAS100</span>
        <span className="text-sm font-mono font-medium">{stats.byInstrument.NQ.total} signals</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-secondary">Filled</span>
        <span className="text-sm font-mono">{stats.byInstrument.NQ.filled}</span>
      </div>
      <div className="border-t border-border-primary pt-3 flex items-center justify-between">
        <span className="text-xs text-text-secondary">US500</span>
        <span className="text-sm font-mono font-medium">{stats.byInstrument.ES.total} signals</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-secondary">Filled</span>
        <span className="text-sm font-mono">{stats.byInstrument.ES.filled}</span>
      </div>
      <div className="border-t border-border-primary pt-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-secondary">Total</span>
          <span className="text-sm font-mono font-bold">{stats.total} signals</span>
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-xs text-text-secondary">Fill Rate</span>
          <span className="text-sm font-mono">{stats.fillRate}%</span>
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-xs text-text-secondary">Errors</span>
          <span className={`text-sm font-mono ${stats.errors > 0 ? 'text-loss-primary' : ''}`}>{stats.errors}</span>
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-xs text-text-secondary">Avg Latency</span>
          <span className="text-sm font-mono">{stats.avgLatency}ms</span>
        </div>
      </div>
    </div>
  );
}
