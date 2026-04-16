'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useAccounts } from '@/hooks/useAccounts';
import { cn } from '@/lib/utils';

interface SymbolMap {
  id: string;
  masterSymbol: string;
  slaveSymbol: string;
  isEnabled: boolean;
  sizingMode: string | null;
  multiplier: number | null;
  riskPercent: number | null;
  fixedLots: number | null;
  pipValuePerLot: number;
  minLotSize: number;
  lotStep: number;
  copySl: boolean;
  copyTp: boolean;
  applyOffset: boolean;
  offsetInstrument: string | null;
}

interface Slave {
  id: string;
  isEnabled: boolean;
  dryRun: boolean;
  sizingMode: string;
  multiplier: number;
  riskPercent: number;
  riskBase: string;
  maxRiskPercent: number;
  fixedLots: number;
  maxLotSize: number;
  maxLotsPerOrder: number;
  maxSlippage: number;
  directionFilter: string | null;
  maxOpenPositions: number | null;
  account: { id: string; name: string; platform: string };
  symbolMaps: SymbolMap[];
}

interface CopyGroup {
  id: string;
  name: string;
  isEnabled: boolean;
  masterAccount: { id: string; name: string; platform: string };
  masterAccountId: string;
  slaves: Slave[];
}

function useToast() {
  return (msg: string, _type: 'success' | 'error') => {
    console.log(`[toast] ${_type}: ${msg}`);
  };
}

export default function CopyTradingSettingsPage() {
  const { accounts } = useAccounts();
  const toast = useToast();
  const [groups, setGroups] = useState<CopyGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupMaster, setNewGroupMaster] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchGroups = useCallback(async () => {
    try {
      const res = await fetch('/api/copy-trading/groups');
      if (res.ok) {
        const data = await res.json();
        setGroups(data);
        if (data.length > 0 && !selectedGroup) setSelectedGroup(data[0].id);
      }
    } catch {} finally { setLoading(false); }
  }, [selectedGroup]);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  const handleCreateGroup = async () => {
    if (!newGroupName || !newGroupMaster) return;
    setCreating(true);
    try {
      const res = await fetch('/api/copy-trading/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newGroupName, masterAccountId: newGroupMaster }),
      });
      if (res.ok) {
        const group = await res.json();
        setNewGroupName('');
        setNewGroupMaster('');
        setSelectedGroup(group.id);
        fetchGroups();
        toast('Group created', 'success');
      }
    } catch {} finally { setCreating(false); }
  };

  const handleToggleGroup = async (groupId: string, isEnabled: boolean) => {
    await fetch(`/api/copy-trading/groups/${groupId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isEnabled }),
    });
    fetchGroups();
  };

  const handleDeleteGroup = async (groupId: string) => {
    await fetch(`/api/copy-trading/groups/${groupId}`, { method: 'DELETE' });
    if (selectedGroup === groupId) setSelectedGroup(null);
    fetchGroups();
  };

  const group = groups.find((g) => g.id === selectedGroup);

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-semibold">Copy Trading Settings</h1>

      {/* Create Group */}
      <Card>
        <CardHeader><h2 className="text-sm font-medium">Create Copy Group</h2></CardHeader>
        <CardContent className="pt-0 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input
              placeholder="Group Name (e.g. NQ Tradovate → MT5)"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              className="h-9 text-sm"
            />
            <select
              value={newGroupMaster}
              onChange={(e) => setNewGroupMaster(e.target.value)}
              className="h-9 px-3 bg-bg-tertiary border border-border-primary rounded-[var(--radius-md)] text-sm text-text-primary"
            >
              <option value="">Select Master Account...</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name} ({a.platform.toUpperCase()})</option>
              ))}
            </select>
            <Button onClick={handleCreateGroup} loading={creating} disabled={!newGroupName || !newGroupMaster}>
              Create Group
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Group Tabs */}
      {groups.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {groups.map((g) => (
            <button
              key={g.id}
              onClick={() => setSelectedGroup(g.id)}
              className={cn(
                'px-4 py-2 rounded-[var(--radius-md)] text-sm transition-colors cursor-pointer',
                selectedGroup === g.id ? 'bg-accent-primary text-white' : 'bg-bg-secondary text-text-secondary hover:text-text-primary border border-border-primary'
              )}
            >
              {g.name}
              {g.isEnabled ? ' ●' : ''}
            </button>
          ))}
        </div>
      )}

      {/* Selected Group Config */}
      {group && (
        <>
          {/* Group Controls */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-medium">{group.name}</h2>
                  <p className="text-xs text-text-tertiary mt-0.5">
                    Master: {group.masterAccount.name} ({group.masterAccount.platform.toUpperCase()})
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={group.isEnabled ? 'profit' : 'default'}>
                    {group.isEnabled ? 'Active' : 'Paused'}
                  </Badge>
                  <Button
                    variant="secondary" size="sm"
                    onClick={() => handleToggleGroup(group.id, !group.isEnabled)}
                  >
                    {group.isEnabled ? 'Pause' : 'Enable'}
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => handleDeleteGroup(group.id)}>
                    Delete
                  </Button>
                </div>
              </div>
            </CardHeader>
          </Card>

          {/* Slaves */}
          <SlaveManager group={group} accounts={accounts} onRefresh={fetchGroups} />
        </>
      )}
    </div>
  );
}

// ─── Slave Manager ────────────────────────────────────

function SlaveManager({
  group, accounts, onRefresh,
}: {
  group: CopyGroup;
  accounts: { id: string; name: string; platform: string }[];
  onRefresh: () => void;
}) {
  const [newSlaveAccount, setNewSlaveAccount] = useState('');
  const [adding, setAdding] = useState(false);

  const availableAccounts = accounts.filter(
    (a) => a.id !== group.masterAccountId && !group.slaves.some((s) => s.account.id === a.id)
  );

  const handleAddSlave = async () => {
    if (!newSlaveAccount) return;
    setAdding(true);
    try {
      await fetch('/api/copy-trading/slaves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: group.id, accountId: newSlaveAccount }),
      });
      setNewSlaveAccount('');
      onRefresh();
    } catch {} finally { setAdding(false); }
  };

  const handleUpdateSlave = async (slaveId: string, fields: Record<string, unknown>) => {
    await fetch(`/api/copy-trading/slaves/${slaveId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    onRefresh();
  };

  const handleDeleteSlave = async (slaveId: string) => {
    await fetch(`/api/copy-trading/slaves/${slaveId}`, { method: 'DELETE' });
    onRefresh();
  };

  return (
    <>
      {/* Add Slave */}
      <Card>
        <CardHeader><h3 className="text-sm font-medium">Slave Accounts</h3></CardHeader>
        <CardContent className="pt-0 space-y-3">
          <div className="flex gap-2">
            <select
              value={newSlaveAccount}
              onChange={(e) => setNewSlaveAccount(e.target.value)}
              className="flex-1 h-9 px-3 bg-bg-tertiary border border-border-primary rounded-[var(--radius-md)] text-sm text-text-primary"
            >
              <option value="">Add Slave Account...</option>
              {availableAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name} ({a.platform.toUpperCase()})</option>
              ))}
            </select>
            <Button onClick={handleAddSlave} loading={adding} disabled={!newSlaveAccount} size="sm">
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Slave Configs */}
      {group.slaves.map((slave) => (
        <SlaveConfig
          key={slave.id}
          slave={slave}
          groupId={group.id}
          onUpdate={(fields) => handleUpdateSlave(slave.id, fields)}
          onDelete={() => handleDeleteSlave(slave.id)}
          onRefresh={onRefresh}
        />
      ))}
    </>
  );
}

// ─── Slave Config ─────────────────────────────────────

function SlaveConfig({
  slave, groupId, onUpdate, onDelete, onRefresh,
}: {
  slave: Slave;
  groupId: string;
  onUpdate: (fields: Record<string, unknown>) => void;
  onDelete: () => void;
  onRefresh: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary">{slave.account.name}</span>
            <span className="text-xs text-text-tertiary">{slave.account.platform.toUpperCase()}</span>
            <Badge variant={slave.dryRun ? 'warning' : slave.isEnabled ? 'profit' : 'default'}>
              {slave.dryRun ? 'Dry Run' : slave.isEnabled ? 'Live' : 'Disabled'}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => onUpdate({ isEnabled: !slave.isEnabled })}>
              {slave.isEnabled ? 'Disable' : 'Enable'}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => onUpdate({ dryRun: !slave.dryRun })}>
              {slave.dryRun ? 'Go Live' : 'Dry Run'}
            </Button>
            <Button variant="danger" size="sm" onClick={onDelete}>Remove</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        {/* Sizing */}
        <div>
          <p className="text-xs text-text-secondary uppercase tracking-wide mb-2">Position Sizing</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="text-[10px] text-text-tertiary uppercase">Mode</label>
              <select
                value={slave.sizingMode}
                onChange={(e) => onUpdate({ sizingMode: e.target.value })}
                className="w-full h-8 px-2 bg-bg-tertiary border border-border-primary rounded-[var(--radius-sm)] text-xs text-text-primary"
              >
                <option value="fixed_multiplier">Fixed Multiplier</option>
                <option value="risk_percent">% Risk</option>
                <option value="fixed_lots">Fixed Lots</option>
              </select>
            </div>
            {slave.sizingMode === 'fixed_multiplier' && (
              <div>
                <label className="text-[10px] text-text-tertiary uppercase">Multiplier</label>
                <Input type="number" value={slave.multiplier} step={0.1}
                  onChange={(e) => onUpdate({ multiplier: parseFloat(e.target.value) || 1 })}
                  className="h-8 text-xs" />
              </div>
            )}
            {slave.sizingMode === 'risk_percent' && (
              <>
                <div>
                  <label className="text-[10px] text-text-tertiary uppercase">Risk %</label>
                  <Input type="number" value={slave.riskPercent} step={0.1}
                    onChange={(e) => onUpdate({ riskPercent: parseFloat(e.target.value) || 1 })}
                    className="h-8 text-xs" />
                </div>
                <div>
                  <label className="text-[10px] text-text-tertiary uppercase">Max Risk %</label>
                  <Input type="number" value={slave.maxRiskPercent} step={0.1}
                    onChange={(e) => onUpdate({ maxRiskPercent: parseFloat(e.target.value) || 5 })}
                    className="h-8 text-xs" />
                </div>
              </>
            )}
            {slave.sizingMode === 'fixed_lots' && (
              <div>
                <label className="text-[10px] text-text-tertiary uppercase">Lots</label>
                <Input type="number" value={slave.fixedLots} step={0.01}
                  onChange={(e) => onUpdate({ fixedLots: parseFloat(e.target.value) || 0.01 })}
                  className="h-8 text-xs" />
              </div>
            )}
            <div>
              <label className="text-[10px] text-text-tertiary uppercase">Max Lots/Order</label>
              <Input type="number" value={slave.maxLotsPerOrder} step={1}
                onChange={(e) => onUpdate({ maxLotsPerOrder: parseFloat(e.target.value) || 50 })}
                className="h-8 text-xs" />
            </div>
          </div>
        </div>

        {/* Symbol Maps */}
        <SymbolMapManager slaveId={slave.id} symbolMaps={slave.symbolMaps} onRefresh={onRefresh} />
      </CardContent>
    </Card>
  );
}

// ─── Symbol Map Manager ───────────────────────────────

function SymbolMapManager({
  slaveId, symbolMaps, onRefresh,
}: {
  slaveId: string;
  symbolMaps: SymbolMap[];
  onRefresh: () => void;
}) {
  const [masterSym, setMasterSym] = useState('');
  const [slaveSym, setSlaveSym] = useState('');
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    if (!masterSym || !slaveSym) return;
    setAdding(true);
    try {
      await fetch('/api/copy-trading/symbol-maps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slaveId, masterSymbol: masterSym, slaveSymbol: slaveSym }),
      });
      setMasterSym('');
      setSlaveSym('');
      onRefresh();
    } catch {} finally { setAdding(false); }
  };

  const handleToggle = async (mapId: string, isEnabled: boolean) => {
    await fetch(`/api/copy-trading/symbol-maps/${mapId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isEnabled }),
    });
    onRefresh();
  };

  const handleDelete = async (mapId: string) => {
    await fetch(`/api/copy-trading/symbol-maps/${mapId}`, { method: 'DELETE' });
    onRefresh();
  };

  const handleUpdateOffset = async (mapId: string, applyOffset: boolean, offsetInstrument: string | null) => {
    await fetch(`/api/copy-trading/symbol-maps/${mapId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ applyOffset, offsetInstrument }),
    });
    onRefresh();
  };

  return (
    <div>
      <p className="text-xs text-text-secondary uppercase tracking-wide mb-2">Symbol Mappings</p>

      {/* Add mapping */}
      <div className="flex gap-2 mb-3">
        <Input placeholder="Master (e.g. NQM6)" value={masterSym}
          onChange={(e) => setMasterSym(e.target.value)} className="h-8 text-xs flex-1" />
        <span className="flex items-center text-text-tertiary text-xs">→</span>
        <Input placeholder="Slave (e.g. NAS100)" value={slaveSym}
          onChange={(e) => setSlaveSym(e.target.value)} className="h-8 text-xs flex-1" />
        <Button size="sm" onClick={handleAdd} loading={adding} disabled={!masterSym || !slaveSym}>Add</Button>
      </div>

      {/* Existing maps */}
      {symbolMaps.length > 0 ? (
        <div className="space-y-2">
          {symbolMaps.map((sm) => (
            <div key={sm.id} className="flex items-center justify-between p-2 bg-bg-primary rounded-[var(--radius-sm)] border border-border-primary">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-text-primary">{sm.masterSymbol}</span>
                <span className="text-xs text-text-tertiary">→</span>
                <span className="text-xs font-mono text-text-primary">{sm.slaveSymbol}</span>
                {sm.applyOffset && (
                  <Badge variant="info">Offset: {sm.offsetInstrument}</Badge>
                )}
                {sm.copySl && <span className="text-[10px] text-text-tertiary">SL</span>}
                {sm.copyTp && <span className="text-[10px] text-text-tertiary">TP</span>}
              </div>
              <div className="flex items-center gap-1.5">
                <select
                  value={sm.applyOffset ? sm.offsetInstrument || '' : ''}
                  onChange={(e) => handleUpdateOffset(sm.id, !!e.target.value, e.target.value || null)}
                  className="h-7 px-1.5 bg-bg-tertiary border border-border-primary rounded text-[10px] text-text-primary"
                >
                  <option value="">No Offset</option>
                  <option value="NQ">NQ Offset</option>
                  <option value="ES">ES Offset</option>
                </select>
                <Button variant="secondary" size="sm" onClick={() => handleToggle(sm.id, !sm.isEnabled)}>
                  {sm.isEnabled ? 'On' : 'Off'}
                </Button>
                <button onClick={() => handleDelete(sm.id)} className="text-text-tertiary hover:text-loss-primary transition-colors cursor-pointer">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-text-tertiary">No symbol mappings yet. Add one above to start copying trades for that symbol.</p>
      )}
    </div>
  );
}
