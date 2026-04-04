import { cn } from '@/lib/utils';
import { HTMLAttributes } from 'react';

type BadgeVariant = 'default' | 'profit' | 'loss' | 'warning' | 'info';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-bg-tertiary text-text-secondary border-border-secondary',
  profit: 'bg-profit-bg text-profit-primary border-profit-border',
  loss: 'bg-loss-bg text-loss-primary border-loss-border',
  warning: 'bg-[#FFB34715] text-warning border-[#FFB34730]',
  info: 'bg-[#00B4D815] text-info border-[#00B4D830]',
};

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-[var(--radius-sm)] text-xs font-medium border',
        variantStyles[variant],
        className
      )}
      {...props}
    />
  );
}
