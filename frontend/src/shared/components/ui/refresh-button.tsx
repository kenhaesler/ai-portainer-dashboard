import { RefreshCw } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useMinimumSpin } from '@/shared/hooks/use-minimum-spin';

interface RefreshButtonProps {
  onClick: () => void;
  isLoading?: boolean;
  className?: string;
  onForceRefresh?: () => void;
}

export function RefreshButton({ onClick, isLoading, className, onForceRefresh }: RefreshButtonProps) {
  const showSpin = useMinimumSpin(isLoading);
  // An explicit click is a foreground signal that the user wants the
  // freshest data, so prefer the cache-bypassing path when the page wires
  // one up. `useForceRefresh` already swallows the 403 non-admins get from
  // the invalidate endpoint and falls through to a plain refetch, so this
  // is safe to default on.
  const handleClick = () => (onForceRefresh ?? onClick)();

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'inline-flex h-10 items-center gap-2 rounded-full border border-input bg-background px-4 text-sm font-medium hover:bg-accent',
        className,
      )}
    >
      <RefreshCw className={cn('h-4 w-4', showSpin && 'animate-spin')} />
      Refresh
    </button>
  );
}
