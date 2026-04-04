'use client';

import { useToastStore } from '@/hooks/useToast';
import { cn } from '@/lib/utils';

const typeStyles = {
  success: 'border-profit-border bg-profit-bg text-profit-primary',
  error: 'border-loss-border bg-loss-bg text-loss-primary',
  info: 'border-border-secondary bg-bg-tertiary text-text-primary',
};

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            'px-4 py-3 rounded-[var(--radius-md)] border text-sm animate-in slide-in-from-right',
            typeStyles[toast.type]
          )}
          onClick={() => removeToast(toast.id)}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
