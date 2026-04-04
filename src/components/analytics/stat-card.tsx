import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: string;
  color?: string;
}

export function StatCard({ label, value, color }: StatCardProps) {
  return (
    <div className="bg-bg-secondary border border-border-primary rounded-[var(--radius-md)] p-3">
      <p className="text-xs text-text-secondary uppercase tracking-wide font-medium mb-1">{label}</p>
      <p className={cn('text-sm font-mono font-semibold', color || 'text-text-primary')}>{value}</p>
    </div>
  );
}
