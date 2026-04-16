'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCurrency, cn } from '@/lib/utils';

interface CopyGroup {
  id: string;
  name: string;
  isEnabled: boolean;
  masterAccount: {
    id: string;
    name: string;
    platform: string;
  };
  slaves: {
    id: string;
    isEnabled: boolean;
    dryRun: boolean;
    account: { id: string; name: string; platform: string };
    symbolMaps: { id: string; masterSymbol: string; slaveSymbol: string; isEnabled: boolean }[];
  }[];
}

interface CopyPosition {
  id: string;
  groupId: string;
  masterSymbol: string;
  slaveSymbol: string;
  masterDirection: string;
  masterLots: number;
  slaveLots: number;
  masterEntryPrice: number;
  slaveEntryPrice: number | null;
  status: string;
  sizingMode: string;
  sizingDetail: string | null;
  isDryRun: boolean;
  masterOpenedAt: string;
  slaveOpenedAt: string | null;
  openLatencyMs: number | null;
  slaveProfit: number | null;
  errorMessage: string | null;
  createdAt: string;
}

export default function CopyTradingPage() {
  const [groups, setGroups] = useState<CopyGroup[]>([]);
  const [positions, setPositions] = useState<CopyPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'open' | 'closed' | 'error'>('all');

  const fetchData = useCallback(async () => {
    try {
      const [groupsRes, positionsRes] = await Promise.all([
        fetch('/api/copy-trading/groups'),
        fetch('/api/copy-trading/positions?limit=100'),
      ]);
      if (groupsRes.ok) setGroups(await groupsRes.json());
      if (positionsRes.ok) {
        const data = await positionsRes.json();
        setPositions(data.positions || []);
      }
    } catch (err) {
      console.error('Failed to fetch copy trading data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const enabledGroups = groups.filter((g) => g.isEnabled);
  const totalSlaves = groups.reduce((sum, g) => sum + g.slaves.filter((s) => s.isEnabled).length, 0);
  const openPositions = positions.filter((p) => p.status === 'open');
  const todayPositions = positions.filter((p) => {
    const d = new Date(p.createdAt);
    const now = new Date();
    return d.toDateString() === now.toDateString();
  });

  const filteredPositions = filter === 'all' ? positions
    : filter === 'open' ? positions.filter((p) => p.status === 'open' || p.status === 'opening')
    : filter === 'closed' ? positions.filter((p) => p.status === 'closed')
    : positions.filter((p) => p.status === 'error');

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <h1 className="text-xl font-semibold">Copy Trading</h1>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}><CardContent className="py-4"><div className="h-14 animate-pulse bg-bg-tertiary rounded" /></CardContent></Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Copy Trading</h1>
        <Link href="/copy-trading/settings">
          <Button variant="secondary" size="sm">Settings</Button>
        </Link>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-text-secondary uppercase tracking-wide font-medium mb-2">Active Groups</p>
            <p className="text-2xl font-bold text-text-primary font-mono">{enabledGroups.length}</p>
            <p className="text-xs text-text-tertiary mt-1">{groups.length} total</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-text-secondary uppercase tracking-wide font-medium mb-2">Connected Slaves</p>
            <p className="text-2xl font-bold text-text-primary font-mono">{totalSlaves}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-text-secondary uppercase tracking-wide font-medium mb-2">Open Positions</p>
            <p className="text-2xl font-bold text-text-primary font-mono">{openPositions.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-text-secondary uppercase tracking-wide font-medium mb-2">Today&apos;s Copies</p>
            <p className="text-2xl font-bold text-text-primary font-mono">{todayPositions.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Groups Overview */}
      {groups.length > 0 && (
        <Card>
          <CardHeader><h2 className="text-sm font-medium">Copy Groups</h2></CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-3">
              {groups.map((group) => (
                <div key={group.id} className="flex items-center justify-between p-3 bg-bg-tertiary rounded-[var(--radius-md)]">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-primary">{group.name}</span>
                      <Badge variant={group.isEnabled ? 'profit' : 'default'}>
                        {group.isEnabled ? 'Active' : 'Paused'}
                      </Badge>
                    </div>
                    <p className="text-xs text-text-tertiary mt-0.5">
                      Master: {group.masterAccount.name} ({group.masterAccount.platform.toUpperCase()}) → {group.slaves.length} slave(s)
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {group.slaves.map((slave) => (
                      <div key={slave.id} className="flex items-center gap-1">
                        <span className="text-xs text-text-secondary">{slave.account.name}</span>
                        <Badge variant={slave.dryRun ? 'warning' : slave.isEnabled ? 'profit' : 'default'}>
                          {slave.dryRun ? 'Dry' : slave.isEnabled ? 'Live' : 'Off'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Positions Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Recent Positions</h2>
            <div className="flex gap-1">
              {(['all', 'open', 'closed', 'error'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    'px-2.5 py-1 text-xs rounded-[var(--radius-sm)] transition-colors cursor-pointer capitalize',
                    filter === f ? 'bg-accent-primary text-white' : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {filteredPositions.length === 0 ? (
            <p className="text-sm text-text-tertiary text-center py-8">
              {groups.length === 0
                ? 'No copy groups configured. Go to Settings to create one.'
                : 'No positions yet. Positions will appear when the master account opens trades.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-text-tertiary uppercase tracking-wide border-b border-border-primary">
                    <th className="text-left pb-2 font-medium">Master</th>
                    <th className="text-left pb-2 font-medium">Slave</th>
                    <th className="text-left pb-2 font-medium">Dir</th>
                    <th className="text-right pb-2 font-medium">M Lots</th>
                    <th className="text-right pb-2 font-medium">S Lots</th>
                    <th className="text-right pb-2 font-medium">Entry</th>
                    <th className="text-left pb-2 font-medium">Status</th>
                    <th className="text-right pb-2 font-medium">Latency</th>
                    <th className="text-right pb-2 font-medium">P&L</th>
                    <th className="text-right pb-2 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPositions.map((pos) => (
                    <tr key={pos.id} className="border-b border-border-primary/50 hover:bg-bg-tertiary/50">
                      <td className="py-2 font-mono">{pos.masterSymbol}</td>
                      <td className="py-2 font-mono">{pos.slaveSymbol}</td>
                      <td className="py-2">
                        <span className={pos.masterDirection === 'BUY' ? 'text-profit-primary' : 'text-loss-primary'}>
                          {pos.masterDirection}
                        </span>
                      </td>
                      <td className="py-2 text-right font-mono">{pos.masterLots}</td>
                      <td className="py-2 text-right font-mono">{pos.slaveLots}</td>
                      <td className="py-2 text-right font-mono">{pos.slaveEntryPrice?.toFixed(2) || '—'}</td>
                      <td className="py-2">
                        <Badge variant={
                          pos.status === 'open' ? 'profit'
                          : pos.status === 'closed' ? 'default'
                          : pos.status === 'error' ? 'loss'
                          : pos.status === 'dry_run' ? 'warning'
                          : 'info'
                        }>
                          {pos.isDryRun ? 'dry' : pos.status}
                        </Badge>
                      </td>
                      <td className="py-2 text-right font-mono text-text-tertiary">
                        {pos.openLatencyMs ? `${pos.openLatencyMs}ms` : '—'}
                      </td>
                      <td className={cn('py-2 text-right font-mono', pos.slaveProfit != null ? (pos.slaveProfit >= 0 ? 'text-profit-primary' : 'text-loss-primary') : 'text-text-tertiary')}>
                        {pos.slaveProfit != null ? formatCurrency(pos.slaveProfit) : '—'}
                      </td>
                      <td className="py-2 text-right text-text-tertiary">
                        {new Date(pos.createdAt).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
