import { cn } from '@/lib/utils';

interface LoadingSkeletonProps {
  className?: string;
  lines?: number;
}

export function LoadingSkeleton({ className, lines = 3 }: LoadingSkeletonProps) {
  return (
    <div className={cn('space-y-3', className)} role="status" aria-label="Loading">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'h-4 animate-pulse rounded-md bg-muted',
            i === lines - 1 && 'w-3/4'
          )}
        />
      ))}
      <span className="sr-only">Loading...</span>
    </div>
  );
}

interface SkeletonCardProps {
  className?: string;
}

export function SkeletonCard({ className }: SkeletonCardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card p-6',
        className
      )}
      role="status"
      aria-label="Loading"
    >
      <div className="mb-4 h-5 w-1/3 animate-pulse rounded-md bg-muted" />
      <div className="space-y-2">
        <div className="h-4 animate-pulse rounded-md bg-muted" />
        <div className="h-4 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-2/3 animate-pulse rounded-md bg-muted" />
      </div>
      <span className="sr-only">Loading...</span>
    </div>
  );
}
