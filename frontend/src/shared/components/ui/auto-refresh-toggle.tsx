import { ChevronDown, Timer, TimerOff } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { type RefreshInterval } from '@/shared/hooks/use-auto-refresh';

const INTERVALS: { label: string; value: RefreshInterval }[] = [
  { label: 'Off', value: 0 },
  { label: '15s', value: 15 },
  { label: '30s', value: 30 },
  { label: '1m', value: 60 },
  { label: '2m', value: 120 },
  { label: '5m', value: 300 },
];

interface AutoRefreshToggleProps {
  interval: RefreshInterval;
  onIntervalChange: (interval: RefreshInterval) => void;
  className?: string;
}

/**
 * Compact auto-refresh selector. Replaced the inline pill-row of 6 buttons
 * (~280px) with a single dropdown to free up header real estate while keeping
 * the same set of intervals. Native `<select>` for built-in keyboard support
 * and screen-reader semantics.
 */
export function AutoRefreshToggle({ interval, onIntervalChange, className }: AutoRefreshToggleProps) {
  const isActive = interval > 0;
  const selected = INTERVALS.find((opt) => opt.value === interval) ?? INTERVALS[0];

  return (
    <label
      className={cn(
        'relative inline-flex h-10 items-center gap-2 rounded-full border border-input bg-background pl-3 pr-8 text-sm font-medium cursor-pointer transition-colors hover:bg-muted/30',
        className,
      )}
    >
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
        className="absolute inset-0 cursor-pointer rounded-full opacity-0"
      >
        {INTERVALS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label === 'Off' ? 'Off' : `Every ${opt.label}`}
          </option>
        ))}
      </select>
    </label>
  );
}
