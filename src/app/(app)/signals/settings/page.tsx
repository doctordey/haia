'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/useToast';
import { useSignalConfigStore, type SignalConfigForm } from '@/stores/signalConfigStore';

// ─── Types ────────────────────────────────────────────

interface TelegramSource {
  id: string;
  name: string;
  telegramChannelId: string | null;
  telegramChannelName: string | null;
  telegramPhone: string | null;
  telegramStatus: string;
  isActive: boolean;
}

interface TradingAccount {
  id: string;
  name: string;
  platform: string;
  broker: string | null;
  accessMode: string;
}

// ─── Main Page ────────────────────────────────────────

export default function SignalSettingsPage() {
  const { toast } = useToast();
  const { form, loaded, dirty, setField, loadFromServer } = useSignalConfigStore();
  const [saving, setSaving] = useState(false);
  const [sources, setSources] = useState<TelegramSource[]>([]);
  const [accounts, setAccounts] = useState<TradingAccount[]>([]);
  const [configId, setConfigId] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [allConfigs, setAllConfigs] = useState<Record<string, { id: string; isEnabled: boolean; dryRun: boolean }>>({});

  // Load sources, accounts, and all configs on mount
  useEffect(() => {
    Promise.all([
      fetch('/api/signals/config').then((r) => r.json()),
      fetch('/api/signals/sources').then((r) => r.json()),
      fetch('/api/accounts').then((r) => r.json()),
    ]).then(([configs, srcs, accts]) => {
      setSources(Array.isArray(srcs) ? srcs : []);
      const acctList = Array.isArray(accts) ? accts : [];
      setAccounts(acctList);

      // Build config lookup by accountId
      const configMap: Record<string, { id: string; isEnabled: boolean; dryRun: boolean }> = {};
      const configArr = Array.isArray(configs) ? configs : configs ? [configs] : [];
      for (const c of configArr) {
        if (c?.accountId) configMap[c.accountId] = { id: c.id, isEnabled: c.isEnabled, dryRun: c.dryRun };
      }
      setAllConfigs(configMap);

      // Auto-select first account and load its config
      if (acctList.length > 0) {
        const firstId = acctList[0].id;
        setSelectedAccountId(firstId);
        const existing = configArr.find((c: Record<string, unknown>) => c?.accountId === firstId);
        if (existing) {
          loadFromServer(existing);
          setConfigId(existing.id);
        } else {
          loadFromServer({ accountId: firstId });
        }
      } else {
        loadFromServer({});
      }
    }).catch(() => toast('Failed to load settings', 'error'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When selected account changes, load that account's config
  const handleAccountSwitch = useCallback(async (accountId: string) => {
    setSelectedAccountId(accountId);
    try {
      const res = await fetch(`/api/signals/config?accountId=${accountId}`);
      const config = await res.json();
      if (config) {
        loadFromServer(config);
        setConfigId(config.id);
      } else {
        loadFromServer({ accountId });
        setConfigId(null);
      }
    } catch {
      loadFromServer({ accountId });
      setConfigId(null);
    }
  }, [loadFromServer]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/signals/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, accountId: selectedAccountId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to save');
      }
      const updated = await res.json();
      loadFromServer(updated);
      setConfigId(updated.id);
      setAllConfigs((prev) => ({ ...prev, [selectedAccountId]: { id: updated.id, isEnabled: updated.isEnabled, dryRun: updated.dryRun } }));
      toast('Settings saved', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }, [form, selectedAccountId, loadFromServer, toast]);

  const handleToggle = useCallback(async (field: 'isEnabled' | 'dryRun', value: boolean) => {
    if (!configId) { toast('Save settings first', 'error'); return; }
    try {
      const res = await fetch('/api/signals/config/toggle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configId, field, value }),
      });
      if (!res.ok) throw new Error('Toggle failed');
      setField(field, value);
      setAllConfigs((prev) => ({ ...prev, [selectedAccountId]: { ...prev[selectedAccountId], [field]: value } }));
      toast(`${field === 'isEnabled' ? 'Pipeline' : 'Dry run'} ${value ? 'enabled' : 'disabled'}`, 'success');
    } catch {
      toast('Toggle failed', 'error');
    }
  }, [configId, selectedAccountId, setField, toast]);

  if (!loaded) {
    return (
      <div className="p-4 max-w-4xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-bg-secondary rounded w-48" />
          <div className="h-40 bg-bg-secondary rounded" />
          <div className="h-40 bg-bg-secondary rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-4xl mx-auto space-y-4 pb-24">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Signal Settings</h1>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-xs text-warning">Unsaved changes</span>}
          <Button onClick={handleSave} loading={saving} disabled={!dirty} size="sm">
            Save Settings
          </Button>
        </div>
      </div>

      {/* Account selector + overview */}
      {accounts.length > 1 && (
        <Card>
          <CardHeader><h3 className="text-sm font-medium">Accounts</h3></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {accounts.map((acct) => {
                const cfg = allConfigs[acct.id];
                const isSelected = selectedAccountId === acct.id;
                return (
                  <button
                    key={acct.id}
                    onClick={() => handleAccountSwitch(acct.id)}
                    className={`px-3 py-2 rounded-[var(--radius-md)] text-sm border transition-colors cursor-pointer flex items-center gap-2 ${
                      isSelected
                        ? 'border-accent-primary bg-accent-primary/10 text-text-primary'
                        : 'border-border-primary bg-bg-tertiary text-text-secondary hover:border-border-secondary'
                    }`}
                  >
                    <span>{acct.name}</span>
                    {cfg?.isEnabled && !cfg.dryRun && <Badge variant="profit">Live</Badge>}
                    {cfg?.isEnabled && cfg.dryRun && <Badge variant="warning">Dry</Badge>}
                    {cfg && !cfg.isEnabled && <Badge>Off</Badge>}
                    {!cfg && <Badge variant="default">New</Badge>}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-text-tertiary">Each account has its own sizing, execution mode, and enable/disable toggle.</p>
          </CardContent>
        </Card>
      )}

      <MasterControls
        form={form}
        configId={configId}
        onToggle={handleToggle}
      />

      <TelegramSection
        sources={sources}
        setSources={setSources}
        accounts={accounts}
        form={form}
        setField={setField}
        toast={toast}
      />

      <OffsetSection form={form} setField={setField} />

      <SizingSection form={form} setField={setField} />

      <ExecutionSection form={form} setField={setField} />

      <InstrumentSection form={form} setField={setField} />

      <OrderSection form={form} setField={setField} />

      {/* Bottom save bar */}
      {dirty && (
        <div className="fixed bottom-0 left-0 right-0 bg-bg-secondary border-t border-border-primary p-3 flex justify-end z-50">
          <Button onClick={handleSave} loading={saving} size="sm">
            Save Settings
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Master Controls ──────────────────────────────────

function MasterControls({
  form,
  configId,
  onToggle,
}: {
  form: SignalConfigForm;
  configId: string | null;
  onToggle: (field: 'isEnabled' | 'dryRun', value: boolean) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Pipeline Control</h3>
          {!configId && <Badge variant="warning">Not configured</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Pipeline Enabled</p>
            <p className="text-xs text-text-tertiary">When enabled, incoming signals will be processed</p>
          </div>
          <ToggleSwitch
            checked={form.isEnabled}
            onChange={(v) => onToggle('isEnabled', v)}
            disabled={!configId}
            activeColor="bg-profit-primary"
          />
        </div>

        <div className="border-t border-border-primary pt-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Dry Run Mode</p>
            <p className="text-xs text-text-tertiary">Simulates execution without placing real orders</p>
          </div>
          <ToggleSwitch
            checked={form.dryRun}
            onChange={(v) => onToggle('dryRun', v)}
            disabled={!configId}
            activeColor="bg-warning"
          />
        </div>

        {form.isEnabled && !form.dryRun && (
          <div className="bg-loss-bg border border-loss-border rounded-[var(--radius-md)] p-3">
            <p className="text-xs text-loss-primary font-medium">LIVE MODE — Real orders will be placed on your trading account</p>
          </div>
        )}

        {form.isEnabled && form.dryRun && (
          <div className="bg-[#FFB34715] border border-[#FFB34730] rounded-[var(--radius-md)] p-3">
            <p className="text-xs text-warning font-medium">DRY RUN — Signals are processed but no orders are placed</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Telegram Section ─────────────────────────────────

function TelegramSection({
  sources,
  setSources,
  accounts,
  form,
  setField,
  toast,
}: {
  sources: TelegramSource[];
  setSources: (s: TelegramSource[]) => void;
  accounts: TradingAccount[];
  form: SignalConfigForm;
  setField: <K extends keyof SignalConfigForm>(key: K, value: SignalConfigForm[K]) => void;
  toast: (msg: string, type?: string) => void;
}) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [phoneCodeHash, setPhoneCodeHash] = useState('');
  const [authStep, setAuthStep] = useState<'idle' | 'code_sent' | 'verifying' | 'needs_2fa'>('idle');
  const [loading, setLoading] = useState(false);
  const [newSourceName, setNewSourceName] = useState('');
  const [channelId, setChannelId] = useState('');
  const [showAddSource, setShowAddSource] = useState(sources.length === 0);

  const activeSource = sources.find((s) => s.id === form.sourceId);

  async function handleCreateSource() {
    if (!newSourceName.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/api/signals/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newSourceName,
          priceFeed: 'CME',
          telegramChannelId: channelId || null,
          telegramChannelName: newSourceName,
        }),
      });
      if (!res.ok) throw new Error('Failed to create source');
      const source = await res.json();
      setSources([...sources, source]);
      setField('sourceId', source.id);
      setNewSourceName('');
      setChannelId('');
      setShowAddSource(false);
      toast('Source created', 'success');
    } catch {
      toast('Failed to create source', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleSendCode() {
    if (!phone || !form.sourceId) return;
    setLoading(true);
    try {
      const res = await fetch('/api/signals/telegram/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, sourceId: form.sourceId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPhoneCodeHash(data.phoneCodeHash);
      setAuthStep('code_sent');
      toast('Code sent to your Telegram', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to send code', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(with2FA = false) {
    if (!code && !with2FA) return;
    if (with2FA && !password) return;
    setLoading(true);
    try {
      const res = await fetch('/api/signals/telegram/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          phoneCodeHash,
          sourceId: form.sourceId,
          ...(with2FA ? { password } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.requires2FA) {
          setAuthStep('needs_2fa');
          toast('2FA password required', 'info');
          return;
        }
        throw new Error(data.error);
      }
      setAuthStep('idle');
      setPassword('');
      toast('Telegram connected!', 'success');
      const srcs = await fetch('/api/signals/sources').then((r) => r.json());
      setSources(srcs);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Verification failed', 'error');
      if (authStep !== 'needs_2fa') setAuthStep('code_sent');
    } finally {
      setLoading(false);
    }
  }

  const statusBadge = activeSource?.telegramStatus === 'connected'
    ? <Badge variant="profit">Connected</Badge>
    : activeSource?.telegramStatus === 'awaiting_code'
    ? <Badge variant="warning">Awaiting Code</Badge>
    : <Badge>Disconnected</Badge>;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Telegram Connection</h3>
          {activeSource && statusBadge}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Source selector */}
        {sources.length > 0 && (
          <Select
            label="Signal Source"
            value={form.sourceId}
            onChange={(e) => setField('sourceId', e.target.value)}
            options={[
              { value: '', label: 'Select a source...' },
              ...sources.map((s) => ({ value: s.id, label: `${s.name}${s.telegramStatus === 'connected' ? ' (connected)' : ''}` })),
            ]}
          />
        )}

        {/* Add new source */}
        {!showAddSource && (
          <button
            onClick={() => setShowAddSource(true)}
            className="text-xs text-accent-primary hover:underline cursor-pointer"
          >
            + Add new signal source
          </button>
        )}
        {showAddSource && (
          <div className="space-y-3 border border-border-primary rounded-[var(--radius-md)] p-3">
            <p className="text-xs text-text-secondary font-medium">New Signal Source</p>
            <div className="flex gap-2">
              <Input
                placeholder="Source name (e.g. NQ/ES Signals)"
                value={newSourceName}
                onChange={(e) => setNewSourceName(e.target.value)}
              />
              <Input
                placeholder="Telegram Channel ID"
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleCreateSource} loading={loading}>Create Source</Button>
              <Button size="sm" variant="ghost" onClick={() => setShowAddSource(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Auth flow */}
        {form.sourceId && activeSource?.telegramStatus !== 'connected' && (
          <div className="border-t border-border-primary pt-4 space-y-3">
            <p className="text-xs text-text-secondary">Connect your Telegram account to receive signals.</p>
            {authStep === 'idle' && (
              <div className="flex gap-2 items-end">
                <Input
                  label="Phone Number"
                  placeholder="+1234567890"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
                <Button size="sm" onClick={handleSendCode} loading={loading}>Send Code</Button>
              </div>
            )}
            {(authStep === 'code_sent' || authStep === 'verifying') && (
              <div className="flex gap-2 items-end">
                <Input
                  label="Verification Code"
                  placeholder="12345"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
                <Button size="sm" onClick={() => handleVerify(false)} loading={loading}>Verify</Button>
              </div>
            )}
            {authStep === 'needs_2fa' && (
              <div className="space-y-3">
                <div className="bg-[#FFB34715] border border-[#FFB34730] rounded-[var(--radius-md)] p-3">
                  <p className="text-xs text-warning font-medium">Your Telegram account has 2FA enabled. Enter your cloud password to continue.</p>
                </div>
                <div className="flex gap-2 items-end">
                  <Input
                    label="2FA Password"
                    type="password"
                    placeholder="Your Telegram cloud password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <Button size="sm" onClick={() => handleVerify(true)} loading={loading}>Submit</Button>
                </div>
              </div>
            )}
          </div>
        )}

        {activeSource?.telegramStatus === 'connected' && (
          <div className="text-xs text-text-tertiary">
            Connected to channel: <span className="text-text-primary">{activeSource.telegramChannelName || activeSource.telegramChannelId || 'Unknown'}</span>
          </div>
        )}

        {/* Account selector */}
        <Select
          label="Trading Account"
          value={form.accountId}
          onChange={(e) => setField('accountId', e.target.value)}
          options={[
            { value: '', label: 'Select account...' },
            ...accounts.map((a) => ({
              value: a.id,
              label: `${a.name} (${a.platform}) — ${a.accessMode === 'trading' ? 'Trading' : 'Read-Only'}`,
            })),
          ]}
        />
        <AccountAccessWarning
          account={accounts.find((a) => a.id === form.accountId)}
          toast={toast}
        />
      </CardContent>
    </Card>
  );
}

// ─── Offset Section ───────────────────────────────────

function OffsetSection({
  form,
  setField,
}: {
  form: SignalConfigForm;
  setField: <K extends keyof SignalConfigForm>(key: K, value: SignalConfigForm[K]) => void;
}) {
  const [offsetStatus, setOffsetStatus] = useState<{
    nqOffset?: number;
    esOffset?: number;
    receivedAt?: string;
    age?: string;
  } | null>(null);

  useEffect(() => {
    fetch('/api/signals/offset/current')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setOffsetStatus(data);
      })
      .catch(() => {});
  }, []);

  return (
    <Card>
      <CardHeader><h3 className="text-sm font-medium">Offset Settings</h3></CardHeader>
      <CardContent className="space-y-4">
        <Select
          label="Offset Mode"
          value={form.offsetMode}
          onChange={(e) => setField('offsetMode', e.target.value)}
          options={[
            { value: 'webhook', label: 'Webhook (TradingView) — recommended' },
            { value: 'fixed', label: 'Fixed Values' },
            { value: 'none', label: 'None (no offset)' },
          ]}
        />

        {form.offsetMode === 'webhook' && (
          <div className="bg-bg-tertiary rounded-[var(--radius-md)] p-3 space-y-2">
            <p className="text-xs font-medium text-text-secondary">Webhook Status</p>
            {offsetStatus ? (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>NQ Offset: <span className="text-text-primary font-mono">{offsetStatus.nqOffset?.toFixed(2) ?? '—'}</span></div>
                <div>ES Offset: <span className="text-text-primary font-mono">{offsetStatus.esOffset?.toFixed(2) ?? '—'}</span></div>
                <div className="col-span-2 text-text-tertiary">Age: {offsetStatus.age ?? 'Unknown'}</div>
              </div>
            ) : (
              <div className="text-xs text-text-tertiary">
                No webhook data received yet. Configure the TradingView Pine Script indicator to send data to:
                <code className="block mt-1 p-2 bg-bg-primary rounded text-text-secondary break-all">
                  {typeof window !== 'undefined' ? `${window.location.origin}/api/signals/offset/webhook` : '/api/signals/offset/webhook'}
                </code>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <NumberInput label="NQ Fixed Offset" value={form.nqFixedOffset} onChange={(v) => setField('nqFixedOffset', v)} />
          <NumberInput label="ES Fixed Offset" value={form.esFixedOffset} onChange={(v) => setField('esFixedOffset', v)} />
        </div>

        <p className="text-xs text-text-tertiary">Safety bounds — pipeline rejects offsets outside these ranges</p>
        <div className="grid grid-cols-2 gap-3">
          <NumberInput label="NQ Min Offset" value={form.nqMinOffset} onChange={(v) => setField('nqMinOffset', v)} />
          <NumberInput label="NQ Max Offset" value={form.nqMaxOffset} onChange={(v) => setField('nqMaxOffset', v)} />
          <NumberInput label="ES Min Offset" value={form.esMinOffset} onChange={(v) => setField('esMinOffset', v)} />
          <NumberInput label="ES Max Offset" value={form.esMaxOffset} onChange={(v) => setField('esMaxOffset', v)} />
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Position Sizing Section ──────────────────────────

function SizingSection({
  form,
  setField,
}: {
  form: SignalConfigForm;
  setField: <K extends keyof SignalConfigForm>(key: K, value: SignalConfigForm[K]) => void;
}) {
  // Live preview calculation
  const previewEntry = 24060;
  const previewSl = 24020;
  const stopDist = Math.abs(previewEntry - previewSl);
  let previewLots = 0;
  let previewReason = '';

  if (form.sizingMode === 'strict') {
    previewLots = form.nqMediumLots;
    previewReason = `Strict: Medium → ${previewLots} lots`;
  } else {
    const base = 10000;
    const risk = base * (form.baseRiskPercent * form.mediumMultiplier / 100);
    previewLots = Math.floor((risk / (stopDist * 1.00)) * 100) / 100;
    previewLots = Math.min(previewLots, form.maxLotSize);
    previewReason = `${form.baseRiskPercent}% × 1.0 of $${base} = $${risk.toFixed(0)} risk / ${stopDist}pt stop = ${previewLots} lots`;
  }

  return (
    <Card>
      <CardHeader><h3 className="text-sm font-medium">Position Sizing</h3></CardHeader>
      <CardContent className="space-y-4">
        <Select
          label="Sizing Mode"
          value={form.sizingMode}
          onChange={(e) => setField('sizingMode', e.target.value)}
          options={[
            { value: 'strict', label: 'Strict Lot Sizing — fixed lots per size tier' },
            { value: 'percent_balance', label: '% of Account Balance' },
            { value: 'percent_equity', label: '% of Account Equity' },
          ]}
        />

        {form.sizingMode === 'strict' ? (
          <div className="space-y-3">
            <p className="text-xs text-text-secondary">NQ Lot Sizes</p>
            <div className="grid grid-cols-3 gap-3">
              <NumberInput label="Small" value={form.nqSmallLots} onChange={(v) => setField('nqSmallLots', v)} step={0.01} />
              <NumberInput label="Medium" value={form.nqMediumLots} onChange={(v) => setField('nqMediumLots', v)} step={0.01} />
              <NumberInput label="Large" value={form.nqLargeLots} onChange={(v) => setField('nqLargeLots', v)} step={0.01} />
            </div>
            <p className="text-xs text-text-secondary">ES Lot Sizes</p>
            <div className="grid grid-cols-3 gap-3">
              <NumberInput label="Small" value={form.esSmallLots} onChange={(v) => setField('esSmallLots', v)} step={0.01} />
              <NumberInput label="Medium" value={form.esMediumLots} onChange={(v) => setField('esMediumLots', v)} step={0.01} />
              <NumberInput label="Large" value={form.esLargeLots} onChange={(v) => setField('esLargeLots', v)} step={0.01} />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <NumberInput label="Base Risk %" value={form.baseRiskPercent} onChange={(v) => setField('baseRiskPercent', v)} step={0.1} />
              <NumberInput label="Max Risk %" value={form.maxRiskPercent} onChange={(v) => setField('maxRiskPercent', v)} step={0.1} />
            </div>
            <p className="text-xs text-text-secondary">Size Tier Multipliers</p>
            <div className="grid grid-cols-3 gap-3">
              <NumberInput label="Small" value={form.smallMultiplier} onChange={(v) => setField('smallMultiplier', v)} step={0.1} />
              <NumberInput label="Medium" value={form.mediumMultiplier} onChange={(v) => setField('mediumMultiplier', v)} step={0.1} />
              <NumberInput label="Large" value={form.largeMultiplier} onChange={(v) => setField('largeMultiplier', v)} step={0.1} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <NumberInput label="Max Lot Size" value={form.maxLotSize} onChange={(v) => setField('maxLotSize', v)} step={0.01} />
              <NumberInput label="Min Stop Distance (pts)" value={form.minStopDistance} onChange={(v) => setField('minStopDistance', v)} />
            </div>
          </div>
        )}

        {/* Live preview */}
        <div className="bg-bg-tertiary rounded-[var(--radius-md)] p-3">
          <p className="text-xs text-text-tertiary mb-1">Preview: LONG NQ @ 24,060, SL: 24,020 (40pt stop), Size: Medium</p>
          <p className="text-xs text-text-primary font-mono">{previewReason}</p>
          <p className="text-sm font-medium text-text-primary mt-1">{previewLots} lots</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Execution Mode Section ───────────────────────────

function ExecutionSection({
  form,
  setField,
}: {
  form: SignalConfigForm;
  setField: <K extends keyof SignalConfigForm>(key: K, value: SignalConfigForm[K]) => void;
}) {
  // Calculate split preview
  let previewLots = form.sizingMode === 'strict' ? form.nqMediumLots : 0.05;
  const step = 0.01;
  const tp1 = parseFloat((Math.ceil((previewLots / 2) / step) * step).toFixed(2));
  const tp2 = parseFloat((previewLots - tp1).toFixed(2));

  return (
    <Card>
      <CardHeader><h3 className="text-sm font-medium">Execution Mode</h3></CardHeader>
      <CardContent className="space-y-4">
        <Select
          label="Execution Mode"
          value={form.executionMode}
          onChange={(e) => setField('executionMode', e.target.value)}
          options={[
            { value: 'single', label: 'Single Position — one order per signal' },
            { value: 'split_target', label: 'Split Target — TP1 + TP2 positions' },
          ]}
        />

        {form.executionMode === 'split_target' && (
          <>
            <div className="bg-bg-tertiary rounded-[var(--radius-md)] p-3 text-xs text-text-secondary space-y-1">
              <p>Opens <span className="text-text-primary">two positions</span> per signal. TP1 gets the larger lot.</p>
              <p>When TP1 hits, TP2&apos;s stop loss automatically moves to entry (breakeven).</p>
            </div>
            <div className="bg-bg-tertiary rounded-[var(--radius-md)] p-3">
              <p className="text-xs text-text-tertiary mb-1">Split Preview (Medium lot):</p>
              <p className="text-sm font-mono text-text-primary">
                {previewLots} total → TP1: {tp1}, TP2: {tp2 >= 0.01 ? tp2 : <span className="text-warning">cannot split (fallback to single)</span>}
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Instrument Section ───────────────────────────────

function InstrumentSection({
  form,
  setField,
}: {
  form: SignalConfigForm;
  setField: <K extends keyof SignalConfigForm>(key: K, value: SignalConfigForm[K]) => void;
}) {
  return (
    <Card>
      <CardHeader><h3 className="text-sm font-medium">Instrument Mapping</h3></CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="NQ Execution Symbol"
            value={form.nqSymbol}
            onChange={(e) => setField('nqSymbol', e.target.value)}
            placeholder="NAS100"
          />
          <Input
            label="ES Execution Symbol"
            value={form.esSymbol}
            onChange={(e) => setField('esSymbol', e.target.value)}
            placeholder="US500"
          />
        </div>
        <p className="text-xs text-text-tertiary mt-2">
          The Fusion Markets symbol to execute on. NQ signals → NAS100, ES signals → US500.
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Order Settings Section ───────────────────────────

function OrderSection({
  form,
  setField,
}: {
  form: SignalConfigForm;
  setField: <K extends keyof SignalConfigForm>(key: K, value: SignalConfigForm[K]) => void;
}) {
  return (
    <Card>
      <CardHeader><h3 className="text-sm font-medium">Order Settings</h3></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <NumberInput
            label="Market Order Threshold (pts)"
            value={form.marketOrderThreshold}
            onChange={(v) => setField('marketOrderThreshold', v)}
            step={0.5}
          />
          <NumberInput
            label="Max Slippage (pts)"
            value={form.maxSlippage}
            onChange={(v) => setField('maxSlippage', v)}
            step={0.5}
          />
        </div>

        <div>
          <NumberInput
            label="Max Lots Per Order"
            value={form.maxLotsPerOrder}
            onChange={(v) => setField('maxLotsPerOrder', Math.min(v, 100))}
          />
          <p className="text-xs text-text-tertiary mt-1">
            Orders exceeding this size are automatically chunked. Hard cap: 100 lots.
          </p>
        </div>

        <div className="border-t border-border-primary pt-4">
          <p className="text-xs text-text-secondary mb-3">Margin Safety</p>
          <div className="grid grid-cols-2 gap-3">
            <NumberInput
              label="Warning Threshold %"
              value={form.marginWarningThreshold}
              onChange={(v) => setField('marginWarningThreshold', v)}
            />
            <NumberInput
              label="Reject Threshold %"
              value={form.marginRejectThreshold}
              onChange={(v) => setField('marginRejectThreshold', v)}
            />
          </div>
          <p className="text-xs text-text-tertiary mt-2">
            Warns at {form.marginWarningThreshold}% margin utilization. Rejects trades above {form.marginRejectThreshold}%.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Account Access Warning ───────────────────────────

function AccountAccessWarning({
  account,
  toast,
}: {
  account: TradingAccount | undefined;
  toast: (msg: string, type?: string) => void;
}) {
  const [password, setPassword] = useState('');
  const [upgrading, setUpgrading] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);

  if (!account || account.accessMode === 'trading') return null;

  async function handleUpgrade() {
    if (!password) return;
    setUpgrading(true);
    try {
      const res = await fetch(`/api/accounts/${account!.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tradingPassword: password }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Upgrade failed');
      }
      toast('Account upgraded to trading access', 'success');
      setShowUpgrade(false);
      setPassword('');
      // Reload the page to refresh account data
      window.location.reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Upgrade failed', 'error');
    } finally {
      setUpgrading(false);
    }
  }

  return (
    <div className="bg-[#FFB34715] border border-[#FFB34730] rounded-[var(--radius-md)] p-3 space-y-2">
      <p className="text-xs text-warning font-medium">
        This account is connected with a read-only (investor) password. The Signal Copier needs a trading password to place orders.
      </p>
      {!showUpgrade ? (
        <button
          onClick={() => setShowUpgrade(true)}
          className="text-xs text-accent-primary hover:underline cursor-pointer"
        >
          Upgrade to trading access
        </button>
      ) : (
        <div className="flex gap-2 items-end">
          <Input
            label="Trading Password"
            type="password"
            placeholder="Your MT trading password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button size="sm" onClick={handleUpgrade} loading={upgrading}>Upgrade</Button>
        </div>
      )}
    </div>
  );
}

// ─── Shared Components ────────────────────────────────

function NumberInput({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <Input
      label={label}
      type="number"
      value={value}
      step={step}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      className="font-mono"
    />
  );
}

function ToggleSwitch({
  checked,
  onChange,
  disabled,
  activeColor = 'bg-accent-primary',
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  activeColor?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
        disabled ? 'opacity-50 cursor-not-allowed' : ''
      } ${checked ? activeColor : 'bg-bg-tertiary'}`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}
