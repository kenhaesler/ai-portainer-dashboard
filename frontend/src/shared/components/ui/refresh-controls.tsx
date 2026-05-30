import { ChevronDown, RefreshCw, Timer, TimerOff } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { type RefreshInterval } from '@/shared/hooks/use-auto-refresh';
import { useMinimumSpin } from '@/shared/hooks/use-minimum-spin';

const INTERVALS: { label: string; value: RefreshInterval }[] = [
  { label: 'Off', value: 0 },
  { label: '15s', value: 15 },
  { label: '30s', value: 30 },
  { label: '1m', value: 60 },
  { label: '2m', value: 120 },
  { label: '5m', value: 300 },
];

interface RefreshControlsProps {
  interval: RefreshInterval;
  onIntervalChange: (interval: RefreshInterval) => void;
  /** Manual refresh handler (plain refetch). */
  onRefresh: () => void;
  /** Optional cache-bypassing refresh; preferred over `onRefresh` on click. */
  onForceRefresh?: () => void;
  isLoading?: boolean;
  className?: string;
}

/**
 * Auto-refresh interval selector joined with a manual refresh button into a
 * single segmented pill: interval dropdown on the left, a divider, then the
 * refresh symbol (icon only) on the right. Replaces the former side-by-side
 * `<AutoRefreshToggle>` + `<RefreshButton>` pair so the two controls read as
 * one unit. The native `<select>` overlay is scoped to the interval portion so
 * it never intercepts clicks on the refresh button.
 */
export function RefreshControls({
  interval,
  onIntervalChange,
  onRefresh,
  onForceRefresh,
  isLoading,
  className,
}: RefreshControlsProps) {
  const isActive = interval > 0;
  const selected = INTERVALS.find((opt) => opt.value === interval) ?? INTERVALS[0];

  const showSpin = useMinimumSpin(isLoading);
  // An explicit click is a foreground signal that the user wants the freshest
  // data, so prefer the cache-bypassing path when the page wires one up.
  const handleRefreshClick = () => (onForceRefresh ?? onRefresh)();

  return (
    <div
      className={cn(
        'inline-flex h-10 items-center rounded-full border border-input bg-background',
        className,
      )}
    >
      {/* Interval selector (native <select> overlay scoped to this label) */}
      <label className="relative inline-flex h-full items-center gap-2 rounded-l-full pl-3 pr-8 text-sm font-medium cursor-pointer transition-colors hover:bg-muted/30">
        {isActive ? (
          <Timer className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <TimerOff className="h-4 w-4 text-muted-foreground" />
        )}
        <span
          className={cn(
            'tabular-nums',
            isActive ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {selected.label === 'Off' ? 'Auto-refresh: Off' : `Every ${selected.label}`}
        </span>
        {isActive && (
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" aria-hidden />
        )}
        <ChevronDown className="absolute right-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
        <select
          value={interval}
          onChange={(e) => onIntervalChange(Number(e.target.value) as RefreshInterval)}
          aria-label="Auto-refresh interval"
          className="absolute inset-0 cursor-pointer rounded-l-full opacity-0"
        >
          {INTERVALS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label === 'Off' ? 'Off' : `Every ${opt.label}`}
            </option>
          ))}
        </select>
      </label>

      {/* Divider */}
      <span className="h-5 w-px bg-border" aria-hidden />

      {/* Manual refresh — icon only */}
      <button
        type="button"
        onClick={handleRefreshClick}
        aria-label="Refresh"
        title="Refresh"
        className="inline-flex h-full items-center justify-center rounded-r-full px-3 transition-colors hover:bg-accent"
      >
        <RefreshCw className={cn('h-4 w-4', showSpin && 'animate-spin')} />
      </button>
    </div>
  );
}
