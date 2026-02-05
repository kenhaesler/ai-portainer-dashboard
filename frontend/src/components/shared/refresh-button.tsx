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
        disabled={isLoading}
        className={cn(
          'inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50',
          className
        )}
      >
        <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
        Refresh
      </button>
    );
  }

  return (
    <div className={cn('inline-flex items-center', className)}>
      <button
        onClick={onClick}
        disabled={isLoading}
        className="inline-flex items-center gap-2 rounded-l-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
      >
        <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
        Refresh
      </button>
      <button
        onClick={onForceRefresh}
        disabled={isLoading}
        title="Force refresh (bypass backend cache)"
        className="inline-flex items-center rounded-r-md border border-l-0 border-input bg-background px-2 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
      >
        <Zap className="h-4 w-4" />
      </button>
    </div>
  );
}
