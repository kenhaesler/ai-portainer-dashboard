import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RefreshButtonProps {
  onClick: () => void;
  isLoading?: boolean;
  className?: string;
}

export function RefreshButton({ onClick, isLoading, className }: RefreshButtonProps) {
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
