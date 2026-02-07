import { RefreshCw, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RefreshButtonProps {
  onClick: () => void;
  isLoading?: boolean;
  className?: string;
  onForceRefresh?: () => void;
}

export function RefreshButton({ onClick, isLoading, className, onForceRefresh }: RefreshButtonProps) {
  if (!onForceRefresh) {
    return (
      <button
        onClick={onClick}
        className={cn(
          'relative inline-flex h-9 items-center gap-2 rounded-full border border-input bg-background px-4 text-sm font-medium hover:bg-accent',
          className
        )}
      >
        <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
        {isLoading ? 'Updating...' : 'Refresh'}
      </button>
    );
  }

  return (
    <div className={cn('inline-flex h-10 items-center gap-1 rounded-full border border-input bg-background p-1', className)}>
      <button
        onClick={onClick}
        className="inline-flex h-8 items-center gap-2 rounded-full px-4 text-sm font-medium hover:bg-accent"
      >
        <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
        {isLoading ? 'Updating...' : 'Refresh'}
      </button>
      <button
        onClick={onForceRefresh}
        title="Force refresh (bypass backend cache)"
        className="inline-flex h-8 items-center rounded-full px-3 text-sm font-medium hover:bg-accent"
      >
        <Zap className="h-4 w-4" />
      </button>
    </div>
  );
}
