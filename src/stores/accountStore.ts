import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TradingAccount } from '@/types';

interface AccountState {
  accounts: TradingAccount[];
  selectedAccountId: string | null;
  loading: boolean;
  setAccounts: (accounts: TradingAccount[]) => void;
  setSelectedAccountId: (id: string | null) => void;
  setLoading: (loading: boolean) => void;
}

export const useAccountStore = create<AccountState>()(
  persist(
    (set) => ({
      accounts: [],
      selectedAccountId: null,
      loading: false,
      setAccounts: (accounts) => set({ accounts }),
      setSelectedAccountId: (id) => set({ selectedAccountId: id }),
      setLoading: (loading) => set({ loading }),
    }),
    {
      name: 'haia-account',
      partialize: (state) => ({ selectedAccountId: state.selectedAccountId }),
    }
  )
);
