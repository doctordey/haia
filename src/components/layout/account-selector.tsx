'use client';

import { useAccounts } from '@/hooks/useAccounts';

export function AccountSelector() {
  const { accounts, selectedAccountId, setSelectedAccountId } = useAccounts();

  if (accounts.length === 0) {
    return (
      <div className="text-xs text-text-tertiary px-3 py-1.5 border border-border-primary rounded-[var(--radius-md)] bg-bg-secondary">
        No accounts
      </div>
    );
  }

  return (
    <select
      value={selectedAccountId || ''}
      onChange={(e) => setSelectedAccountId(e.target.value)}
      className="h-8 px-2 text-xs bg-bg-secondary border border-border-primary rounded-[var(--radius-md)] text-text-primary focus:outline-none focus:border-accent-primary cursor-pointer appearance-none pr-6"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238B8D98' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 6px center',
      }}
    >
      {accounts.map((account) => (
        <option key={account.id} value={account.id}>
          {account.name} ({account.platform})
        </option>
      ))}
    </select>
  );
}
