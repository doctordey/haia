'use client';

import { useState, useEffect, useRef, useCallback, type ChangeEvent } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CardPreview, type MetricType, type AspectRatio, type CardLayout, type FlexCardData } from '@/components/flex-card/card-preview';
import { themes, type ThemeId } from '@/components/flex-card/themes';
import { useAccounts } from '@/hooks/useAccounts';
import { useSession } from 'next-auth/react';
import { cn } from '@/lib/utils';

const periods = ['1D', '7D', '30D', '90D', '1Y', 'MAX'];
const metrics: { id: MetricType; label: string }[] = [
  { id: 'pnl', label: 'Total PNL' },
  { id: 'winrate', label: 'Win Rate' },
  { id: 'profitfactor', label: 'Profit Factor' },
  { id: 'monthlyreturn', label: 'Monthly Return' },
  { id: 'sharpe', label: 'Sharpe Ratio' },
  { id: 'pctgain', label: '% Gain' },
  { id: 'pips', label: 'Pips' },
  { id: 'calendar', label: 'Calendar View' },
];
const aspectRatios: { id: AspectRatio; label: string }[] = [
  { id: 'square', label: '1:1' },
  { id: 'landscape', label: '16:9' },
  { id: 'story', label: '9:16' },
];

export default function FlexCardsPage() {
  const { selectedAccountId, accounts, loading: accountsLoading } = useAccounts();
  const { data: session } = useSession();
  const previewRef = useRef<HTMLDivElement>(null);

  const [period, setPeriod] = useState('30D');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');
  const [metric, setMetric] = useState<MetricType>('pnl');
  const [themeId, setThemeId] = useState<ThemeId>('clean-minimal');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('square');
  const [cardLayout, setCardLayout] = useState<CardLayout>('default');
  const [showUsername, setShowUsername] = useState(true);
  const [showChart, setShowChart] = useState(true);
  const [showWinLoss, setShowWinLoss] = useState(true);
  const [showBranding, setShowBranding] = useState(true);
  const [customBgUrl, setCustomBgUrl] = useState('');
  const [cardData, setCardData] = useState<FlexCardData>({ period: '30D' });
  const [savedCards, setSavedCards] = useState<{ id: string; metric: string; period: string; backgroundTheme: string; createdAt: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Fetch card data
  useEffect(() => {
    if (!selectedAccountId) return;

    async function fetchData() {
      try {
        const [dashRes, calRes] = await Promise.all([
          fetch(`/api/dashboard/${selectedAccountId}`),
          metric === 'calendar'
            ? fetch(`/api/calendar/${selectedAccountId}/${new Date().getFullYear()}/${new Date().getMonth() + 1}`)
            : Promise.resolve(null),
        ]);

        const dash = dashRes.ok ? await dashRes.json() : {};
        const calDays = calRes && calRes.ok ? await calRes.json() : [];

        const startBalance = (dash.balance || 0) - (dash.totalPnl || 0);
        const profitDays = calDays.filter((d: { pnl: number }) => d.pnl > 0);
        const lossDays = calDays.filter((d: { pnl: number }) => d.pnl < 0);

        setCardData({
          period: period === 'custom' && customDateFrom
            ? customDateTo ? `${customDateFrom} – ${customDateTo}` : customDateFrom
            : period,
          username: session?.user?.name || session?.user?.email?.split('@')[0] || 'trader',
          totalPnl: dash.totalPnl || 0,
          pctGain: dash.pnlPercent || 0,
          tradeCount: dash.totalTrades || 0,
          winRate: dash.winRate || 0,
          winningTrades: dash.winningTrades || 0,
          losingTrades: dash.losingTrades || 0,
          profitFactor: dash.profitFactor || 0,
          monthlyReturn: dash.pnlPercent || 0,
          startBalance,
          endBalance: dash.balance || 0,
          sharpeRatio: dash.sharpeRatio || 0,
          meanReturn: dash.totalPnl ? dash.totalPnl / (dash.totalTrades || 1) : 0,
          stdDev: 0,
          totalPips: dash.totalPips || 0,
          avgPipsPerTrade: dash.avgPipsPerTrade || 0,
          bestTradePips: dash.bestTradePips || 0,
          grossProfit: (dash.winningTrades || 0) * (dash.averageWin || 0),
          grossLoss: (dash.losingTrades || 0) * (dash.averageLoss || 0),
          calendarDays: calDays,
          calendarYear: new Date().getFullYear(),
          calendarMonth: new Date().getMonth() + 1,
          winDays: profitDays.length,
          lossDays: lossDays.length,
        });
      } catch (err) {
        console.error('Failed to fetch card data:', err);
      }
    }

    fetchData();
  }, [selectedAccountId, period, metric, customDateFrom, customDateTo]);

  // Fetch saved cards
  useEffect(() => {
    async function fetchSaved() {
      try {
        const res = await fetch('/api/flex-cards');
        if (res.ok) setSavedCards(await res.json());
      } catch (err) {
        console.error('Failed to fetch saved cards:', err);
      }
    }
    fetchSaved();
  }, []);

  const handleExportPng = useCallback(async () => {
    const el = document.getElementById('flex-card-preview');
    if (!el) return;
    setExporting(true);
    try {
      const { toPng } = await import('html-to-image');
      const dataUrl = await toPng(el, { pixelRatio: 2 });
      const link = document.createElement('a');
      link.download = `haia-${metric}-${period}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  }, [metric, period]);

  const handleCopyClipboard = useCallback(async () => {
    const el = document.getElementById('flex-card-preview');
    if (!el) return;
    setExporting(true);
    try {
      const { toBlob, toPng } = await import('html-to-image');
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        const blob = await toBlob(el, { pixelRatio: 2 });
        if (blob) {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        }
      } else {
        // Fallback: try opening image in new tab, or download
        const dataUrl = await toPng(el, { pixelRatio: 2 });
        const win = window.open();
        if (win) {
          win.document.write(`<img src="${dataUrl}" />`);
          win.document.title = 'Haia Flex Card — Right-click to copy';
        } else {
          // Popup blocked — trigger download instead
          const link = document.createElement('a');
          link.download = `haia-${metric}-${period}.png`;
          link.href = dataUrl;
          link.click();
        }
      }
    } catch (err) {
      console.error('Copy failed:', err);
    } finally {
      setExporting(false);
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!selectedAccountId) return;
    setSaving(true);
    try {
      const res = await fetch('/api/flex-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: selectedAccountId,
          period,
          metric,
          backgroundTheme: themeId,
          customBgUrl: themeId === 'custom' ? customBgUrl : null,
          showUsername,
          showChart,
          showWinLoss,
          showBranding,
        }),
      });
      if (res.ok) {
        const card = await res.json();
        setSavedCards((prev) => [card, ...prev]);
      }
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  }, [selectedAccountId, period, metric, themeId, customBgUrl, showUsername, showChart, showWinLoss, showBranding]);

  const handleDeleteCard = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/flex-cards/${id}`, { method: 'DELETE' });
      if (res.ok) setSavedCards((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      console.error('Failed to delete card:', err);
    }
  }, []);

  const handleCustomBg = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 512000) { alert('Max 0.5MB'); return; }
    const reader = new FileReader();
    reader.onload = () => { setCustomBgUrl(reader.result as string); setThemeId('custom'); };
    reader.readAsDataURL(file);
  }, []);

  if (!accountsLoading && accounts.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-56px)]">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-text-primary mb-1">No accounts connected</h2>
          <p className="text-sm text-text-secondary mb-4">Connect your MetaTrader account to create flex cards.</p>
          <a href="/connect" className="inline-flex items-center px-4 py-2 bg-accent-primary text-white rounded-[var(--radius-md)] text-sm font-medium hover:bg-accent-hover transition-colors">Connect Account</a>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-semibold">Flex Cards</h1>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4">
        {/* Left: Preview */}
        <Card>
          <CardContent className="flex items-center justify-center p-6">
            <div className="w-full max-w-[420px]" ref={previewRef}>
              <CardPreview
                metric={metric}
                data={cardData}
                theme={themeId}
                customBgUrl={customBgUrl}
                aspectRatio={aspectRatio}
                layout={cardLayout}
                showUsername={showUsername}
                showChart={showChart}
                showWinLoss={showWinLoss}
                showBranding={showBranding}
              />
            </div>
          </CardContent>
        </Card>

        {/* Right: Controls */}
        <div className="space-y-3">
          {/* Time Period */}
          <Card>
            <CardHeader><h3 className="text-xs font-medium text-text-secondary uppercase tracking-wide">Time Period</h3></CardHeader>
            <CardContent className="pt-0 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {periods.map((p) => (
                  <button
                    key={p}
                    onClick={() => { setPeriod(p); setCustomDateFrom(''); setCustomDateTo(''); }}
                    className={cn(
                      'px-3 py-1.5 text-xs rounded-[var(--radius-sm)] transition-colors cursor-pointer',
                      period === p && !customDateFrom ? 'bg-accent-primary text-white' : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
                    )}
                  >
                    {p}
                  </button>
                ))}
                <button
                  onClick={() => setPeriod('custom')}
                  className={cn(
                    'px-3 py-1.5 text-xs rounded-[var(--radius-sm)] transition-colors cursor-pointer',
                    period === 'custom' ? 'bg-accent-primary text-white' : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
                  )}
                >
                  Custom
                </button>
              </div>
              {period === 'custom' && (
                <div className="flex gap-2">
                  <Input
                    type="date"
                    value={customDateFrom}
                    onChange={(e) => setCustomDateFrom(e.target.value)}
                    className="h-8 text-xs flex-1"
                    placeholder="From"
                  />
                  <Input
                    type="date"
                    value={customDateTo}
                    onChange={(e) => setCustomDateTo(e.target.value)}
                    className="h-8 text-xs flex-1"
                    placeholder="To"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Metric */}
          <Card>
            <CardHeader><h3 className="text-xs font-medium text-text-secondary uppercase tracking-wide">Metric</h3></CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-2 gap-1.5">
                {metrics.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setMetric(m.id)}
                    className={cn(
                      'px-3 py-2 text-xs rounded-[var(--radius-sm)] transition-colors text-left cursor-pointer',
                      metric === m.id ? 'bg-accent-primary text-white' : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Theme */}
          <Card>
            <CardHeader><h3 className="text-xs font-medium text-text-secondary uppercase tracking-wide">Background Theme</h3></CardHeader>
            <CardContent className="pt-0">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {themes.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setThemeId(t.id)}
                    className={cn(
                      'w-14 h-14 rounded-[var(--radius-md)] border-2 transition-all shrink-0 cursor-pointer',
                      themeId === t.id ? 'border-accent-primary' : 'border-border-primary hover:border-border-secondary'
                    )}
                    style={{ background: t.css }}
                    title={t.name}
                  />
                ))}
                <label
                  className={cn(
                    'w-14 h-14 rounded-[var(--radius-md)] border-2 flex items-center justify-center shrink-0 cursor-pointer',
                    themeId === 'custom' ? 'border-accent-primary' : 'border-border-primary hover:border-border-secondary',
                    'bg-bg-tertiary'
                  )}
                  title="Custom Upload"
                >
                  <svg className="w-5 h-5 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  <input type="file" className="hidden" accept=".jpg,.jpeg,.png,.webp" onChange={handleCustomBg} />
                </label>
              </div>
            </CardContent>
          </Card>

          {/* Layout + Aspect Ratio */}
          <Card>
            <CardHeader><h3 className="text-xs font-medium text-text-secondary uppercase tracking-wide">Layout</h3></CardHeader>
            <CardContent className="pt-0 space-y-3">
              <div className="flex gap-1.5">
                {([
                  { id: 'default' as CardLayout, label: 'Haia' },
                  { id: 'terminal' as CardLayout, label: 'Terminal' },
                ]).map((l) => (
                  <button
                    key={l.id}
                    onClick={() => setCardLayout(l.id)}
                    className={cn(
                      'flex-1 px-3 py-1.5 text-xs rounded-[var(--radius-sm)] transition-colors cursor-pointer',
                      cardLayout === l.id ? 'bg-accent-primary text-white' : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
                    )}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
              <div>
                <p className="text-[10px] text-text-tertiary uppercase tracking-wide mb-1.5">Aspect Ratio</p>
                <div className="flex gap-1.5">
                  {aspectRatios.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => setAspectRatio(a.id)}
                      className={cn(
                        'flex-1 px-3 py-1.5 text-xs rounded-[var(--radius-sm)] transition-colors cursor-pointer',
                        aspectRatio === a.id ? 'bg-accent-primary text-white' : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
                      )}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Toggles */}
          <Card>
            <CardHeader><h3 className="text-xs font-medium text-text-secondary uppercase tracking-wide">Elements</h3></CardHeader>
            <CardContent className="pt-0 space-y-2">
              {[
                { label: 'Username', checked: showUsername, onChange: setShowUsername },
                { label: 'Mini Chart', checked: showChart, onChange: setShowChart },
                { label: 'Win/Loss Stats', checked: showWinLoss, onChange: setShowWinLoss },
                { label: 'Branding', checked: showBranding, onChange: setShowBranding },
              ].map((toggle) => (
                <div key={toggle.label} className="flex items-center justify-between">
                  <span className="text-xs text-text-secondary" id={`toggle-${toggle.label.replace(/\s+/g, '-').toLowerCase()}`}>{toggle.label}</span>
                  <button
                    role="switch"
                    aria-checked={toggle.checked}
                    aria-labelledby={`toggle-${toggle.label.replace(/\s+/g, '-').toLowerCase()}`}
                    onClick={() => toggle.onChange(!toggle.checked)}
                    className={cn(
                      'w-9 h-5 rounded-full transition-colors relative cursor-pointer',
                      toggle.checked ? 'bg-accent-primary' : 'bg-bg-tertiary'
                    )}
                  >
                    <div className={cn(
                      'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform',
                      toggle.checked ? 'translate-x-4' : 'translate-x-0.5'
                    )} />
                  </button>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex gap-2">
            <Button className="flex-1" onClick={handleExportPng} loading={exporting}>Download PNG</Button>
            <Button variant="secondary" className="flex-1" onClick={handleCopyClipboard} loading={exporting}>Copy</Button>
          </div>
          <Button variant="secondary" className="w-full" onClick={handleSave} loading={saving}>Save Card</Button>
        </div>
      </div>

      {/* Saved Cards */}
      {savedCards.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-text-secondary mb-3">Saved Cards</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {savedCards.map((card) => (
              <div key={card.id} className="bg-bg-secondary border border-border-primary rounded-[var(--radius-md)] p-3 group relative">
                <p className="text-xs font-medium text-text-primary capitalize">{card.metric}</p>
                <p className="text-[10px] text-text-tertiary">{card.period} · {card.backgroundTheme}</p>
                <p className="text-[10px] text-text-tertiary mt-1">{new Date(card.createdAt).toLocaleDateString()}</p>
                <button
                  onClick={() => handleDeleteCard(card.id)}
                  className="absolute top-2 right-2 text-text-tertiary hover:text-loss-primary opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
