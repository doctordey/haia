'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/hooks/useToast';
import { formatCurrency, pnlColor } from '@/lib/utils';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';

// ─── Types ────────────────────────────────────────────

interface JournalEntry {
  id: string;
  setupType: string | null;
  reasoning: string | null;
  review: string | null;
  emotionalState: string | null;
  rating: number | null;
  tags: string | null; // JSON array
  screenshotUrls: string | null;
  symbol: string | null;
  direction: string | null;
  pnl: number | null;
  pnlPips: number | null;
  entryTime: string | null;
  exitTime: string | null;
  signalExecutionId: string | null;
  tradeId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Stats {
  total: number;
  withPnl: number;
  bySetup: Record<string, { count: number; wins: number; totalPnl: number; winRate: string }>;
  byEmotion: Record<string, { count: number; wins: number; totalPnl: number; winRate: string }>;
  byRating: number[];
  topTags: { tag: string; count: number }[];
}

const SETUP_TYPES = [
  { value: '', label: 'All Setup Types' },
  { value: 'breakout', label: 'Breakout' },
  { value: 'pullback', label: 'Pullback' },
  { value: 'reversal', label: 'Reversal' },
  { value: 'signal_copy', label: 'Signal Copy' },
];

const EMOTIONS = [
  { value: '', label: 'All Emotions' },
  { value: 'confident', label: 'Confident' },
  { value: 'hesitant', label: 'Hesitant' },
  { value: 'fomo', label: 'FOMO' },
  { value: 'revenge', label: 'Revenge' },
  { value: 'calm', label: 'Calm' },
];

const EMOTION_COLORS: Record<string, string> = {
  confident: 'profit', calm: 'profit', hesitant: 'warning', fomo: 'loss', revenge: 'loss',
};

// ─── Main Page ────────────────────────────────────────

export default function JournalPage() {
  const { toast } = useToast();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Filters
  const [setupType, setSetupType] = useState('');
  const [instrument, setInstrument] = useState('');
  const [emotionalState, setEmotionalState] = useState('');
  const [signalOnly, setSignalOnly] = useState(false);

  // Editor
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);
  const [showNew, setShowNew] = useState(false);

  // View
  const [tab, setTab] = useState<'timeline' | 'stats'>('timeline');

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (setupType) params.set('setupType', setupType);
      if (instrument) params.set('instrument', instrument);
      if (emotionalState) params.set('emotionalState', emotionalState);
      if (signalOnly) params.set('signalOnly', 'true');

      const res = await fetch(`/api/journal?${params}`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
        setTotalPages(data.pagination?.totalPages || 1);
      }
    } catch {
      toast('Failed to load journal', 'error');
    } finally {
      setLoading(false);
    }
  }, [page, setupType, instrument, emotionalState, signalOnly, toast]);

  const fetchStats = useCallback(async () => {
    try {
      const [statsRes, tagsRes] = await Promise.all([
        fetch('/api/journal/stats'),
        fetch('/api/journal/tags'),
      ]);
      if (statsRes.ok) setStats(await statsRes.json());
      if (tagsRes.ok) setAllTags(await tagsRes.json());
    } catch {}
  }, []);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  const handleSaved = () => {
    setEditingEntry(null);
    setShowNew(false);
    fetchEntries();
    fetchStats();
  };

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/journal/${id}`, { method: 'DELETE' });
      toast('Entry deleted', 'success');
      fetchEntries();
      fetchStats();
    } catch {
      toast('Delete failed', 'error');
    }
  };

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Trade Journal</h1>
        <div className="flex gap-2">
          <div className="flex gap-1">
            {(['timeline', 'stats'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 text-xs rounded-[var(--radius-sm)] transition-colors cursor-pointer ${
                  tab === t ? 'bg-accent-primary text-white' : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                }`}
              >
                {t === 'timeline' ? 'Timeline' : 'Stats'}
              </button>
            ))}
          </div>
          <Button size="sm" onClick={() => setShowNew(true)}>New Entry</Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-3">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="w-40">
              <Select label="" value={setupType} onChange={(e) => { setSetupType(e.target.value); setPage(1); }} options={SETUP_TYPES} />
            </div>
            <div className="w-36">
              <Select label="" value={instrument} onChange={(e) => { setInstrument(e.target.value); setPage(1); }}
                options={[{ value: '', label: 'All Instruments' }, { value: 'NAS100', label: 'NAS100' }, { value: 'US500', label: 'US500' }]}
              />
            </div>
            <div className="w-36">
              <Select label="" value={emotionalState} onChange={(e) => { setEmotionalState(e.target.value); setPage(1); }} options={EMOTIONS} />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
              <input type="checkbox" checked={signalOnly} onChange={(e) => { setSignalOnly(e.target.checked); setPage(1); }} className="rounded" />
              Signal copies only
            </label>
          </div>
        </CardContent>
      </Card>

      {tab === 'timeline' ? (
        <>
          <Timeline
            entries={entries}
            loading={loading}
            onEdit={setEditingEntry}
            onDelete={handleDelete}
          />

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <span className="text-xs text-text-secondary">Page {page} of {totalPages}</span>
              <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          )}
        </>
      ) : (
        <StatsPanel stats={stats} />
      )}

      {/* Entry editor modal */}
      {(editingEntry || showNew) && (
        <EntryEditor
          entry={editingEntry}
          allTags={allTags}
          onClose={() => { setEditingEntry(null); setShowNew(false); }}
          onSaved={handleSaved}
          toast={toast}
        />
      )}
    </div>
  );
}

// ─── Timeline ─────────────────────────────────────────

function Timeline({
  entries,
  loading,
  onEdit,
  onDelete,
}: {
  entries: JournalEntry[];
  loading: boolean;
  onEdit: (e: JournalEntry) => void;
  onDelete: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <Card key={i}><CardContent><div className="h-20 animate-pulse bg-bg-tertiary rounded" /></CardContent></Card>
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-text-tertiary text-sm">No journal entries yet.</p>
          <p className="text-text-tertiary text-xs mt-1">Signal-copied trades will appear here automatically.</p>
        </CardContent>
      </Card>
    );
  }

  // Group by day
  const grouped = new Map<string, JournalEntry[]>();
  for (const entry of entries) {
    const day = new Date(entry.createdAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const arr = grouped.get(day) || [];
    arr.push(entry);
    grouped.set(day, arr);
  }

  return (
    <div className="space-y-4">
      {[...grouped.entries()].map(([day, dayEntries]) => (
        <div key={day}>
          <p className="text-xs text-text-tertiary uppercase tracking-wide font-medium mb-2 px-1">{day}</p>
          <div className="space-y-2">
            {dayEntries.map((entry) => (
              <JournalCard key={entry.id} entry={entry} onEdit={() => onEdit(entry)} onDelete={() => onDelete(entry.id)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function JournalCard({
  entry,
  onEdit,
  onDelete,
}: {
  entry: JournalEntry;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const tags: string[] = entry.tags ? (() => { try { return JSON.parse(entry.tags); } catch { return []; } })() : [];
  const isSignalCopy = entry.setupType === 'signal_copy';

  return (
    <Card hover>
      <CardContent className="py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {entry.symbol && <span className="text-sm font-medium">{entry.symbol}</span>}
              {entry.direction && (
                <Badge variant={entry.direction === 'LONG' || entry.direction === 'BUY' ? 'profit' : 'loss'}>
                  {entry.direction}
                </Badge>
              )}
              {entry.setupType && (
                <Badge variant={isSignalCopy ? 'info' : 'default'}>
                  {entry.setupType === 'signal_copy' ? 'Signal Copy' : entry.setupType}
                </Badge>
              )}
              {entry.emotionalState && (
                <Badge variant={(EMOTION_COLORS[entry.emotionalState] || 'default') as 'profit' | 'loss' | 'warning' | 'default'}>
                  {entry.emotionalState}
                </Badge>
              )}
              {entry.rating && <Stars rating={entry.rating} />}
            </div>

            {entry.reasoning && (
              <p className="text-xs text-text-secondary mt-1.5 line-clamp-2">{entry.reasoning}</p>
            )}
            {entry.review && (
              <p className="text-xs text-text-tertiary mt-1 line-clamp-1 italic">{entry.review}</p>
            )}

            {tags.length > 0 && (
              <div className="flex gap-1 mt-1.5 flex-wrap">
                {tags.map((tag) => (
                  <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-bg-tertiary rounded text-text-secondary">#{tag}</span>
                ))}
              </div>
            )}
          </div>

          <div className="text-right shrink-0">
            {entry.pnl != null && (
              <p className={`text-sm font-mono font-bold ${pnlColor(entry.pnl)}`}>
                {entry.pnl >= 0 ? '+' : ''}{formatCurrency(entry.pnl)}
              </p>
            )}
            <p className="text-[10px] text-text-tertiary mt-0.5">
              {new Date(entry.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
            </p>
            <div className="flex gap-1 mt-1">
              <button onClick={onEdit} className="text-[10px] text-accent-primary hover:underline cursor-pointer">Edit</button>
              <button onClick={onDelete} className="text-[10px] text-loss-primary hover:underline cursor-pointer">Del</button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`text-xs ${i <= rating ? 'text-warning' : 'text-text-tertiary'}`}>★</span>
      ))}
    </span>
  );
}

// ─── Entry Editor Modal ───────────────────────────────

function EntryEditor({
  entry,
  allTags,
  onClose,
  onSaved,
  toast,
}: {
  entry: JournalEntry | null;
  allTags: string[];
  onClose: () => void;
  onSaved: () => void;
  toast: (msg: string, type?: string) => void;
}) {
  const isEdit = entry != null;
  const [saving, setSaving] = useState(false);

  const [setupType, setSetupType] = useState(entry?.setupType || '');
  const [reasoning, setReasoning] = useState(entry?.reasoning || '');
  const [review, setReview] = useState(entry?.review || '');
  const [emotionalState, setEmotionalState] = useState(entry?.emotionalState || '');
  const [rating, setRating] = useState(entry?.rating || 0);
  const [symbol, setSymbol] = useState(entry?.symbol || '');
  const [direction, setDirection] = useState(entry?.direction || '');
  const [pnl, setPnl] = useState(entry?.pnl != null ? String(entry.pnl) : '');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>(() => {
    if (!entry?.tags) return [];
    try { return JSON.parse(entry.tags); } catch { return []; }
  });

  const addTag = (tag: string) => {
    const clean = tag.trim().toLowerCase();
    if (clean && !tags.includes(clean)) {
      setTags([...tags, clean]);
    }
    setTagInput('');
  };

  const removeTag = (tag: string) => setTags(tags.filter((t) => t !== tag));

  const handleSave = async () => {
    setSaving(true);
    try {
      const body = {
        setupType: setupType || null,
        reasoning: reasoning || null,
        review: review || null,
        emotionalState: emotionalState || null,
        rating: rating || null,
        tags: tags.length > 0 ? tags : null,
        symbol: symbol || null,
        direction: direction || null,
        pnl: pnl ? parseFloat(pnl) : null,
      };

      const url = isEdit ? `/api/journal/${entry.id}` : '/api/journal';
      const method = isEdit ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error('Save failed');
      toast(isEdit ? 'Entry updated' : 'Entry created', 'success');
      onSaved();
    } catch {
      toast('Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Tag suggestions (autocomplete from existing tags)
  const suggestions = tagInput.length >= 1
    ? allTags.filter((t) => t.startsWith(tagInput.toLowerCase()) && !tags.includes(t)).slice(0, 5)
    : [];

  return (
    <Modal open onClose={onClose} title={isEdit ? 'Edit Journal Entry' : 'New Journal Entry'}>
      <div className="space-y-4 max-h-[70vh] overflow-y-auto">
        <div className="grid grid-cols-2 gap-3">
          <Input label="Symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="NAS100" />
          <Select label="Direction" value={direction} onChange={(e) => setDirection(e.target.value)}
            options={[{ value: '', label: '—' }, { value: 'LONG', label: 'Long' }, { value: 'SHORT', label: 'Short' }]}
          />
        </div>

        <Select
          label="Setup Type"
          value={setupType}
          onChange={(e) => setSetupType(e.target.value)}
          options={[
            { value: '', label: '—' },
            { value: 'breakout', label: 'Breakout' },
            { value: 'pullback', label: 'Pullback' },
            { value: 'reversal', label: 'Reversal' },
            { value: 'signal_copy', label: 'Signal Copy' },
            { value: 'custom', label: 'Custom' },
          ]}
        />

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-text-secondary">Pre-Trade Reasoning</label>
          <textarea
            value={reasoning}
            onChange={(e) => setReasoning(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 bg-bg-tertiary border border-border-primary rounded-[var(--radius-md)] text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary transition-colors resize-none"
            placeholder="What was your thesis?"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-text-secondary">Post-Trade Review</label>
          <textarea
            value={review}
            onChange={(e) => setReview(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 bg-bg-tertiary border border-border-primary rounded-[var(--radius-md)] text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary transition-colors resize-none"
            placeholder="What happened? What did you learn?"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Emotional State"
            value={emotionalState}
            onChange={(e) => setEmotionalState(e.target.value)}
            options={EMOTIONS}
          />
          <Input label="P&L ($)" type="number" value={pnl} onChange={(e) => setPnl(e.target.value)} placeholder="0.00" />
        </div>

        {/* Rating stars */}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-text-secondary">Self-Rating</label>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((i) => (
              <button
                key={i}
                onClick={() => setRating(rating === i ? 0 : i)}
                className={`text-xl cursor-pointer transition-colors ${i <= rating ? 'text-warning' : 'text-text-tertiary hover:text-warning'}`}
              >
                ★
              </button>
            ))}
            {rating > 0 && <span className="text-xs text-text-secondary self-center ml-1">{rating}/5</span>}
          </div>
        </div>

        {/* Tags */}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-text-secondary">Tags</label>
          <div className="flex flex-wrap gap-1 mb-1.5">
            {tags.map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-bg-tertiary rounded text-text-secondary">
                #{tag}
                <button onClick={() => removeTag(tag)} className="text-text-tertiary hover:text-loss-primary cursor-pointer">×</button>
              </span>
            ))}
          </div>
          <div className="relative">
            <Input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && tagInput.trim()) { e.preventDefault(); addTag(tagInput); }
              }}
              placeholder="Add tag..."
            />
            {suggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-bg-secondary border border-border-primary rounded-[var(--radius-md)] overflow-hidden z-10">
                {suggestions.map((s) => (
                  <button key={s} onClick={() => addTag(s)} className="block w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-hover cursor-pointer">
                    #{s}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} loading={saving}>{isEdit ? 'Update' : 'Create'}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Stats Panel ──────────────────────────────────────

function StatsPanel({ stats }: { stats: Stats | null }) {
  if (!stats) {
    return <div className="animate-pulse h-64 bg-bg-tertiary rounded" />;
  }

  const setupData = Object.entries(stats.bySetup).map(([name, data]) => ({
    name: name === 'signal_copy' ? 'Signal Copy' : name.charAt(0).toUpperCase() + name.slice(1),
    pnl: data.totalPnl,
    winRate: parseFloat(data.winRate),
    count: data.count,
  }));

  const emotionData = Object.entries(stats.byEmotion).map(([name, data]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    winRate: parseFloat(data.winRate),
    count: data.count,
    pnl: data.totalPnl,
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* P&L by Setup Type */}
      <Card>
        <CardHeader><h3 className="text-sm font-medium">P&L by Setup Type</h3></CardHeader>
        <CardContent>
          {setupData.length === 0 ? (
            <p className="text-xs text-text-tertiary py-4">No data yet</p>
          ) : (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={setupData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                  <XAxis dataKey="name" stroke="var(--text-tertiary)" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--text-tertiary)" fontSize={10} tickLine={false} axisLine={false} width={50} tickFormatter={(v) => `$${v}`} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-secondary)',
                      borderRadius: 'var(--radius-md)', fontSize: '11px', color: 'var(--text-primary)',
                    }}
                    formatter={(value) => [`$${Number(value).toFixed(2)}`, 'P&L']}
                  />
                  <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                    {setupData.map((entry, i) => (
                      <Cell key={i} fill={entry.pnl >= 0 ? '#00DC82' : '#FF4D6A'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Win Rate by Emotional State */}
      <Card>
        <CardHeader><h3 className="text-sm font-medium">Win Rate by Emotional State</h3></CardHeader>
        <CardContent>
          {emotionData.length === 0 ? (
            <p className="text-xs text-text-tertiary py-4">No data yet</p>
          ) : (
            <div className="space-y-2">
              {emotionData.map((d) => (
                <div key={d.name} className="flex items-center gap-3">
                  <span className="text-xs text-text-secondary w-20 shrink-0">{d.name}</span>
                  <div className="flex-1 bg-bg-tertiary rounded-full h-4 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${d.winRate}%`, backgroundColor: d.winRate >= 50 ? '#00DC82' : '#FF4D6A' }}
                    />
                  </div>
                  <span className="text-xs font-mono text-text-primary w-14 text-right">{d.winRate}%</span>
                  <span className="text-[10px] text-text-tertiary w-8">({d.count})</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Rating Distribution */}
      <Card>
        <CardHeader><h3 className="text-sm font-medium">Rating Distribution</h3></CardHeader>
        <CardContent>
          <div className="flex items-end gap-2 h-24">
            {stats.byRating.map((count, i) => {
              const max = Math.max(...stats.byRating, 1);
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full bg-accent-primary/20 rounded-t relative" style={{ height: `${(count / max) * 100}%`, minHeight: count > 0 ? 4 : 0 }}>
                    {count > 0 && (
                      <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-[10px] text-text-secondary">{count}</span>
                    )}
                  </div>
                  <span className="text-[10px] text-text-tertiary">{i + 1}★</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Top Tags */}
      <Card>
        <CardHeader><h3 className="text-sm font-medium">Top Tags</h3></CardHeader>
        <CardContent>
          {stats.topTags.length === 0 ? (
            <p className="text-xs text-text-tertiary py-4">No tags yet</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {stats.topTags.map(({ tag, count }) => (
                <span key={tag} className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-bg-tertiary rounded-[var(--radius-sm)] text-text-secondary">
                  #{tag} <span className="text-text-tertiary">({count})</span>
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
