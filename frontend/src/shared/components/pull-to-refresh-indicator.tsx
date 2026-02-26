import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PullToRefreshIndicatorProps {
  pullDistance: number;
  isRefreshing: boolean;
  threshold?: number;
}

export function PullToRefreshIndicator({
  pullDistance,
  isRefreshing,
  threshold = 80,
}: PullToRefreshIndicatorProps) {
  if (pullDistance === 0 && !isRefreshing) return null;

  const progress = Math.min(pullDistance / threshold, 1);

  return (
    <div
      className="flex items-center justify-center overflow-hidden transition-[height] duration-200 md:hidden"
      style={{ height: pullDistance }}
    >
      <RefreshCw
        className={cn(
          'h-5 w-5 text-muted-foreground transition-transform',
          isRefreshing && 'animate-spin',
        )}
        style={{
          transform: `rotate(${progress * 360}deg)`,
          opacity: progress,
        }}
      />
    </div>
  );
}
