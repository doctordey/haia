'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
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
          <TabsTrigger value="hitl">HITL</TabsTrigger>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="preferences">Preferences</TabsTrigger>
          <TabsTrigger value="data">Data</TabsTrigger>
        </TabsList>

        <TabsContent value="accounts" className="mt-4 space-y-4">
          <AccountsSection accounts={accounts} onRefetch={refetch} toast={toast} />
        </TabsContent>

        <TabsContent value="hitl" className="mt-4 space-y-4">
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

  async function handleToggleHitl(id: string, next: boolean) {
    setTogglingHitl(id);
    try {
      const res = await fetch(`/api/accounts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hitlEnabled: next }),
      });
      if (res.ok) {
        toast(next ? 'HITL enabled for this account' : 'HITL disabled', 'success');
        onRefetch();
      } else {
        const data = await res.json().catch(() => ({}));
        toast(data.error || 'Failed to update HITL', 'error');
      }
    } catch { toast('Failed to update HITL', 'error'); }
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
                    <p className="text-sm font-medium text-text-primary">{acc.name}</p>
                    <p className="text-xs text-text-tertiary">
                      {acc.server} · #{acc.login}
                      {acc.lastSyncAt && ` · Last sync: ${new Date(acc.lastSyncAt).toLocaleString()}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={acc.syncStatus === 'synced' ? 'profit' : acc.syncStatus === 'error' ? 'loss' : acc.syncStatus === 'syncing' ? 'info' : 'default'}>
                    {acc.syncStatus}
                  </Badge>
                  {acc.hitlEnabled && <Badge variant="info">HITL</Badge>}
                  <Button
                    variant={acc.hitlEnabled ? 'danger' : 'secondary'}
                    size="sm"
                    onClick={() => handleToggleHitl(acc.id, !acc.hitlEnabled)}
                    loading={togglingHitl === acc.id}
                    disabled={!acc.hitlEnabled && acc.accessMode !== 'trading'}
                    title={!acc.hitlEnabled && acc.accessMode !== 'trading' ? 'Requires a trading password (read-only account)' : 'Enable approved-trade execution on this account'}
                  >
                    {acc.hitlEnabled ? 'Disable HITL' : 'Enable HITL'}
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
    </>
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
