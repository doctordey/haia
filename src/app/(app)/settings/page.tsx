'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useAccounts } from '@/hooks/useAccounts';
import { useToast } from '@/hooks/useToast';
import { formatCurrency } from '@/lib/utils';

export default function SettingsPage() {
  const { accounts, refetch } = useAccounts();
  const { toast } = useToast();

  return (
    <div className="p-4 max-w-4xl mx-auto space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>

      <Tabs defaultValue="accounts">
        <TabsList>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="api">API</TabsTrigger>
          <TabsTrigger value="hitl">Trading</TabsTrigger>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="preferences">Preferences</TabsTrigger>
          <TabsTrigger value="data">Data</TabsTrigger>
        </TabsList>

        <TabsContent value="accounts" className="mt-4 space-y-4">
          <AccountsSection accounts={accounts} onRefetch={refetch} toast={toast} />
        </TabsContent>

        <TabsContent value="api" className="mt-4 space-y-4">
          <ApiKeysSection toast={toast} accounts={accounts} />
        </TabsContent>

        <TabsContent value="hitl" className="mt-4 space-y-4">
          <HitlAccessSection toast={toast} />
          <HitlRiskSection toast={toast} />
          <HitlExecutionSection toast={toast} />
          <HitlTargetsSection toast={toast} />
          <HitlMessagesSection toast={toast} />
          <HitlSection toast={toast} />
        </TabsContent>

        <TabsContent value="profile" className="mt-4 space-y-4">
          <ProfileSection toast={toast} />
        </TabsContent>

        <TabsContent value="preferences" className="mt-4 space-y-4">
          <PreferencesSection toast={toast} />
        </TabsContent>

        <TabsContent value="data" className="mt-4 space-y-4">
          <DataSection toast={toast} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AccountsSection({ accounts, onRefetch, toast }: { accounts: any[]; onRefetch: () => void; toast: (msg: string, type?: string) => void }) {
  const [syncing, setSyncing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [togglingHitl, setTogglingHitl] = useState<string | null>(null);
  // Per-account modals: which account + which action
  const [manage, setManage] = useState<{ account: any; mode: 'labels' | 'trade' | 'import' | 'exclusions' } | null>(null);
  const [riskInfo, setRiskInfo] = useState<{ mode: string; defaultValue: number; overrides: Record<string, number> } | null>(null);

  useEffect(() => {
    fetch('/api/hitl/account-risk').then((r) => (r.ok ? r.json() : null)).then((d) => d && setRiskInfo(d)).catch(() => {});
  }, []);

  async function saveRisk(id: string, raw: string) {
    const value = raw.trim() === '' ? null : Number(raw);
    if (value != null && !(Number.isFinite(value) && value > 0)) { toast('Risk must be a positive number', 'error'); return; }
    try {
      const res = await fetch('/api/hitl/account-risk', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: id, value }),
      });
      if (res.ok) {
        setRiskInfo((prev) => {
          if (!prev) return prev;
          const overrides = { ...prev.overrides };
          if (value == null) delete overrides[id]; else overrides[id] = value;
          return { ...prev, overrides };
        });
        toast('Account risk saved', 'success');
      } else { const d = await res.json().catch(() => ({})); toast(d.error || 'Failed to save risk', 'error'); }
    } catch { toast('Failed to save risk', 'error'); }
  }

  async function handleToggleHitl(id: string, next: boolean) {
    setTogglingHitl(id);
    try {
      const res = await fetch(`/api/accounts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hitlEnabled: next }),
      });
      if (res.ok) {
        toast(next ? 'Unicorn enabled for this account' : 'Unicorn disabled', 'success');
        onRefetch();
      } else {
        const data = await res.json().catch(() => ({}));
        toast(data.error || 'Failed to update Unicorn', 'error');
      }
    } catch { toast('Failed to update Unicorn', 'error'); }
    finally { setTogglingHitl(null); }
  }

  async function handleSync(id: string) {
    setSyncing(id);
    try {
      const res = await fetch(`/api/accounts/${id}/sync`, { method: 'POST' });
      if (res.ok) {
        toast('Sync started successfully', 'success');
        onRefetch();
      } else {
        toast('Sync failed', 'error');
      }
    } catch { toast('Sync failed', 'error'); }
    finally { setSyncing(null); }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      const res = await fetch(`/api/accounts/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast('Account disconnected', 'success');
        onRefetch();
      } else {
        toast('Failed to disconnect', 'error');
      }
    } catch { toast('Failed to disconnect', 'error'); }
    finally { setDeleting(null); }
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-text-secondary">Connected Accounts</h2>
        <a href="/connect" className="text-xs text-accent-primary hover:text-accent-hover transition-colors">+ Add Account</a>
      </div>

      {accounts.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm text-text-tertiary mb-3">No trading accounts connected</p>
            <a href="/connect" className="inline-flex items-center px-4 py-2 bg-accent-primary text-white rounded-[var(--radius-md)] text-sm font-medium hover:bg-accent-hover transition-colors">
              Connect Account
            </a>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {accounts.map((acc) => (
            <Card key={acc.id}>
              <CardContent className="py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Badge variant={acc.syncStatus === 'synced' ? 'profit' : acc.syncStatus === 'error' ? 'loss' : 'default'}>
                    {acc.platform}
                  </Badge>
                  <div>
                    <p className="text-sm font-medium text-text-primary">
                      {acc.labelName || acc.name}
                      {acc.labelName && <span className="text-text-tertiary font-normal"> ({acc.name})</span>}
                    </p>
                    <p className="text-xs text-text-tertiary">
                      {acc.server} · #{acc.labelLogin || acc.login}
                      {acc.lastSyncAt && ` · Last sync: ${new Date(acc.lastSyncAt).toLocaleString()}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {(acc.labelType || acc.accountType) && (
                    <Badge variant={(acc.labelType || acc.accountType) === 'live' ? 'profit' : 'default'}>
                      {acc.labelType || acc.accountType}
                    </Badge>
                  )}
                  {(acc.labelName || acc.labelLogin || acc.labelType) && <Badge variant="info">labeled</Badge>}
                  <Badge variant={acc.syncStatus === 'synced' ? 'profit' : acc.syncStatus === 'error' ? 'loss' : acc.syncStatus === 'syncing' ? 'info' : 'default'}>
                    {acc.syncStatus}
                  </Badge>
                  {acc.hitlEnabled && <Badge variant="info">Unicorn</Badge>}
                  {acc.hitlEnabled && (
                    <div className="flex items-center gap-1" title="Risk for this account. Blank = use the default. Set per-account to size this account differently.">
                      <span className="text-xs text-text-tertiary">{riskInfo?.mode === 'fixed' ? '$' : '%'}</span>
                      <input
                        key={`risk-${acc.id}-${riskInfo ? 'r' : 'l'}`}
                        type="number"
                        step="0.1"
                        defaultValue={riskInfo?.overrides?.[acc.id] ?? ''}
                        placeholder={riskInfo ? String(riskInfo.defaultValue) : ''}
                        onBlur={(e) => saveRisk(acc.id, e.target.value)}
                        className="w-14 px-2 py-1 bg-bg-tertiary border border-border-primary rounded text-xs text-text-primary"
                      />
                    </div>
                  )}
                  <Button variant="secondary" size="sm" onClick={() => setManage({ account: acc, mode: 'labels' })}>
                    Edit
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setManage({ account: acc, mode: 'trade' })}>
                    + Trade
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setManage({ account: acc, mode: 'import' })}>
                    Import
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setManage({ account: acc, mode: 'exclusions' })}>
                    Visibility
                  </Button>
                  <Button
                    variant={acc.hitlEnabled ? 'danger' : 'secondary'}
                    size="sm"
                    onClick={() => handleToggleHitl(acc.id, !acc.hitlEnabled)}
                    loading={togglingHitl === acc.id}
                    disabled={!acc.hitlEnabled && acc.accessMode !== 'trading'}
                    title={!acc.hitlEnabled && acc.accessMode !== 'trading' ? 'Requires a trading password (read-only account)' : 'Enable approved-trade execution on this account'}
                  >
                    {acc.hitlEnabled ? 'Disable Unicorn' : 'Enable Unicorn'}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => handleSync(acc.id)} loading={syncing === acc.id}>
                    Re-sync
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => handleDelete(acc.id)} loading={deleting === acc.id}>
                    Remove
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {manage?.mode === 'labels' && (
        <AccountLabelsModal account={manage.account} onClose={() => setManage(null)} onSaved={() => { setManage(null); onRefetch(); }} toast={toast} />
      )}
      {manage?.mode === 'trade' && (
        <ManualTradeModal account={manage.account} onClose={() => setManage(null)} onSaved={() => { setManage(null); onRefetch(); }} toast={toast} />
      )}
      {manage?.mode === 'import' && (
        <ImportModal account={manage.account} onClose={() => setManage(null)} onSaved={() => { setManage(null); onRefetch(); }} toast={toast} />
      )}
      {manage?.mode === 'exclusions' && (
        <ExclusionsModal account={manage.account} onClose={() => { setManage(null); onRefetch(); }} onSaved={() => {}} toast={toast} />
      )}
    </>
  );
}

// Control which trades and deposits/withdrawals are transmitted via the public
// API. Transmission only — hidden items still count toward balance and stats.
function ExclusionsModal({ account, onClose, toast }: ManageModalProps) {
  const [ops, setOps] = useState<any[]>([]);
  const [tradeList, setTradeList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, t] = await Promise.all([
        fetch(`/api/accounts/${account.id}/balance-ops`),
        fetch(`/api/trades/${account.id}?type=all&limit=100`),
      ]);
      if (o.ok) setOps((await o.json()).ops || []);
      if (t.ok) setTradeList((await t.json()).trades || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [account.id]);

  useEffect(() => { load(); }, [load]);

  async function toggleOp(op: any) {
    setBusy(op.id);
    try {
      const res = await fetch(`/api/accounts/${account.id}/balance-ops`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opId: op.id, isExcluded: !op.isExcluded }),
      });
      if (res.ok) { toast(op.isExcluded ? 'Transaction transmitted via API again' : 'Transaction hidden from API', 'success'); load(); }
      else { const d = await res.json().catch(() => ({})); toast(d.error || 'Failed to update', 'error'); }
    } catch { toast('Failed to update', 'error'); }
    finally { setBusy(null); }
  }

  async function toggleTrade(t: any) {
    setBusy(t.id);
    try {
      const res = await fetch(`/api/trades/${account.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tradeId: t.id, isExcluded: !t.isExcluded }),
      });
      if (res.ok) { toast(t.isExcluded ? 'Trade visible via API again' : 'Trade hidden from API', 'success'); load(); }
      else { const d = await res.json().catch(() => ({})); toast(d.error || 'Failed to update', 'error'); }
    } catch { toast('Failed to update', 'error'); }
    finally { setBusy(null); }
  }

  const [opForm, setOpForm] = useState({ kind: 'deposit', amount: '', time: '', comment: '' });

  async function addOp() {
    if (!opForm.amount || Number(opForm.amount) === 0) { toast('Enter an amount', 'error'); return; }
    setBusy('add-op');
    try {
      const res = await fetch(`/api/accounts/${account.id}/balance-ops`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: opForm.kind, amount: Number(opForm.amount),
          time: opForm.time || undefined, comment: opForm.comment || undefined,
        }),
      });
      if (res.ok) { toast('Transaction added — balance updated', 'success'); setOpForm({ kind: 'deposit', amount: '', time: '', comment: '' }); load(); }
      else { const d = await res.json().catch(() => ({})); toast(d.error || 'Failed to add', 'error'); }
    } catch { toast('Failed to add', 'error'); }
    finally { setBusy(null); }
  }

  async function deleteOp(op: any) {
    setBusy(op.id);
    try {
      const res = await fetch(`/api/accounts/${account.id}/balance-ops?opId=${op.id}`, { method: 'DELETE' });
      if (res.ok) { toast('Transaction removed — balance updated', 'success'); load(); }
      else { const d = await res.json().catch(() => ({})); toast(d.error || 'Failed to remove', 'error'); }
    } catch { toast('Failed to remove', 'error'); }
    finally { setBusy(null); }
  }

  return (
    <Modal open onClose={onClose} title={`API visibility — ${account.labelName || account.name}`} className="max-w-2xl">
      <p className="text-xs text-text-secondary mb-3">
        Hidden items are not transmitted via the API — consumers see no trace of them. Your account balance,
        statistics, and in-app views are unaffected. Toggle again to transmit an item.
      </p>
      {loading ? (
        <p className="text-xs text-text-tertiary">Loading…</p>
      ) : (
        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          <div>
            <h4 className="text-sm font-medium text-text-secondary mb-1.5">Deposits &amp; withdrawals</h4>
            <div className="flex items-end gap-2 mb-2">
              <div className="w-32">
                <Select label="Type" value={opForm.kind} onChange={(e) => setOpForm({ ...opForm, kind: e.target.value })}
                  options={[{ value: 'deposit', label: 'Deposit' }, { value: 'withdrawal', label: 'Withdrawal' }]} />
              </div>
              <div className="flex-1">
                <Input label="Amount" type="number" step="0.01" placeholder="e.g. 1000000"
                  value={opForm.amount} onChange={(e) => setOpForm({ ...opForm, amount: e.target.value })} />
              </div>
              <div className="w-40">
                <Input label="Date" type="date" value={opForm.time} onChange={(e) => setOpForm({ ...opForm, time: e.target.value })} />
              </div>
              <Button onClick={addOp} loading={busy === 'add-op'}>Add</Button>
            </div>
            {ops.length === 0 ? (
              <p className="text-xs text-text-tertiary">
                None recorded. Broker transactions appear after a re-sync, or add them manually above.
              </p>
            ) : (
              <div className="space-y-1">
                {ops.map((op) => (
                  <div key={op.id} className={`flex items-center justify-between py-1.5 px-3 bg-bg-tertiary rounded-[var(--radius-md)] ${op.isExcluded ? 'opacity-50' : ''}`}>
                    <div className="flex items-center gap-2 text-sm">
                      <Badge variant={op.kind === 'deposit' ? 'profit' : 'loss'}>{op.kind}</Badge>
                      <span className="font-mono text-text-primary">{formatCurrency(op.amount)}</span>
                      <span className="text-xs text-text-tertiary">{new Date(op.time).toLocaleDateString()}</span>
                      {op.isExcluded && <Badge variant="warning">hidden</Badge>}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button variant="secondary" size="sm" onClick={() => toggleOp(op)} loading={busy === op.id}>
                        {op.isExcluded ? 'Show' : 'Hide'}
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => deleteOp(op)} loading={busy === op.id}>
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <h4 className="text-sm font-medium text-text-secondary mb-1.5">Trades (latest 100)</h4>
            {tradeList.length === 0 ? (
              <p className="text-xs text-text-tertiary">No trades yet.</p>
            ) : (
              <div className="space-y-1">
                {tradeList.map((t) => (
                  <div key={t.id} className={`flex items-center justify-between py-1.5 px-3 bg-bg-tertiary rounded-[var(--radius-md)] ${t.isExcluded ? 'opacity-50' : ''}`}>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-text-primary">{t.symbol}</span>
                      <Badge variant={t.direction === 'BUY' ? 'profit' : 'loss'}>{t.direction}</Badge>
                      <span className={`font-mono ${t.profit >= 0 ? 'text-profit-primary' : 'text-loss-primary'}`}>{formatCurrency(t.profit)}</span>
                      <span className="text-xs text-text-tertiary">
                        {t.closeTime ? new Date(t.closeTime).toLocaleDateString() : 'open'}
                      </span>
                      {t.isExcluded && <Badge variant="warning">hidden</Badge>}
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => toggleTrade(t)} loading={busy === t.id}>
                      {t.isExcluded ? 'Show' : 'Hide'}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      <div className="mt-4">
        <Button variant="secondary" onClick={onClose} className="w-full">Done</Button>
      </div>
    </Modal>
  );
}

type ManageModalProps = {
  account: any;
  onClose: () => void;
  onSaved: () => void;
  toast: (msg: string, type?: string) => void;
};

// Override the identifying data exposed via the REST API + toggle the
// manual/live distinction.
function AccountLabelsModal({ account, onClose, onSaved, toast }: ManageModalProps) {
  const [form, setForm] = useState({
    labelName: account.labelName || '',
    labelLogin: account.labelLogin || '',
    labelType: account.labelType || account.accountType || '',
    labelServer: account.labelServer || '',
    labelBroker: account.labelBroker || '',
    labelLeverage: account.labelLeverage != null ? String(account.labelLeverage) : '',
    beginningDate: account.beginningDate || '',
    distinguishManual: account.distinguishManual !== false,
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/accounts/${account.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          labelName: form.labelName.trim() || null,
          labelLogin: form.labelLogin.trim() || null,
          labelType: form.labelType || null,
          labelServer: form.labelServer.trim() || null,
          labelBroker: form.labelBroker.trim() || null,
          labelLeverage: form.labelLeverage.trim() === '' ? null : Number(form.labelLeverage),
          beginningDate: form.beginningDate || null,
          distinguishManual: form.distinguishManual,
        }),
      });
      if (res.ok) { toast('Account labels saved', 'success'); onSaved(); }
      else { const d = await res.json().catch(() => ({})); toast(d.error || 'Failed to save', 'error'); }
    } catch { toast('Failed to save', 'error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title="Edit account labels" className="max-w-lg">
      <p className="text-xs text-text-secondary mb-4">
        Override what the REST API exposes for this account. Leave a field blank to expose the real value.
        These do not change your broker credentials.
      </p>
      <div className="space-y-3">
        <Input label="Display name" placeholder={account.name}
          value={form.labelName} onChange={(e) => setForm({ ...form, labelName: e.target.value })} />
        <Input label="Display account number" placeholder={account.login}
          value={form.labelLogin} onChange={(e) => setForm({ ...form, labelLogin: e.target.value })} />
        <Select label="Account type (live / demo)" value={form.labelType}
          onChange={(e) => setForm({ ...form, labelType: e.target.value })}
          options={[{ value: '', label: 'Unset' }, { value: 'live', label: 'Live' }, { value: 'demo', label: 'Demo' }]} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Display server" placeholder={account.server || 'e.g. FusionMarkets-Live'}
            value={form.labelServer} onChange={(e) => setForm({ ...form, labelServer: e.target.value })} />
          <Input label="Display broker" placeholder={account.broker || 'e.g. FusionMarkets'}
            value={form.labelBroker} onChange={(e) => setForm({ ...form, labelBroker: e.target.value })} />
          <Input label="Display leverage" type="number" placeholder={account.leverage != null ? String(account.leverage) : 'e.g. 500'}
            value={form.labelLeverage} onChange={(e) => setForm({ ...form, labelLeverage: e.target.value })} />
          <Input label="Beginning date" type="date"
            value={form.beginningDate} onChange={(e) => setForm({ ...form, beginningDate: e.target.value })} />
        </div>
        <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer pt-1">
          <input type="checkbox" checked={form.distinguishManual}
            onChange={(e) => setForm({ ...form, distinguishManual: e.target.checked })} />
          Distinguish manual vs live entries (expose <span className="font-mono text-xs">source</span> and allow filtering)
        </label>
      </div>
      <div className="flex gap-2 mt-5">
        <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
        <Button onClick={save} loading={saving} className="flex-1">Save</Button>
      </div>
    </Modal>
  );
}

// Hand-enter a single trade/position (source = manual).
function ManualTradeModal({ account, onClose, onSaved, toast }: ManageModalProps) {
  const [form, setForm] = useState({
    symbol: '', direction: 'BUY', lots: '', entryPrice: '', closePrice: '',
    stopLoss: '', takeProfit: '', openTime: '', closeTime: '', profit: '', commission: '', swap: '', comment: '',
  });
  const [saving, setSaving] = useState(false);

  function set(k: string, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function save() {
    if (!form.symbol.trim() || !form.lots || !form.entryPrice || !form.openTime) {
      toast('Symbol, lots, entry price and open time are required', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        symbol: form.symbol, direction: form.direction,
        lots: Number(form.lots), entryPrice: Number(form.entryPrice),
        openTime: form.openTime,
      };
      if (form.closeTime) payload.closeTime = form.closeTime;
      if (form.closePrice) payload.closePrice = Number(form.closePrice);
      if (form.stopLoss) payload.stopLoss = Number(form.stopLoss);
      if (form.takeProfit) payload.takeProfit = Number(form.takeProfit);
      if (form.profit) payload.profit = Number(form.profit);
      if (form.commission) payload.commission = Number(form.commission);
      if (form.swap) payload.swap = Number(form.swap);
      if (form.comment) payload.comment = form.comment;

      const res = await fetch(`/api/trades/${account.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (res.ok) { toast('Trade added', 'success'); onSaved(); }
      else { const d = await res.json().catch(() => ({})); toast(d.error || 'Failed to add trade', 'error'); }
    } catch { toast('Failed to add trade', 'error'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open onClose={onClose} title={`Add manual trade — ${account.labelName || account.name}`} className="max-w-lg">
      <p className="text-xs text-text-secondary mb-4">
        Leave close time / price blank for an open position. Profit is optional; pips are derived from prices when possible.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Symbol" placeholder="EURUSD" value={form.symbol} onChange={(e) => set('symbol', e.target.value)} />
        <Select label="Direction" value={form.direction} onChange={(e) => set('direction', e.target.value)}
          options={[{ value: 'BUY', label: 'BUY' }, { value: 'SELL', label: 'SELL' }]} />
        <Input label="Lots" type="number" step="0.01" value={form.lots} onChange={(e) => set('lots', e.target.value)} />
        <Input label="Profit ($)" type="number" step="0.01" value={form.profit} onChange={(e) => set('profit', e.target.value)} />
        <Input label="Entry price" type="number" step="any" value={form.entryPrice} onChange={(e) => set('entryPrice', e.target.value)} />
        <Input label="Close price" type="number" step="any" value={form.closePrice} onChange={(e) => set('closePrice', e.target.value)} />
        <Input label="Open time" type="datetime-local" value={form.openTime} onChange={(e) => set('openTime', e.target.value)} />
        <Input label="Close time" type="datetime-local" value={form.closeTime} onChange={(e) => set('closeTime', e.target.value)} />
        <Input label="Stop loss" type="number" step="any" value={form.stopLoss} onChange={(e) => set('stopLoss', e.target.value)} />
        <Input label="Take profit" type="number" step="any" value={form.takeProfit} onChange={(e) => set('takeProfit', e.target.value)} />
        <Input label="Commission" type="number" step="0.01" value={form.commission} onChange={(e) => set('commission', e.target.value)} />
        <Input label="Swap" type="number" step="0.01" value={form.swap} onChange={(e) => set('swap', e.target.value)} />
      </div>
      <div className="mt-3">
        <Input label="Comment" value={form.comment} onChange={(e) => set('comment', e.target.value)} />
      </div>
      <div className="flex gap-2 mt-5">
        <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
        <Button onClick={save} loading={saving} className="flex-1">Add trade</Button>
      </div>
    </Modal>
  );
}

// Backfill from an MT5 history export (CSV paste/upload or JSON array).
function ImportModal({ account, onClose, onSaved, toast }: ManageModalProps) {
  const [text, setText] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [preserveBalance, setPreserveBalance] = useState(false);
  const [importing, setImporting] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setText(await file.text());
  }

  async function run() {
    if (!text.trim()) { toast('Paste or upload some data first', 'error'); return; }
    setImporting(true);
    try {
      // Mirror the server's sniffing (it re-detects anyway). MT5 saves HTML
      // reports as UTF-16 — strip the NULs/BOM a UTF-8 read leaves behind.
      const cleaned = text.replace(/\u0000/g, '').replace(/^[\uFEFF\uFFFD\s]+/, '');
      const contentType = cleaned.startsWith('<') ? 'text/html'
        : cleaned.startsWith('[') || cleaned.startsWith('{') ? 'application/json'
        : 'text/csv';
      const params = new URLSearchParams();
      if (openingBalance) params.set('openingBalance', openingBalance);
      if (preserveBalance) params.set('preserveBalance', '1');
      const qs = params.size ? `?${params.toString()}` : '';
      const res = await fetch(`/api/accounts/${account.id}/import${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: cleaned,
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        const extras = [
          d.transactionsImported ? `${d.transactionsImported} deposit/withdrawal(s)` : '',
          d.deduplicated ? `${d.deduplicated} merged with live` : '',
          d.skipped ? `skipped ${d.skipped}` : '',
        ].filter(Boolean).join(', ');
        toast(`Imported ${d.imported} trade(s)${extras ? ` (${extras})` : ''}`, 'success');
        onSaved();
      } else {
        toast(d.error || 'Import failed', 'error');
      }
    } catch { toast('Import failed', 'error'); }
    finally { setImporting(false); }
  }

  return (
    <Modal open onClose={onClose} title={`Import history — ${account.labelName || account.name}`} className="max-w-lg">
      <p className="text-xs text-text-secondary mb-3">
        Upload or paste your MT5 <span className="font-mono">History → Report</span> export — HTML or CSV — or a JSON
        array of trades. Columns are matched by header name; imported trades are tagged <span className="font-mono">manual</span>.
        The next live re-sync continues after the last imported trade and merges any overlap.
      </p>
      <div className="space-y-3">
        <input type="file" accept=".csv,.txt,.json,.html,.htm,text/csv,application/json,text/html"
          onChange={handleFile}
          className="block w-full text-xs text-text-secondary file:mr-3 file:py-2 file:px-3 file:rounded-[var(--radius-md)] file:border-0 file:bg-bg-elevated file:text-text-primary file:cursor-pointer" />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="…or paste CSV / JSON here"
          rows={6}
          className="w-full px-3 py-2 bg-bg-tertiary border border-border-primary rounded-[var(--radius-md)] text-xs font-mono text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary"
        />
        <Input label="Opening balance (optional)" type="number" step="0.01" placeholder="anchors the equity curve"
          value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} />
        <label className="flex items-start gap-2 text-xs text-text-secondary cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={preserveBalance} onChange={(e) => setPreserveBalance(e.target.checked)} />
          <span>
            <strong>Keep current balance.</strong> Newly captured deposits/withdrawals are absorbed into the opening
            anchor, so the account balance does not change — they just become visible as itemised transactions.
          </span>
        </label>
      </div>
      <div className="flex gap-2 mt-5">
        <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
        <Button onClick={run} loading={importing} className="flex-1">Import</Button>
      </div>
    </Modal>
  );
}

type ApiKey = {
  id: string; name: string; prefix: string; scopes: string;
  accountIds: string[] | null;
  lastUsedAt: string | null; expiresAt: string | null; createdAt: string;
};

// Manage per-user API keys for the public REST API (/api/v1).
function ApiKeysSection({ toast, accounts }: { toast: (msg: string, type?: string) => void; accounts: any[] }) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [scope, setScope] = useState('read');
  const [allAccounts, setAllAccounts] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/api-keys');
      if (res.ok) setKeys(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function create() {
    if (!allAccounts && selectedIds.length === 0) {
      toast('Select at least one account (or allow all)', 'error');
      return;
    }
    setCreating(true);
    try {
      const scopes = scope === 'write' ? ['read', 'write'] : ['read'];
      const res = await fetch('/api/api-keys', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || 'API key',
          scopes,
          ...(allAccounts ? {} : { accountIds: selectedIds }),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setNewKey(d.key); setName(''); setAllAccounts(true); setSelectedIds([]);
        toast('API key created', 'success'); load();
      }
      else { toast(d.error || 'Failed to create key', 'error'); }
    } catch { toast('Failed to create key', 'error'); }
    finally { setCreating(false); }
  }

  function accountLabel(id: string): string {
    const acc = accounts.find((a) => a.id === id);
    return acc ? (acc.labelName || acc.name) : 'removed account';
  }

  async function revoke(id: string) {
    setRevoking(id);
    try {
      const res = await fetch(`/api/api-keys/${id}`, { method: 'DELETE' });
      if (res.ok) { toast('Key revoked', 'success'); load(); }
      else toast('Failed to revoke', 'error');
    } catch { toast('Failed to revoke', 'error'); }
    finally { setRevoking(null); }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <h3 className="text-sm font-medium">API keys</h3>
          <p className="text-xs text-text-tertiary mt-1">
            Authenticate calls to the REST API at <span className="font-mono">/api/v1</span> (or <span className="font-mono">/haia/v1</span>).
            Send the key as <span className="font-mono">Authorization: Bearer &lt;key&gt;</span> or the <span className="font-mono">X-API-Key</span> header.
            Read keys can fetch accounts/trades; write keys can also ingest trades, import history, and edit labels.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input label="Key name" placeholder="e.g. Sheets sync" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="w-32">
              <Select label="Scope" value={scope} onChange={(e) => setScope(e.target.value)}
                options={[{ value: 'read', label: 'Read' }, { value: 'write', label: 'Read + Write' }]} />
            </div>
            <Button onClick={create} loading={creating}>Create</Button>
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-text-secondary">Account access</label>
            <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
              <input type="checkbox" checked={allAccounts} onChange={(e) => setAllAccounts(e.target.checked)} />
              All accounts (including ones connected later)
            </label>
            {!allAccounts && (
              <div className="pl-6 space-y-1">
                {accounts.length === 0 ? (
                  <p className="text-xs text-text-tertiary">No accounts connected yet.</p>
                ) : accounts.map((acc) => (
                  <label key={acc.id} className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(acc.id)}
                      onChange={(e) => setSelectedIds((ids) =>
                        e.target.checked ? [...ids, acc.id] : ids.filter((i) => i !== acc.id))}
                    />
                    {acc.labelName || acc.name}
                    <span className="text-xs text-text-tertiary">#{acc.labelLogin || acc.login}</span>
                  </label>
                ))}
                <p className="text-xs text-text-tertiary">
                  The key can only see the accounts ticked here — others 404 as if they don&apos;t exist.
                </p>
              </div>
            )}
          </div>

          {loading ? (
            <p className="text-xs text-text-tertiary">Loading…</p>
          ) : keys.length === 0 ? (
            <p className="text-xs text-text-tertiary">No API keys yet.</p>
          ) : (
            <div className="space-y-1.5">
              {keys.map((k) => (
                <div key={k.id} className="flex items-center justify-between py-2 px-3 bg-bg-tertiary rounded-[var(--radius-md)]">
                  <div className="flex items-center gap-2 text-sm flex-wrap">
                    <span className="text-text-primary">{k.name}</span>
                    <span className="font-mono text-xs text-text-tertiary">{k.prefix}…</span>
                    {k.scopes.split(',').map((s) => <Badge key={s} variant={s === 'write' ? 'info' : 'default'}>{s}</Badge>)}
                    <Badge
                      variant={k.accountIds ? 'warning' : 'default'}
                      title={k.accountIds ? k.accountIds.map(accountLabel).join(', ') : 'Every account, including future ones'}
                    >
                      {k.accountIds ? `${k.accountIds.length} account${k.accountIds.length === 1 ? '' : 's'}` : 'all accounts'}
                    </Badge>
                    <span className="text-xs text-text-tertiary">
                      {k.lastUsedAt ? `used ${new Date(k.lastUsedAt).toLocaleDateString()}` : 'never used'}
                    </span>
                  </div>
                  <Button variant="danger" size="sm" onClick={() => revoke(k.id)} loading={revoking === k.id}>Revoke</Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Modal open={!!newKey} onClose={() => setNewKey(null)} title="Copy your API key">
        <p className="text-sm text-text-secondary mb-3">
          This is the only time the key is shown. Copy it now and store it securely — you can&apos;t retrieve it later.
        </p>
        <div className="p-3 bg-bg-tertiary border border-border-primary rounded-[var(--radius-md)] font-mono text-xs text-text-primary break-all mb-4">
          {newKey}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1"
            onClick={() => { if (newKey) navigator.clipboard?.writeText(newKey); toast('Copied to clipboard', 'success'); }}>
            Copy
          </Button>
          <Button className="flex-1" onClick={() => setNewKey(null)}>Done</Button>
        </div>
      </Modal>
    </>
  );
}

type AuthorizedUser = { id: string; telegramUserId: string; label: string | null };
type ChatDest = { id: string; chatId: string; label: string | null };

function HitlAccessSection({ toast }: { toast: (msg: string, type?: string) => void }) {
  const [users, setUsers] = useState<AuthorizedUser[]>([]);
  const [chats, setChats] = useState<ChatDest[]>([]);
  const [loading, setLoading] = useState(true);
  const [userForm, setUserForm] = useState({ telegramUserId: '', label: '' });
  const [chatForm, setChatForm] = useState({ chatId: '', label: '' });
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, c] = await Promise.all([fetch('/api/hitl/access'), fetch('/api/hitl/chats')]);
      if (a.ok) setUsers((await a.json()).users || []);
      if (c.ok) setChats((await c.json()).chats || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addChat() {
    if (!chatForm.chatId.trim()) return;
    setBusy('add-chat');
    try {
      const res = await fetch('/api/hitl/chats', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(chatForm),
      });
      if (res.ok) { toast('Destination added', 'success'); setChatForm({ chatId: '', label: '' }); load(); }
      else { const d = await res.json().catch(() => ({})); toast(d.error || 'Failed to add destination', 'error'); }
    } catch { toast('Failed to add destination', 'error'); }
    finally { setBusy(null); }
  }

  async function addUser() {
    if (!userForm.telegramUserId.trim()) return;
    setBusy('add-user');
    try {
      const res = await fetch('/api/hitl/access', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(userForm),
      });
      if (res.ok) { toast('User authorized', 'success'); setUserForm({ telegramUserId: '', label: '' }); load(); }
      else { const d = await res.json().catch(() => ({})); toast(d.error || 'Failed to add user', 'error'); }
    } catch { toast('Failed to add user', 'error'); }
    finally { setBusy(null); }
  }

  async function remove(kind: 'chats' | 'access', id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/hitl/${kind}/${id}`, { method: 'DELETE' });
      if (res.ok) { toast('Removed', 'success'); load(); }
      else toast('Failed to remove', 'error');
    } catch { toast('Failed to remove', 'error'); }
    finally { setBusy(null); }
  }

  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-medium">Access</h3>
        <p className="text-xs text-text-tertiary mt-1">
          Where the bot posts prompts, and who can respond/approve. Prompts and confirm cards fan out to every
          destination — add a DM and a group to use both. Changes take effect immediately.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="block text-sm font-medium text-text-secondary">Destinations (DM + group(s))</label>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input label="Chat id" placeholder="123456789 (DM) or -1001234567890 (group)"
                value={chatForm.chatId} onChange={(e) => setChatForm({ ...chatForm, chatId: e.target.value })} />
            </div>
            <div className="flex-1">
              <Input label="Label (optional)" placeholder="e.g. Desk group"
                value={chatForm.label} onChange={(e) => setChatForm({ ...chatForm, label: e.target.value })} />
            </div>
            <Button onClick={addChat} loading={busy === 'add-chat'} disabled={!chatForm.chatId.trim()}>Add</Button>
          </div>
          <p className="text-xs text-text-tertiary">
            Tip: send the bot <span className="font-mono">/id</span> in a DM or group to get the chat id (groups are negative).
          </p>
          {loading ? null : chats.length === 0 ? (
            <p className="text-xs text-text-tertiary">No destinations yet (HITL_OPERATOR_CHAT_ID env still applies if set).</p>
          ) : (
            <div className="space-y-1.5">
              {chats.map((c) => (
                <div key={c.id} className="flex items-center justify-between py-2 px-3 bg-bg-tertiary rounded-[var(--radius-md)]">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-text-primary">{c.chatId}</span>
                    {Number(c.chatId) < 0 && <Badge variant="info">group</Badge>}
                    {c.label && <span className="text-text-tertiary">· {c.label}</span>}
                  </div>
                  <Button variant="danger" size="sm" onClick={() => remove('chats', c.id)} loading={busy === c.id}>Remove</Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-text-secondary">Authorized users</label>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input label="Telegram user id" placeholder="123456789"
                value={userForm.telegramUserId} onChange={(e) => setUserForm({ ...userForm, telegramUserId: e.target.value })} />
            </div>
            <div className="flex-1">
              <Input label="Label (optional)" placeholder="e.g. Brandon"
                value={userForm.label} onChange={(e) => setUserForm({ ...userForm, label: e.target.value })} />
            </div>
            <Button onClick={addUser} loading={busy === 'add-user'} disabled={!userForm.telegramUserId.trim()}>Add</Button>
          </div>
          {loading ? (
            <p className="text-xs text-text-tertiary">Loading…</p>
          ) : users.length === 0 ? (
            <p className="text-xs text-text-tertiary">No users authorized in-app. (Anyone in AUTHORIZED_TELEGRAM_USER_IDS env still applies.)</p>
          ) : (
            <div className="space-y-1.5">
              {users.map((u) => (
                <div key={u.id} className="flex items-center justify-between py-2 px-3 bg-bg-tertiary rounded-[var(--radius-md)]">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-text-primary">{u.telegramUserId}</span>
                    {u.label && <span className="text-text-tertiary">· {u.label}</span>}
                  </div>
                  <Button variant="danger" size="sm" onClick={() => remove('access', u.id)} loading={busy === u.id}>Remove</Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

type Strat = 'unicorn' | 'forever';
const STRATS: Strat[] = ['unicorn', 'forever'];
const stratLabel = (s: Strat) => (s === 'unicorn' ? 'Unicorn' : 'Forever');

function StrategyPicker({ value, onChange }: { value: Strat; onChange: (s: Strat) => void }) {
  return (
    <div className="flex gap-2">
      {STRATS.map((s) => (
        <button key={s} type="button" aria-pressed={value === s} onClick={() => onChange(s)}
          className={`px-3 py-1 rounded-[var(--radius-md)] text-xs border ${
            value === s ? 'border-accent-primary bg-accent-primary/10 text-text-primary'
              : 'border-border-primary text-text-secondary hover:text-text-primary'}`}>
          {stratLabel(s)}
        </button>
      ))}
    </div>
  );
}

type TargetsDraft = { tp1: string; tp2: string; tp3: string };

function HitlTargetsSection({ toast }: { toast: (msg: string, type?: string) => void }) {
  const empty: TargetsDraft = { tp1: '1', tp2: '2', tp3: '5' };
  const [strat, setStrat] = useState<Strat>('unicorn');
  const [targets, setTargets] = useState<Record<Strat, TargetsDraft>>({ unicorn: empty, forever: empty });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/hitl/targets')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.unicorn && d?.forever) {
          const s = (x: { tp1: number; tp2: number; tp3: number }): TargetsDraft => ({ tp1: String(x.tp1), tp2: String(x.tp2), tp3: String(x.tp3) });
          setTargets({ unicorn: s(d.unicorn), forever: s(d.forever) });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const t = targets[strat];
  const setT = (patch: Partial<TargetsDraft>) => setTargets((prev) => ({ ...prev, [strat]: { ...prev[strat], ...patch } }));

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch('/api/hitl/targets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy: strat, tp1: Number(t.tp1), tp2: Number(t.tp2), tp3: Number(t.tp3) }),
      });
      if (res.ok) toast(`${stratLabel(strat)} targets saved`, 'success');
      else { const d = await res.json().catch(() => ({})); toast(d.error || 'Failed to save targets', 'error'); }
    } catch { toast('Failed to save targets', 'error'); }
    finally { setSaving(false); }
  }

  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-medium">Targets (R multiples)</h3>
        <p className="text-xs text-text-tertiary mt-1">
          Per strategy. TPs project from the far edge of the range in multiples of R (the range height);
          the stop sits at the protective edge. TP1 is the breakeven trigger, TP2 is Leg A&apos;s take-profit,
          TP3 is Leg B&apos;s. Must be strictly increasing. Applies to new signals only.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <p className="text-xs text-text-tertiary">Loading…</p>
        ) : (
          <>
            <StrategyPicker value={strat} onChange={setStrat} />
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Input label="TP1 — breakeven" type="number" step="0.1" value={t.tp1}
                  onChange={(e) => setT({ tp1: e.target.value })} />
              </div>
              <div className="flex-1">
                <Input label="TP2 — Leg A" type="number" step="0.1" value={t.tp2}
                  onChange={(e) => setT({ tp2: e.target.value })} />
              </div>
              <div className="flex-1">
                <Input label="TP3 — Leg B" type="number" step="0.1" value={t.tp3}
                  onChange={(e) => setT({ tp3: e.target.value })} />
              </div>
              <Button onClick={handleSave} loading={saving}>Save</Button>
            </div>
            <p className="text-xs text-text-tertiary">
              Editing {stratLabel(strat)} only. Default ladder: TP1 1R · TP2 2R · TP3 5R.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

type ExecDraft = { model: 'single' | 'two_position'; tp3: boolean };

function HitlExecutionSection({ toast }: { toast: (msg: string, type?: string) => void }) {
  const empty: ExecDraft = { model: 'two_position', tp3: true };
  const [strat, setStrat] = useState<Strat>('unicorn');
  const [exec, setExec] = useState<Record<Strat, ExecDraft>>({ unicorn: empty, forever: empty });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/hitl/execution')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.unicorn && d?.forever) {
          const s = (x: { positionModel: 'single' | 'two_position'; tp3Enabled: boolean }): ExecDraft => ({ model: x.positionModel, tp3: x.tp3Enabled });
          setExec({ unicorn: s(d.unicorn), forever: s(d.forever) });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const e = exec[strat];
  const setE = (patch: Partial<ExecDraft>) => setExec((prev) => ({ ...prev, [strat]: { ...prev[strat], ...patch } }));

  // Two-position needs a TP3 runner; keep the two in sync.
  function pickModel(m: 'single' | 'two_position') {
    setE(m === 'two_position' ? { model: m, tp3: true } : { model: m });
  }
  function pickTp3(on: boolean) {
    setE(!on && e.model === 'two_position' ? { tp3: on, model: 'single' } : { tp3: on });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch('/api/hitl/execution', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy: strat, positionModel: e.model, tp3Enabled: e.tp3 }),
      });
      if (res.ok) toast(`${stratLabel(strat)} execution saved`, 'success');
      else { const d = await res.json().catch(() => ({})); toast(d.error || 'Failed to save', 'error'); }
    } catch { toast('Failed to save', 'error'); }
    finally { setSaving(false); }
  }

  const summary = e.model === 'two_position'
    ? 'Two positions: Leg A → TP2, Leg B → TP3. Both move to breakeven at TP1.'
    : e.tp3
      ? 'One position → TP3. Moves to breakeven at TP1.'
      : 'One position → TP2 (full profit). Moves to breakeven at TP1.';

  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-medium">Execution</h3>
        <p className="text-xs text-text-tertiary mt-1">
          Per strategy. How many positions to open and whether to use TP3 (the runner). Applies to new signals only.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <p className="text-xs text-text-tertiary">Loading…</p>
        ) : (
          <>
            <StrategyPicker value={strat} onChange={setStrat} />
            <div>
              <label className="text-xs text-text-secondary">Positions</label>
              <div className="flex gap-2 mt-1">
                {([['two_position', 'Two positions'], ['single', 'Single position']] as const).map(([m, label]) => (
                  <button key={m} type="button" aria-pressed={e.model === m} onClick={() => pickModel(m)}
                    className={`flex-1 px-3 py-2 rounded-[var(--radius-md)] text-sm border ${
                      e.model === m ? 'border-accent-primary bg-accent-primary/10 text-text-primary'
                        : 'border-border-primary text-text-secondary hover:text-text-primary'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <label className={`flex items-center gap-2 text-sm ${e.model === 'two_position' ? 'opacity-50' : ''}`}>
              <input type="checkbox" checked={e.tp3} disabled={e.model === 'two_position'}
                onChange={(ev) => pickTp3(ev.target.checked)} />
              <span className="text-text-secondary">Include TP3 (runner). Uncheck to take full profit at TP2.</span>
            </label>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-text-tertiary">{stratLabel(strat)}: {summary}</p>
              <Button onClick={handleSave} loading={saving}>Save</Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

type RiskDraft = { mode: string; riskPct: string; fixedAmount: string; maxRiskPct: string };

function HitlRiskSection({ toast }: { toast: (msg: string, type?: string) => void }) {
  const empty: RiskDraft = { mode: 'percent', riskPct: '1', fixedAmount: '50', maxRiskPct: '5' };
  const [strat, setStrat] = useState<Strat>('unicorn');
  const [risk, setRisk] = useState<Record<Strat, RiskDraft>>({ unicorn: empty, forever: empty });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/hitl/risk')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.unicorn && d?.forever) {
          const s = (x: { mode: string; riskPct: number; fixedAmount: number; maxRiskPct: number }): RiskDraft =>
            ({ mode: x.mode, riskPct: String(x.riskPct), fixedAmount: String(x.fixedAmount || ''), maxRiskPct: String(x.maxRiskPct) });
          setRisk({ unicorn: s(d.unicorn), forever: s(d.forever) });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const rk = risk[strat];
  const setRk = (patch: Partial<RiskDraft>) => setRisk((prev) => ({ ...prev, [strat]: { ...prev[strat], ...patch } }));

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch('/api/hitl/risk', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategy: strat,
          mode: rk.mode,
          riskPct: Number(rk.riskPct),
          fixedAmount: Number(rk.fixedAmount),
          maxRiskPct: Number(rk.maxRiskPct),
        }),
      });
      if (res.ok) toast(`${stratLabel(strat)} risk saved`, 'success');
      else { const d = await res.json().catch(() => ({})); toast(d.error || 'Failed to save risk', 'error'); }
    } catch { toast('Failed to save risk', 'error'); }
    finally { setSaving(false); }
  }

  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-medium">Risk per trade</h3>
        <p className="text-xs text-text-tertiary mt-1">
          Per strategy. How much each trade risks (loss if the stop at the protective range edge is hit).
          The max-risk cap is a hard limit — a signal that would exceed it is blocked at dispatch.
          Applies to new signals only.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <p className="text-xs text-text-tertiary">Loading…</p>
        ) : (
          <>
            <StrategyPicker value={strat} onChange={setStrat} />
            <div className="flex gap-2">
              {(['percent', 'fixed'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={rk.mode === m}
                  onClick={() => setRk({ mode: m })}
                  className={`flex-1 px-3 py-2 rounded-[var(--radius-md)] text-sm border ${
                    rk.mode === m
                      ? 'border-accent-primary bg-accent-primary/10 text-text-primary'
                      : 'border-border-primary text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {m === 'percent' ? 'Percent of equity' : 'Fixed dollar amount'}
                </button>
              ))}
            </div>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                {rk.mode === 'percent' ? (
                  <Input label="Risk % per trade" type="number" step="0.1" value={rk.riskPct}
                    onChange={(e) => setRk({ riskPct: e.target.value })} />
                ) : (
                  <Input label="Risk $ per trade" type="number" step="1" value={rk.fixedAmount}
                    onChange={(e) => setRk({ fixedAmount: e.target.value })} />
                )}
              </div>
              <div className="flex-1">
                <Input label="Max risk % (cap)" type="number" step="0.1" value={rk.maxRiskPct}
                  onChange={(e) => setRk({ maxRiskPct: e.target.value })} />
              </div>
              <Button onClick={handleSave} loading={saving}>Save</Button>
            </div>
            <p className="text-xs text-text-tertiary">
              Editing {stratLabel(strat)}. {rk.mode === 'percent'
                ? 'Lots are sized so the loss at the stop equals this % of equity.'
                : 'Lots are sized so the loss at the stop equals this dollar amount — still capped by the max-risk %.'}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

type HitlMessage = { key: string; label: string; description: string; variables: string[]; default: string; value: string };

function HitlMessagesSection({ toast }: { toast: (msg: string, type?: string) => void }) {
  const [messages, setMessages] = useState<HitlMessage[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [dir, setDir] = useState({ BUY: '🟢 BUY', SELL: '🔴 SELL' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, d] = await Promise.all([fetch('/api/hitl/messages'), fetch('/api/hitl/direction-labels')]);
      if (m.ok) {
        const data = await m.json();
        setMessages(data.messages || []);
        setDrafts(Object.fromEntries((data.messages || []).map((x: HitlMessage) => [x.key, x.value])));
      }
      if (d.ok) { const dl = await d.json(); setDir({ BUY: dl.BUY, SELL: dl.SELL }); }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveDir() {
    setBusy('dir');
    try {
      const res = await fetch('/api/hitl/direction-labels', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dir),
      });
      if (res.ok) toast('Direction labels saved', 'success');
      else { const e = await res.json().catch(() => ({})); toast(e.error || 'Failed to save', 'error'); }
    } catch { toast('Failed to save', 'error'); }
    finally { setBusy(null); }
  }

  async function save(key: string) {
    setBusy(key);
    try {
      const res = await fetch('/api/hitl/messages', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, template: drafts[key] }),
      });
      if (res.ok) toast('Message saved', 'success');
      else { const d = await res.json().catch(() => ({})); toast(d.error || 'Failed to save', 'error'); }
    } catch { toast('Failed to save', 'error'); }
    finally { setBusy(null); }
  }

  async function reset(key: string) {
    setBusy(key);
    try {
      const res = await fetch(`/api/hitl/messages/${key}`, { method: 'DELETE' });
      if (res.ok) { const d = await res.json(); setDrafts((p) => ({ ...p, [key]: d.value })); toast('Reset to default', 'success'); }
      else toast('Failed to reset', 'error');
    } catch { toast('Failed to reset', 'error'); }
    finally { setBusy(null); }
  }

  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-medium">Messages</h3>
        <p className="text-xs text-text-tertiary mt-1">
          Customise the text the bot sends. Use <span className="font-mono">{'{variable}'}</span> placeholders — the available
          ones are listed under each. Changes apply to new messages immediately.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5 border-b border-border-primary pb-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-text-primary">Direction label</span>
            <Button size="sm" onClick={saveDir} loading={busy === 'dir'}>Save</Button>
          </div>
          <p className="text-xs text-text-tertiary">What <span className="font-mono">{'{direction}'}</span> renders as.</p>
          <div className="flex items-end gap-2">
            <div className="flex-1"><Input label="BUY (bullish)" value={dir.BUY} onChange={(e) => setDir({ ...dir, BUY: e.target.value })} /></div>
            <div className="flex-1"><Input label="SELL (bearish)" value={dir.SELL} onChange={(e) => setDir({ ...dir, SELL: e.target.value })} /></div>
          </div>
        </div>
        {loading ? (
          <p className="text-xs text-text-tertiary">Loading…</p>
        ) : (
          messages.map((m) => {
            const dirty = drafts[m.key] !== m.value;
            const isDefault = m.value === m.default;
            return (
              <div key={m.key} className="space-y-1.5 border-b border-border-primary pb-3 last:border-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-text-primary">{m.label}</span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => reset(m.key)} loading={busy === m.key} disabled={isDefault}>Reset</Button>
                    <Button size="sm" onClick={() => save(m.key)} loading={busy === m.key} disabled={!dirty}>Save</Button>
                  </div>
                </div>
                <p className="text-xs text-text-tertiary">{m.description}</p>
                <textarea
                  value={drafts[m.key] ?? ''}
                  onChange={(e) => setDrafts((p) => ({ ...p, [m.key]: e.target.value }))}
                  rows={Math.min(6, (drafts[m.key] ?? '').split('\n').length + 1)}
                  className="w-full px-3 py-2 bg-bg-tertiary border border-border-primary rounded-[var(--radius-md)] text-sm text-text-primary font-mono"
                />
                <div className="flex flex-wrap gap-1">
                  {m.variables.map((v) => (
                    <span key={v} className="text-xs font-mono px-1.5 py-0.5 bg-bg-elevated rounded text-text-secondary">{`{${v}}`}</span>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

type SymbolMap = { id: string; tvSymbol: string; brokerSymbol: string };

function HitlSection({ toast }: { toast: (msg: string, type?: string) => void }) {
  const [maps, setMaps] = useState<SymbolMap[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ tvSymbol: '', brokerSymbol: '' });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hitl/symbol-map');
      if (res.ok) setMaps(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAdd() {
    if (!form.tvSymbol.trim() || !form.brokerSymbol.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/hitl/symbol-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        toast('Mapping saved', 'success');
        setForm({ tvSymbol: '', brokerSymbol: '' });
        load();
      } else {
        const d = await res.json().catch(() => ({}));
        toast(d.error || 'Failed to save mapping', 'error');
      }
    } catch { toast('Failed to save mapping', 'error'); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      const res = await fetch(`/api/hitl/symbol-map/${id}`, { method: 'DELETE' });
      if (res.ok) { toast('Mapping removed', 'success'); load(); }
      else toast('Failed to remove', 'error');
    } catch { toast('Failed to remove', 'error'); }
    finally { setDeleting(null); }
  }

  return (
    <Card>
      <CardHeader>
        <h3 className="text-sm font-medium">Symbol Map</h3>
        <p className="text-xs text-text-tertiary mt-1">
          Map TradingView tickers to the symbol names on your broker. Anything not listed is used as-is.
          Example: <span className="font-mono">UK10YBGBP → UKGILT</span>.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              label="TradingView ticker"
              placeholder="UK10YBGBP"
              value={form.tvSymbol}
              onChange={(e) => setForm({ ...form, tvSymbol: e.target.value.toUpperCase() })}
            />
          </div>
          <div className="flex-1">
            <Input
              label="Broker symbol"
              placeholder="UKGILT"
              value={form.brokerSymbol}
              onChange={(e) => setForm({ ...form, brokerSymbol: e.target.value })}
            />
          </div>
          <Button onClick={handleAdd} loading={saving} disabled={!form.tvSymbol.trim() || !form.brokerSymbol.trim()}>
            Add
          </Button>
        </div>

        {loading ? (
          <p className="text-xs text-text-tertiary">Loading…</p>
        ) : maps.length === 0 ? (
          <p className="text-xs text-text-tertiary">No mappings yet — tickers are used exactly as TradingView sends them.</p>
        ) : (
          <div className="space-y-1.5">
            {maps.map((m) => (
              <div key={m.id} className="flex items-center justify-between py-2 px-3 bg-bg-tertiary rounded-[var(--radius-md)]">
                <div className="flex items-center gap-2 font-mono text-sm">
                  <span className="text-text-primary">{m.tvSymbol}</span>
                  <span className="text-text-tertiary">→</span>
                  <span className="text-accent-primary">{m.brokerSymbol}</span>
                </div>
                <Button variant="danger" size="sm" onClick={() => handleDelete(m.id)} loading={deleting === m.id}>
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ProfileSection({ toast }: { toast: (msg: string, type?: string) => void }) {
  const [profile, setProfile] = useState({ name: '', username: '', email: '' });
  const [saving, setSaving] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current: '', newPass: '', confirm: '' });

  useEffect(() => {
    fetch('/api/user/profile').then((r) => r.ok ? r.json() : null).then((d) => { if (d) setProfile(d); });
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: profile.name, username: profile.username }),
      });
      if (res.ok) toast('Profile updated', 'success');
      else toast('Failed to update profile', 'error');
    } catch { toast('Failed to update profile', 'error'); }
    finally { setSaving(false); }
  }

  return (
    <>
      <Card>
        <CardHeader><h3 className="text-sm font-medium">Profile</h3></CardHeader>
        <CardContent className="space-y-3">
          <Input label="Display Name" value={profile.name || ''} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
          <Input label="Username" value={profile.username || ''} onChange={(e) => setProfile({ ...profile, username: e.target.value })} />
          <Input label="Email" value={profile.email || ''} disabled className="opacity-60" />
          <Button onClick={handleSave} loading={saving}>Save Changes</Button>
        </CardContent>
      </Card>
    </>
  );
}

function PreferencesSection({ toast }: { toast: (msg: string, type?: string) => void }) {
  const [prefs, setPrefs] = useState({ timezone: 'UTC', calendarStart: 'monday', currency: 'USD' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/user/profile').then((r) => r.ok ? r.json() : null).then((d) => {
      if (d) setPrefs({ timezone: d.timezone || 'UTC', calendarStart: d.calendarStart || 'monday', currency: d.currency || 'USD' });
    });
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prefs),
      });
      if (res.ok) toast('Preferences saved', 'success');
      else toast('Failed to save', 'error');
    } catch { toast('Failed to save', 'error'); }
    finally { setSaving(false); }
  }

  return (
    <Card>
      <CardHeader><h3 className="text-sm font-medium">Preferences</h3></CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-text-secondary">Default Currency</label>
          <select value={prefs.currency} onChange={(e) => setPrefs({ ...prefs, currency: e.target.value })}
            className="w-full h-10 px-3 bg-bg-tertiary border border-border-primary rounded-[var(--radius-md)] text-sm text-text-primary">
            <option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option>
            <option value="JPY">JPY</option><option value="AUD">AUD</option><option value="CAD">CAD</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-text-secondary">Calendar Start Day</label>
          <select value={prefs.calendarStart} onChange={(e) => setPrefs({ ...prefs, calendarStart: e.target.value })}
            className="w-full h-10 px-3 bg-bg-tertiary border border-border-primary rounded-[var(--radius-md)] text-sm text-text-primary">
            <option value="monday">Monday</option><option value="sunday">Sunday</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-text-secondary">Timezone</label>
          <select value={prefs.timezone} onChange={(e) => setPrefs({ ...prefs, timezone: e.target.value })}
            className="w-full h-10 px-3 bg-bg-tertiary border border-border-primary rounded-[var(--radius-md)] text-sm text-text-primary">
            <option value="UTC">UTC</option>
            <option value="America/New_York">Eastern (ET)</option>
            <option value="America/Chicago">Central (CT)</option>
            <option value="America/Denver">Mountain (MT)</option>
            <option value="America/Los_Angeles">Pacific (PT)</option>
            <option value="Europe/London">London (GMT)</option>
            <option value="Europe/Paris">Central European (CET)</option>
            <option value="Asia/Tokyo">Tokyo (JST)</option>
            <option value="Asia/Singapore">Singapore (SGT)</option>
            <option value="Australia/Sydney">Sydney (AEST)</option>
          </select>
        </div>
        <Button onClick={handleSave} loading={saving}>Save Preferences</Button>
      </CardContent>
    </Card>
  );
}

function DataSection({ toast }: { toast: (msg: string, type?: string) => void }) {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');

  function handleExport() {
    window.open('/api/user/export', '_blank');
    toast('Export started', 'success');
  }

  async function handleDeleteAccount() {
    if (deleteConfirm !== 'DELETE') return;
    try {
      const res = await fetch('/api/user/profile', { method: 'DELETE' });
      if (res.ok) { window.location.href = '/login'; }
      else toast('Failed to delete account', 'error');
    } catch { toast('Failed to delete account', 'error'); }
  }

  return (
    <>
      <Card>
        <CardHeader><h3 className="text-sm font-medium">Export Data</h3></CardHeader>
        <CardContent>
          <p className="text-xs text-text-secondary mb-3">Download all your trade data as CSV.</p>
          <Button variant="secondary" onClick={handleExport}>Export All Data (CSV)</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h3 className="text-sm font-medium text-loss-primary">Danger Zone</h3></CardHeader>
        <CardContent>
          <p className="text-xs text-text-secondary mb-3">Permanently delete your account and all associated data. This action cannot be undone.</p>
          <Button variant="danger" onClick={() => setShowDeleteModal(true)}>Delete Account</Button>
        </CardContent>
      </Card>

      <Modal open={showDeleteModal} onClose={() => setShowDeleteModal(false)} title="Delete Account">
        <p className="text-sm text-text-secondary mb-4">
          This will permanently delete your account, all connected trading accounts, trade history, and saved cards.
          Type <span className="font-mono text-loss-primary">DELETE</span> to confirm.
        </p>
        <Input
          value={deleteConfirm}
          onChange={(e) => setDeleteConfirm(e.target.value)}
          placeholder="Type DELETE"
          className="mb-4"
        />
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowDeleteModal(false)} className="flex-1">Cancel</Button>
          <Button variant="danger" onClick={handleDeleteAccount} disabled={deleteConfirm !== 'DELETE'} className="flex-1">
            Delete Forever
          </Button>
        </div>
      </Modal>
    </>
  );
}
