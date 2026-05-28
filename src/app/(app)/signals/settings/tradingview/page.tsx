'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/useToast';

// ─── Types ────────────────────────────────────────────

interface TvAlertConfigRow {
  id: string;
  accountId: string;
  tvSymbol: string;
  fusionSymbol: string;
  isEnabled: boolean;
  dryRun: boolean;
  riskPercent: number;
  rewardRiskRatio: number;
  slPipOffset: number;
  pipSize: number;
  pipValuePerLot: number;
  sizingMode: 'percent_equity' | 'percent_balance' | 'strict';
  strictLots: number;
  minLotSize: number;
  lotStep: number;
  maxLotSize: number;
  maxLotsPerOrder: number;
  minStopDistancePips: number;
  maxRiskPercent: number;
  maxSlippage: number;
  marginWarningThreshold: number;
  marginRejectThreshold: number;
  maxOffsetAbs: number;
}

interface TvAlertRow {
  id: string;
  receivedAt: string;
  tvSymbol: string;
  fusionSymbol: string | null;
  direction: 'LONG' | 'SHORT';
  status: string;
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  lotSize: number | null;
  metaapiOrderId: string | null;
  errorMessage: string | null;
  totalLatencyMs: number | null;
  isDryRun: boolean;
}

interface TradingAccount {
  id: string;
  name: string;
  platform: string;
  broker: string | null;
  accessMode: string;
}

const TV_SYMBOLS = ['XBRUSD', 'UK10YBG'] as const;

const SYMBOL_DEFAULTS: Record<string, { fusionSymbol: string; rewardRiskRatio: number }> = {
  XBRUSD:  { fusionSymbol: 'XBRUSD',  rewardRiskRatio: 2.0 },
  UK10YBG: { fusionSymbol: 'UKGILT',  rewardRiskRatio: 1.0 },
};

function emptyConfig(): Partial<TvAlertConfigRow> {
  return {
    tvSymbol: 'XBRUSD',
    fusionSymbol: 'XBRUSD',
    isEnabled: false,
    dryRun: true,
    riskPercent: 5,
    rewardRiskRatio: 2,
    slPipOffset: 2,
    pipSize: 0.01,
    pipValuePerLot: 0.10,
    sizingMode: 'percent_equity',
    strictLots: 0.01,
    minLotSize: 0.01,
    lotStep: 0.01,
    maxLotSize: 100,
    maxLotsPerOrder: 50,
    minStopDistancePips: 5,
    maxRiskPercent: 10,
    maxSlippage: 5,
    marginWarningThreshold: 80,
    marginRejectThreshold: 95,
    maxOffsetAbs: 10,
  };
}

// ─── Page ─────────────────────────────────────────────

export default function TvAlertSettingsPage() {
  const { toast } = useToast();
  const [configs, setConfigs] = useState<TvAlertConfigRow[]>([]);
  const [accounts, setAccounts] = useState<TradingAccount[]>([]);
  const [alerts, setAlerts] = useState<TvAlertRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<Partial<TvAlertConfigRow> | null>(null);

  const reload = useCallback(async () => {
    const [cfgRes, acctRes, alertRes] = await Promise.all([
      fetch('/api/signals/tradingview/configs'),
      fetch('/api/accounts'),
      fetch('/api/signals/tradingview/alerts?limit=20'),
    ]);
    const [cfg, acct, alertList] = await Promise.all([
      cfgRes.json(),
      acctRes.json(),
      alertRes.json(),
    ]);
    setConfigs(Array.isArray(cfg) ? cfg : []);
    setAccounts(Array.isArray(acct) ? acct : []);
    setAlerts(Array.isArray(alertList) ? alertList : []);
  }, []);

  useEffect(() => {
    Promise.all([
      fetch('/api/signals/tradingview/configs').then((r) => r.json()),
      fetch('/api/accounts').then((r) => r.json()),
      fetch('/api/signals/tradingview/alerts?limit=20').then((r) => r.json()),
    ])
      .then(([cfg, acct, alertList]) => {
        setConfigs(Array.isArray(cfg) ? cfg : []);
        setAccounts(Array.isArray(acct) ? acct : []);
        setAlerts(Array.isArray(alertList) ? alertList : []);
        setLoaded(true);
      })
      .catch(() => {
        toast('Failed to load TradingView settings', 'error');
        setLoaded(true);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const webhookUrl = useMemo(
    () => (typeof window !== 'undefined'
      ? `${window.location.origin}/api/signals/tradingview/webhook`
      : '/api/signals/tradingview/webhook'),
    [],
  );

  async function saveConfig(form: Partial<TvAlertConfigRow>) {
    const res = await fetch('/api/signals/tradingview/configs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast(err.error || 'Save failed', 'error');
      return;
    }
    toast('Config saved', 'success');
    setEditing(null);
    await reload();
  }

  async function deleteConfig(id: string) {
    if (!confirm('Delete this TradingView config? Webhook fires for this symbol will be rejected.')) return;
    const res = await fetch(`/api/signals/tradingview/configs/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      toast('Delete failed', 'error');
      return;
    }
    toast('Config deleted', 'success');
    await reload();
  }

  if (!loaded) {
    return (
      <div className="p-4 max-w-5xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-bg-secondary rounded w-72" />
          <div className="h-32 bg-bg-secondary rounded" />
          <div className="h-64 bg-bg-secondary rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4 pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">TradingView → FusionMarkets</h1>
          <p className="text-xs text-text-tertiary mt-1">
            Webhook alerts from a TradingView indicator open trades on your FusionMarkets account.{' '}
            <Link href="/signals/settings" className="text-accent-primary hover:underline">
              ← Telegram signal settings
            </Link>
          </p>
        </div>
      </div>

      {/* Webhook URL */}
      <Card>
        <CardHeader><h3 className="text-sm font-medium">Webhook URL</h3></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 items-center">
            <code className="flex-1 p-2 bg-bg-primary rounded text-text-secondary text-xs font-mono break-all">
              {webhookUrl}
            </code>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                navigator.clipboard.writeText(webhookUrl);
                toast('URL copied', 'success');
              }}
            >
              Copy
            </Button>
          </div>
          <p className="text-xs text-text-tertiary">
            Paste this into the <span className="text-text-primary">Notifications → Webhook URL</span> field of each TradingView alert.
            The alert body must include <code className="text-text-primary">secret</code> matching the <code className="text-text-primary">TRADINGVIEW_WEBHOOK_SECRET</code> env var.
            Use <code className="text-text-primary">tv_alert_indicator.pine</code> as the template.
          </p>
        </CardContent>
      </Card>

      {/* Configs */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Instrument Configs</h3>
            <Button size="sm" onClick={() => setEditing(emptyConfig())}>+ Add config</Button>
          </div>
        </CardHeader>
        <CardContent>
          {configs.length === 0 ? (
            <p className="text-xs text-text-tertiary">
              No configs yet. Add one for XBRUSD (default 2:1 RR @ 5% risk) or UK10YBG (default 1:1 RR @ 5% risk).
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-text-tertiary border-b border-border-primary">
                  <tr>
                    <th className="text-left py-2 px-2">TV</th>
                    <th className="text-left py-2 px-2">Fusion</th>
                    <th className="text-left py-2 px-2">Account</th>
                    <th className="text-left py-2 px-2">State</th>
                    <th className="text-right py-2 px-2">Risk %</th>
                    <th className="text-right py-2 px-2">RR</th>
                    <th className="text-right py-2 px-2">SL pips</th>
                    <th className="text-right py-2 px-2">Max lots</th>
                    <th className="text-right py-2 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {configs.map((c) => {
                    const acct = accounts.find((a) => a.id === c.accountId);
                    return (
                      <tr key={c.id} className="border-b border-border-primary hover:bg-bg-tertiary/40">
                        <td className="py-2 px-2 font-mono text-text-primary">{c.tvSymbol}</td>
                        <td className="py-2 px-2 font-mono text-text-secondary">{c.fusionSymbol}</td>
                        <td className="py-2 px-2 text-text-secondary">{acct?.name ?? c.accountId.slice(0, 6)}</td>
                        <td className="py-2 px-2">
                          {c.isEnabled
                            ? c.dryRun ? <Badge variant="warning">Dry</Badge> : <Badge variant="profit">Live</Badge>
                            : <Badge>Off</Badge>}
                        </td>
                        <td className="py-2 px-2 text-right font-mono">{c.riskPercent.toFixed(1)}</td>
                        <td className="py-2 px-2 text-right font-mono">{c.rewardRiskRatio}:1</td>
                        <td className="py-2 px-2 text-right font-mono">{c.slPipOffset}</td>
                        <td className="py-2 px-2 text-right font-mono">{c.maxLotSize}</td>
                        <td className="py-2 px-2 text-right space-x-2">
                          <button
                            className="text-xs text-accent-primary hover:underline cursor-pointer"
                            onClick={() => setEditing({ ...c })}
                          >
                            Edit
                          </button>
                          <button
                            className="text-xs text-loss-primary hover:underline cursor-pointer"
                            onClick={() => deleteConfig(c.id)}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent alerts */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Recent Alerts</h3>
            <Button size="sm" variant="ghost" onClick={reload}>Refresh</Button>
          </div>
        </CardHeader>
        <CardContent>
          {alerts.length === 0 ? (
            <p className="text-xs text-text-tertiary">No alerts received yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-text-tertiary border-b border-border-primary">
                  <tr>
                    <th className="text-left py-2 px-2">Time</th>
                    <th className="text-left py-2 px-2">Symbol</th>
                    <th className="text-left py-2 px-2">Dir</th>
                    <th className="text-left py-2 px-2">Status</th>
                    <th className="text-right py-2 px-2">Entry</th>
                    <th className="text-right py-2 px-2">SL</th>
                    <th className="text-right py-2 px-2">TP</th>
                    <th className="text-right py-2 px-2">Lots</th>
                    <th className="text-right py-2 px-2">Lat (ms)</th>
                    <th className="text-left py-2 px-2">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map((a) => (
                    <tr key={a.id} className="border-b border-border-primary hover:bg-bg-tertiary/40">
                      <td className="py-2 px-2 text-text-tertiary whitespace-nowrap">
                        {new Date(a.receivedAt).toLocaleString()}
                      </td>
                      <td className="py-2 px-2 font-mono text-text-primary">{a.tvSymbol}</td>
                      <td className="py-2 px-2 font-mono">
                        <span className={a.direction === 'LONG' ? 'text-profit-primary' : 'text-loss-primary'}>
                          {a.direction}
                        </span>
                      </td>
                      <td className="py-2 px-2"><StatusBadge status={a.status} /></td>
                      <td className="py-2 px-2 text-right font-mono">{a.entryPrice?.toFixed(4) ?? '—'}</td>
                      <td className="py-2 px-2 text-right font-mono">{a.stopLoss?.toFixed(4) ?? '—'}</td>
                      <td className="py-2 px-2 text-right font-mono">{a.takeProfit?.toFixed(4) ?? '—'}</td>
                      <td className="py-2 px-2 text-right font-mono">{a.lotSize?.toFixed(2) ?? '—'}</td>
                      <td className="py-2 px-2 text-right font-mono text-text-tertiary">{a.totalLatencyMs ?? '—'}</td>
                      <td className="py-2 px-2 text-xs text-text-tertiary max-w-xs truncate" title={a.errorMessage ?? a.metaapiOrderId ?? ''}>
                        {a.errorMessage ?? (a.metaapiOrderId ? `Order: ${a.metaapiOrderId.slice(0, 12)}` : '')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {editing && (
        <ConfigEditor
          initial={editing}
          accounts={accounts}
          onCancel={() => setEditing(null)}
          onSave={saveConfig}
        />
      )}
    </div>
  );
}

// ─── Status Badge ─────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'sent':      return <Badge variant="profit">Sent</Badge>;
    case 'dry_run':   return <Badge variant="warning">Dry</Badge>;
    case 'rejected':  return <Badge variant="loss">Rejected</Badge>;
    case 'error':     return <Badge variant="loss">Error</Badge>;
    case 'duplicate': return <Badge>Dup</Badge>;
    default:          return <Badge>{status}</Badge>;
  }
}

// ─── Config Editor Modal ──────────────────────────────

function ConfigEditor({
  initial,
  accounts,
  onCancel,
  onSave,
}: {
  initial: Partial<TvAlertConfigRow>;
  accounts: TradingAccount[];
  onCancel: () => void;
  onSave: (form: Partial<TvAlertConfigRow>) => Promise<void>;
}) {
  const [form, setForm] = useState<Partial<TvAlertConfigRow>>(initial);
  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const set = <K extends keyof TvAlertConfigRow>(k: K, v: TvAlertConfigRow[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  // Auto-apply symbol defaults when tvSymbol changes
  function handleSymbolChange(sym: string) {
    set('tvSymbol', sym);
    const defaults = SYMBOL_DEFAULTS[sym];
    if (defaults) {
      set('fusionSymbol', defaults.fusionSymbol);
      if (!initial.id) set('rewardRiskRatio', defaults.rewardRiskRatio);
    }
  }

  async function handleSubmit() {
    if (!form.accountId) return;
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-bg-secondary border border-border-primary rounded-[var(--radius-md)] max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-4 border-b border-border-primary flex items-center justify-between">
          <h2 className="text-base font-medium">
            {initial.id ? `Edit ${initial.tvSymbol} config` : 'New TradingView Config'}
          </h2>
          <button onClick={onCancel} className="text-text-tertiary hover:text-text-primary cursor-pointer">✕</button>
        </div>

        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="TradingView Symbol"
              value={form.tvSymbol ?? 'XBRUSD'}
              onChange={(e) => handleSymbolChange(e.target.value)}
              options={TV_SYMBOLS.map((s) => ({ value: s, label: s }))}
            />
            <Input
              label="FusionMarkets Symbol"
              value={form.fusionSymbol ?? ''}
              onChange={(e) => set('fusionSymbol', e.target.value.toUpperCase())}
            />
          </div>

          <Select
            label="Trading Account"
            value={form.accountId ?? ''}
            onChange={(e) => set('accountId', e.target.value)}
            options={[
              { value: '', label: 'Select account...' },
              ...accounts.map((a) => ({
                value: a.id,
                label: `${a.name} (${a.platform})${a.accessMode !== 'trading' ? ' — read-only' : ''}`,
              })),
            ]}
          />

          <div className="flex gap-6 items-center">
            <Toggle
              label="Enabled"
              checked={!!form.isEnabled}
              onChange={(v) => set('isEnabled', v)}
              active="bg-profit-primary"
            />
            <Toggle
              label="Dry Run"
              checked={!!form.dryRun}
              onChange={(v) => set('dryRun', v)}
              active="bg-warning"
            />
          </div>

          {form.isEnabled && !form.dryRun && (
            <div className="bg-loss-bg border border-loss-border rounded-[var(--radius-md)] p-3">
              <p className="text-xs text-loss-primary font-medium">
                LIVE MODE — Real orders will be placed on this account when this alert fires.
              </p>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <NumberInput label="Risk %"    value={form.riskPercent}     onChange={(v) => set('riskPercent', v)}     step={0.5} />
            <NumberInput label="RR Ratio"  value={form.rewardRiskRatio} onChange={(v) => set('rewardRiskRatio', v)} step={0.5} />
            <NumberInput label="SL Pips"   value={form.slPipOffset}     onChange={(v) => set('slPipOffset', v)}     step={1} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <NumberInput label="Max Lots"           value={form.maxLotSize}         onChange={(v) => set('maxLotSize', v)} />
            <NumberInput label="Min Stop (pips)"    value={form.minStopDistancePips} onChange={(v) => set('minStopDistancePips', v)} />
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced((s) => !s)}
            className="text-xs text-accent-primary hover:underline cursor-pointer"
          >
            {showAdvanced ? '− Hide' : '+ Show'} advanced
          </button>

          {showAdvanced && (
            <div className="space-y-3 border-t border-border-primary pt-3">
              <Select
                label="Sizing Mode"
                value={form.sizingMode ?? 'percent_equity'}
                onChange={(e) => set('sizingMode', e.target.value as TvAlertConfigRow['sizingMode'])}
                options={[
                  { value: 'percent_equity',  label: '% of Account Equity (recommended)' },
                  { value: 'percent_balance', label: '% of Account Balance' },
                  { value: 'strict',          label: 'Strict Lot Sizing' },
                ]}
              />

              {form.sizingMode === 'strict' && (
                <NumberInput label="Strict Lots" value={form.strictLots} onChange={(v) => set('strictLots', v)} step={0.01} />
              )}

              <div className="grid grid-cols-2 gap-3">
                <NumberInput label="Pip Size"          value={form.pipSize}        onChange={(v) => set('pipSize', v)}        step={0.0001} />
                <NumberInput label="Pip Value / Lot ($)" value={form.pipValuePerLot} onChange={(v) => set('pipValuePerLot', v)} step={0.01} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <NumberInput label="Max Risk %"        value={form.maxRiskPercent} onChange={(v) => set('maxRiskPercent', v)} step={0.5} />
                <NumberInput label="Max Lots / Order" value={form.maxLotsPerOrder} onChange={(v) => set('maxLotsPerOrder', Math.min(v, 100))} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <NumberInput label="Min Lot Size" value={form.minLotSize} onChange={(v) => set('minLotSize', v)} step={0.01} />
                <NumberInput label="Lot Step"     value={form.lotStep}    onChange={(v) => set('lotStep', v)}    step={0.01} />
              </div>

              <NumberInput label="Max Slippage (pts)" value={form.maxSlippage} onChange={(v) => set('maxSlippage', v)} step={0.5} />
              <NumberInput label="Max Offset Abs (price units)" value={form.maxOffsetAbs} onChange={(v) => set('maxOffsetAbs', v)} step={0.5} />

              <div className="grid grid-cols-2 gap-3">
                <NumberInput label="Margin Warn %"   value={form.marginWarningThreshold} onChange={(v) => set('marginWarningThreshold', v)} />
                <NumberInput label="Margin Reject %" value={form.marginRejectThreshold}  onChange={(v) => set('marginRejectThreshold', v)} />
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border-primary flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button size="sm" onClick={handleSubmit} loading={saving} disabled={!form.accountId}>
            {initial.id ? 'Save' : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Shared ───────────────────────────────────────────

function NumberInput({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <Input
      label={label}
      type="number"
      value={value ?? ''}
      step={step}
      onChange={(e) => {
        const v = e.target.value;
        if (v === '' || v === '-') return;
        const n = parseFloat(v);
        if (!isNaN(n)) onChange(n);
      }}
      className="font-mono"
    />
  );
}

function Toggle({
  label,
  checked,
  onChange,
  active,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  active: string;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
          checked ? active : 'bg-bg-tertiary'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
      <span className="text-sm font-medium text-text-secondary">{label}</span>
    </label>
  );
}
