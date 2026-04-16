'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

type Step = 'platform' | 'credentials' | 'connecting' | 'syncing' | 'success';

export default function ConnectPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('platform');
  const [platform, setPlatform] = useState<'mt4' | 'mt5' | 'tradovate'>('mt5');
  const [form, setForm] = useState({
    server: '', login: '', password: '', tradingPassword: '', name: '',
    tradovateUsername: '', tradovatePassword: '', tradovateApiSecret: '',
    tradovateCid: '', tradovateEnvironment: 'demo',
  });
  const [error, setError] = useState('');
  const [syncStatus, setSyncStatus] = useState('');
  const [useTrading, setUseTrading] = useState(false);

  function updateField(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleConnect() {
    setError('');
    setStep('connecting');

    try {
      const payload = platform === 'tradovate'
        ? {
            platform: 'tradovate',
            name: form.name,
            tradovateUsername: form.tradovateUsername,
            tradovatePassword: form.tradovatePassword,
            tradovateApiSecret: form.tradovateApiSecret || undefined,
            tradovateCid: form.tradovateCid ? parseInt(form.tradovateCid) : undefined,
            tradovateEnvironment: form.tradovateEnvironment,
          }
        : {
            ...form,
            platform,
            password: useTrading ? form.tradingPassword : form.password,
            accessMode: useTrading ? 'trading' : 'investor',
          };

      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to connect account');
        setStep('credentials');
        return;
      }

      const account = await res.json();

      if (platform === 'tradovate') {
        setStep('success');
      } else {
        setStep('syncing');
        setSyncStatus('Importing trade history...');
        const syncRes = await fetch(`/api/accounts/${account.id}/sync`, { method: 'POST' });
        if (syncRes.ok) {
          setStep('success');
        } else {
          setSyncStatus('Sync started — you can check progress on the dashboard.');
          setStep('success');
        }
      }
    } catch {
      setError('Connection failed. Please check your credentials and try again.');
      setStep('credentials');
    }
  }

  return (
    <div className="min-h-[calc(100vh-56px)] flex items-center justify-center px-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-text-primary">Connect Trading Account</h1>
          <p className="text-sm text-text-secondary mt-1">
            Link your trading account to start tracking performance
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {['Platform', 'Credentials', 'Connect', 'Done'].map((label, i) => {
            const steps: Step[] = ['platform', 'credentials', 'connecting', 'success'];
            const currentIdx = steps.indexOf(step === 'syncing' ? 'connecting' : step);
            const isActive = i <= currentIdx;
            return (
              <div key={label} className="flex items-center gap-2">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                    isActive ? 'bg-accent-primary text-white' : 'bg-bg-tertiary text-text-tertiary'
                  }`}
                >
                  {i + 1}
                </div>
                <span className={`text-xs ${isActive ? 'text-text-primary' : 'text-text-tertiary'}`}>
                  {label}
                </span>
                {i < 3 && <div className={`w-8 h-px ${isActive ? 'bg-accent-primary' : 'bg-border-primary'}`} />}
              </div>
            );
          })}
        </div>

        <Card>
          <CardContent className="pt-6">
            {step === 'platform' && (
              <div className="space-y-4">
                <p className="text-sm text-text-secondary mb-4">Choose your trading platform:</p>
                <div className="grid grid-cols-3 gap-3">
                  {([
                    { id: 'mt4' as const, label: 'MT4', desc: 'MetaTrader 4' },
                    { id: 'mt5' as const, label: 'MT5', desc: 'MetaTrader 5' },
                    { id: 'tradovate' as const, label: 'Tradovate', desc: 'Futures Trading' },
                  ]).map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setPlatform(p.id)}
                      className={`p-4 rounded-[var(--radius-md)] border text-center transition-colors cursor-pointer ${
                        platform === p.id
                          ? 'border-accent-primary bg-accent-primary/10 text-text-primary'
                          : 'border-border-primary bg-bg-tertiary text-text-secondary hover:border-border-secondary'
                      }`}
                    >
                      <span className="text-lg font-semibold">{p.label}</span>
                      <p className="text-xs mt-1">{p.desc}</p>
                    </button>
                  ))}
                </div>
                <Button className="w-full mt-4" onClick={() => setStep('credentials')}>
                  Continue
                </Button>
              </div>
            )}

            {step === 'credentials' && (
              <div className="space-y-4">
                {error && (
                  <div className="bg-loss-bg border border-loss-border rounded-[var(--radius-md)] px-3 py-2 text-sm text-loss-primary">
                    {error}
                  </div>
                )}

                <Input
                  id="name"
                  label="Account Label"
                  placeholder={platform === 'tradovate' ? 'e.g. Tradovate Demo' : 'e.g. Main Trading Account'}
                  value={form.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  required
                />

                {platform === 'tradovate' ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      {(['demo', 'live'] as const).map((env) => (
                        <button
                          key={env}
                          onClick={() => updateField('tradovateEnvironment', env)}
                          className={`p-2 rounded-[var(--radius-sm)] border text-center text-sm transition-colors cursor-pointer capitalize ${
                            form.tradovateEnvironment === env
                              ? 'border-accent-primary bg-accent-primary/10 text-text-primary'
                              : 'border-border-primary bg-bg-tertiary text-text-secondary'
                          }`}
                        >
                          {env}
                        </button>
                      ))}
                    </div>
                    <Input
                      id="tradovateUsername"
                      label="Tradovate Username"
                      placeholder="Your Tradovate username"
                      value={form.tradovateUsername}
                      onChange={(e) => updateField('tradovateUsername', e.target.value)}
                      required
                    />
                    <Input
                      id="tradovatePassword"
                      label="Tradovate Password"
                      type="password"
                      placeholder="Your Tradovate password"
                      value={form.tradovatePassword}
                      onChange={(e) => updateField('tradovatePassword', e.target.value)}
                      required
                    />
                    <Input
                      id="tradovateApiSecret"
                      label="API Secret (optional)"
                      type="password"
                      placeholder="From Tradovate API settings"
                      value={form.tradovateApiSecret}
                      onChange={(e) => updateField('tradovateApiSecret', e.target.value)}
                    />
                    <Input
                      id="tradovateCid"
                      label="CID (optional)"
                      placeholder="Client ID from Tradovate"
                      value={form.tradovateCid}
                      onChange={(e) => updateField('tradovateCid', e.target.value)}
                    />
                    <p className="text-xs text-text-tertiary">
                      Tradovate accounts are used for copy trading. Your credentials are stored securely and used to monitor positions and execute trades.
                    </p>
                  </>
                ) : (
                  <>
                    <Input
                      id="server"
                      label="Broker Server"
                      placeholder="e.g. ICMarketsSC-Demo"
                      value={form.server}
                      onChange={(e) => updateField('server', e.target.value)}
                      required
                    />
                    <Input
                      id="login"
                      label="Account Login"
                      placeholder="Your MT login number"
                      value={form.login}
                      onChange={(e) => updateField('login', e.target.value)}
                      required
                    />
                    {!useTrading ? (
                      <>
                        <Input
                          id="password"
                          label="Investor (Read-Only) Password"
                          type="password"
                          placeholder="Your investor password"
                          value={form.password}
                          onChange={(e) => updateField('password', e.target.value)}
                          required
                        />
                        <p className="text-xs text-text-tertiary">
                          Read-only access for analytics. Cannot execute trades.
                        </p>
                      </>
                    ) : (
                      <>
                        <Input
                          id="tradingPassword"
                          label="Trading Password"
                          type="password"
                          placeholder="Your trading password"
                          value={form.tradingPassword}
                          onChange={(e) => updateField('tradingPassword', e.target.value)}
                          required
                        />
                        <p className="text-xs text-text-tertiary">
                          Full access — required for the Signal Copier to place trades on your account.
                        </p>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => setUseTrading(!useTrading)}
                      className="text-xs text-accent-primary hover:underline cursor-pointer"
                    >
                      {useTrading ? 'Use investor (read-only) password instead' : 'Use trading password (required for Signal Copier)'}
                    </button>
                  </>
                )}

                <div className="flex gap-3">
                  <Button variant="secondary" onClick={() => setStep('platform')} className="flex-1">
                    Back
                  </Button>
                  <Button
                    onClick={handleConnect}
                    className="flex-1"
                    disabled={
                      !form.name || (platform === 'tradovate'
                        ? !form.tradovateUsername || !form.tradovatePassword
                        : !form.server || !form.login || !(useTrading ? form.tradingPassword : form.password))
                    }
                  >
                    Connect
                  </Button>
                </div>
              </div>
            )}

            {(step === 'connecting' || step === 'syncing') && (
              <div className="text-center py-8">
                <div className="w-12 h-12 border-2 border-accent-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                <p className="text-text-primary font-medium">
                  {step === 'connecting' ? (platform === 'tradovate' ? 'Connecting to Tradovate...' : 'Connecting to MetaTrader...') : syncStatus}
                </p>
                <p className="text-xs text-text-tertiary mt-2">
                  {step === 'connecting'
                    ? 'Deploying cloud connection and verifying credentials'
                    : 'This may take a minute for accounts with many trades'}
                </p>
              </div>
            )}

            {step === 'success' && (
              <div className="text-center py-8">
                <div className="w-12 h-12 bg-profit-bg border border-profit-border rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-profit-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-text-primary font-medium">Account Connected!</p>
                <p className="text-sm text-text-secondary mt-1">
                  Your trade history is being imported. Head to the dashboard to see your data.
                </p>
                <Button className="mt-6" onClick={() => router.push('/dashboard')}>
                  Go to Dashboard
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
