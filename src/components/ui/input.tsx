'use client';

import { cn } from '@/lib/utils';
import { InputHTMLAttributes, forwardRef } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, id, ...props }, ref) => {
    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={id} className="block text-sm font-medium text-text-secondary">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={id}
          className={cn(
            'w-full h-10 px-3 bg-bg-tertiary border border-border-primary rounded-[var(--radius-md)]',
            'text-sm text-text-primary placeholder:text-text-tertiary',
            'focus:outline-none focus:border-accent-primary transition-colors',
            error && 'border-loss-primary',
            className
          )}
          {...props}
        />
        {error && <p className="text-xs text-loss-primary">{error}</p>}
      </div>
    );
  }
);
Input.displayName = 'Input';
