import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div className={cn('animate-pulse bg-bg-tertiary rounded-[var(--radius-md)]', className)} />
  );
}

export function SkeletonCard() {
  return (
    <div className="bg-bg-secondary border border-border-primary rounded-[var(--radius-md)] p-4 space-y-3">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-3 w-16" />
    </div>
  );
}

export function SkeletonChart() {
  return (
    <div className="bg-bg-secondary border border-border-primary rounded-[var(--radius-md)] p-4">
      <Skeleton className="h-3 w-32 mb-4" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

export function SkeletonTable() {
  return (
    <div className="bg-bg-secondary border border-border-primary rounded-[var(--radius-md)] p-4 space-y-2">
      <Skeleton className="h-8 w-full" />
      {[...Array(5)].map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
