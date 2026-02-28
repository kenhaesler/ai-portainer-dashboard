import { cn } from '@/shared/lib/utils';

const shimmerClass = 'relative overflow-hidden before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_1.5s_infinite] before:bg-gradient-to-r before:from-transparent before:via-white/10 before:to-transparent';

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
            'h-4 rounded-md bg-muted',
            shimmerClass,
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
      <div className={cn('mb-4 h-5 w-1/3 rounded-md bg-muted', shimmerClass)} />
      <div className="space-y-2">
        <div className={cn('h-4 rounded-md bg-muted', shimmerClass)} />
        <div className={cn('h-4 rounded-md bg-muted', shimmerClass)} style={{ animationDelay: '0.1s' }} />
        <div className={cn('h-4 w-2/3 rounded-md bg-muted', shimmerClass)} style={{ animationDelay: '0.2s' }} />
      </div>
      <span className="sr-only">Loading...</span>
    </div>
  );
}
