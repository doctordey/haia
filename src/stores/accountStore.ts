import { create } from 'zustand';
import type { TradingAccount } from '@/types';

interface AccountState {
  accounts: TradingAccount[];
  selectedAccountId: string | null;
  loading: boolean;
  setAccounts: (accounts: TradingAccount[]) => void;
  setSelectedAccountId: (id: string | null) => void;
  setLoading: (loading: boolean) => void;
  selectedAccount: () => TradingAccount | undefined;
}

export const useAccountStore = create<AccountState>((set, get) => ({
  accounts: [],
  selectedAccountId: null,
  loading: false,
  setAccounts: (accounts) => set({ accounts }),
  setSelectedAccountId: (id) => set({ selectedAccountId: id }),
  setLoading: (loading) => set({ loading }),
  selectedAccount: () => {
    const { accounts, selectedAccountId } = get();
    return accounts.find((a) => a.id === selectedAccountId);
  },
}));
