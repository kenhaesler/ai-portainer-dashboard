import { cn } from '@/shared/lib/utils';

const PULSE = 'animate-pulse rounded bg-muted/40';

export interface SkeletonTextProps {
  lines?: number;
  className?: string;
}

export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <div
      className={cn('space-y-2', className)}
      role="status"
      aria-label="Loading"
    >
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={cn(PULSE, 'h-3', i === lines - 1 ? 'w-2/3' : 'w-full')}
        />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export interface SkeletonListProps {
  rows?: number;
  className?: string;
}

export function SkeletonList({ rows = 4, className }: SkeletonListProps) {
  return (
    <div
      className={cn('space-y-3', className)}
      role="status"
      aria-label="Loading"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} data-skeleton-row className="flex items-center gap-3">
          <div className={cn(PULSE, 'h-8 w-8 rounded-full')} />
          <div className="flex-1 space-y-2">
            <div className={cn(PULSE, 'h-3 w-1/2')} />
            <div className={cn(PULSE, 'h-3 w-1/3')} />
          </div>
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export interface SkeletonChartProps {
  size?: 'md' | 'lg';
  className?: string;
}

export function SkeletonChart({ size = 'md', className }: SkeletonChartProps) {
  return (
    <div
      className={cn(PULSE, 'w-full', size === 'lg' ? 'h-80' : 'h-48', className)}
      role="status"
      aria-label="Loading"
    >
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export interface SkeletonTableRowProps {
  columns?: number;
  className?: string;
}

export function SkeletonTableRow({ columns = 4, className }: SkeletonTableRowProps) {
  return (
    <tr className={className}>
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-3 py-2">
          <div className={cn(PULSE, 'h-3 w-full')} />
        </td>
      ))}
    </tr>
  );
}

export interface SkeletonKpiProps {
  className?: string;
}

export function SkeletonKpi({ className }: SkeletonKpiProps) {
  return (
    <div className={cn('space-y-3', className)} role="status" aria-label="Loading">
      <div className={cn(PULSE, 'h-3 w-1/3')} />
      <div className={cn(PULSE, 'h-8 w-1/2')} />
      <div className={cn(PULSE, 'h-3 w-2/5')} />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
