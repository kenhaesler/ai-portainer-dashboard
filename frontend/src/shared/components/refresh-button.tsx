import { RefreshCw, Zap } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useEffect, useRef, useState } from 'react';

interface RefreshButtonProps {
  onClick: () => void;
  isLoading?: boolean;
  className?: string;
  onForceRefresh?: () => void;
}

export function RefreshButton({ onClick, isLoading, className, onForceRefresh }: RefreshButtonProps) {
  const MIN_SPIN_MS = 1500;
  const [showSpin, setShowSpin] = useState(Boolean(isLoading));
  const spinStartedAtRef = useRef(0);
  const stopTimerRef = useRef<number | null>(null);
  const forceAction = onForceRefresh ?? onClick;
  const forceTitle = onForceRefresh
    ? 'Bypass cache and fetch fresh data'
    : 'Refresh (cache bypass unavailable on this page)';

  useEffect(() => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }

    if (isLoading) {
      spinStartedAtRef.current = Date.now();
      setShowSpin(true);
      return;
    }

    if (!showSpin) {
      return;
    }

    const elapsed = Date.now() - spinStartedAtRef.current;
    const remaining = Math.max(0, MIN_SPIN_MS - elapsed);
    stopTimerRef.current = window.setTimeout(() => {
      setShowSpin(false);
      stopTimerRef.current = null;
    }, remaining);
  }, [isLoading, showSpin]);

  useEffect(() => {
    return () => {
      if (stopTimerRef.current !== null) {
        window.clearTimeout(stopTimerRef.current);
      }
    };
  }, []);

  return (
    <div className={cn('inline-flex h-10 items-center gap-1 rounded-full border border-input bg-background p-1', className)}>
      <button
        onClick={onClick}
        className="inline-flex h-8 items-center gap-2 rounded-full px-4 text-sm font-medium hover:bg-accent"
      >
        <RefreshCw className={cn('h-4 w-4', showSpin && 'animate-spin')} />
        Refresh
      </button>
      <button
        onClick={forceAction}
        title={forceTitle}
        aria-label={forceTitle}
        className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium hover:bg-accent"
      >
        <Zap className="h-4 w-4" />
        <span>Bypass cache</span>
      </button>
    </div>
  );
}
