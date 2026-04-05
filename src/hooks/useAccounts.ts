'use client';

import { useEffect, useCallback } from 'react';
import { useAccountStore } from '@/stores/accountStore';
import type { TradingAccount } from '@/types';

export function useAccounts() {
  const { accounts, selectedAccountId, loading, setAccounts, setSelectedAccountId, setLoading } =
    useAccountStore();

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/accounts');
      if (res.ok) {
        const data: TradingAccount[] = await res.json();
        setAccounts(data);
        if (data.length > 0 && !selectedAccountId) {
          setSelectedAccountId(data[0].id);
        }
      }
    } catch (error) {
      console.error('Failed to fetch accounts:', error);
    } finally {
      setLoading(false);
    }
  }, [setAccounts, setSelectedAccountId, setLoading, selectedAccountId]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  return {
    accounts,
    selectedAccountId,
    selectedAccount: accounts.find((a) => a.id === selectedAccountId),
    loading,
    setSelectedAccountId,
    refetch: fetchAccounts,
  };
}
