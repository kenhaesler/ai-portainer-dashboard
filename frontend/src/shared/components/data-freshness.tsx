import { useState, useEffect, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

interface DataFreshnessProps {
  /** ISO timestamp or epoch ms of the last data update */
  lastUpdated: string | number | null;
  /** Callback to trigger a manual refresh */
  onRefresh?: () => void;
  className?: string;
}

function getAgeSeconds(lastUpdated: string | number): number {
  const ts = typeof lastUpdated === 'string' ? new Date(lastUpdated).getTime() : lastUpdated;
  return Math.floor((Date.now() - ts) / 1000);
}

function formatAge(seconds: number): string {
  if (seconds < 5) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function getAgeColor(seconds: number): string {
  if (seconds < 10) return 'text-emerald-600 dark:text-emerald-400';
  if (seconds < 30) return 'text-muted-foreground';
  if (seconds < 60) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

/**
 * Displays a real-time "Updated Xs ago" indicator with color-coded freshness.
 * Click to trigger a manual refresh.
 */
export function DataFreshness({ lastUpdated, onRefresh, className }: DataFreshnessProps) {
  const [, setTick] = useState(0);

  // Tick every second to update relative time
  useEffect(() => {
    const interval = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const age = lastUpdated ? getAgeSeconds(lastUpdated) : null;

  const handleClick = useCallback(() => {
    if (onRefresh) onRefresh();
  }, [onRefresh]);

  if (age === null) return null;

  return (
    <button
      onClick={handleClick}
      disabled={!onRefresh}
      className={cn(
        'inline-flex items-center gap-1 text-xs transition-colors',
        getAgeColor(age),
        onRefresh && 'hover:underline cursor-pointer',
        !onRefresh && 'cursor-default',
        className,
      )}
      title={onRefresh ? 'Click to refresh' : undefined}
    >
      <RefreshCw className="h-3 w-3" />
      <span>Updated {formatAge(age)}</span>
    </button>
  );
}
