import { useState, useEffect, useCallback } from 'react';
import { Pause, Play, RefreshCw, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type RefreshInterval } from '@/hooks/use-auto-refresh';

const INTERVAL_OPTIONS: { label: string; value: RefreshInterval }[] = [
  { label: '15s', value: 15 },
  { label: '30s', value: 30 },
  { label: '1m', value: 60 },
  { label: '2m', value: 120 },
  { label: '5m', value: 300 },
];

interface SmartRefreshControlsProps {
  interval: RefreshInterval;
  enabled: boolean;
  onIntervalChange: (interval: RefreshInterval) => void;
  onToggle: () => void;
  onRefresh: () => void;
  isRefreshing?: boolean;
  lastUpdated?: Date | null;
  className?: string;
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function SmartRefreshControls({
  interval,
  enabled,
  onIntervalChange,
  onToggle,
  onRefresh,
  isRefreshing = false,
  lastUpdated = null,
  className,
}: SmartRefreshControlsProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [timeAgoText, setTimeAgoText] = useState('');

  // Update "last updated" text every 5 seconds
  useEffect(() => {
    if (!lastUpdated) {
      setTimeAgoText('');
      return;
    }
    setTimeAgoText(formatTimeAgo(lastUpdated));
    const timer = window.setInterval(() => {
      setTimeAgoText(formatTimeAgo(lastUpdated));
    }, 5000);
    return () => window.clearInterval(timer);
  }, [lastUpdated]);

  const handleIntervalSelect = useCallback(
    (value: RefreshInterval) => {
      onIntervalChange(value);
      setDropdownOpen(false);
    },
    [onIntervalChange]
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = () => setDropdownOpen(false);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [dropdownOpen]);

  const isPaused = !enabled || interval === 0;
  const currentLabel =
    INTERVAL_OPTIONS.find((o) => o.value === interval)?.label ?? `${interval}s`;

  return (
    <div
      className={cn(
        'flex items-center gap-2 text-sm',
        className
      )}
    >
      {/* Pause/Play toggle */}
      <button
        onClick={onToggle}
        title={isPaused ? 'Resume auto-refresh' : 'Pause auto-refresh'}
        aria-label={isPaused ? 'Resume auto-refresh' : 'Pause auto-refresh'}
        className={cn(
          'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background transition-colors hover:bg-accent',
          isPaused && 'text-amber-500'
        )}
      >
        {isPaused ? (
          <Play className="h-4 w-4" data-testid="play-icon" />
        ) : (
          <Pause className="h-4 w-4" data-testid="pause-icon" />
        )}
      </button>

      {/* Refresh button */}
      <button
        onClick={onRefresh}
        title="Refresh now"
        aria-label="Refresh now"
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-input bg-background transition-colors hover:bg-accent"
      >
        <RefreshCw
          className={cn('h-4 w-4', isRefreshing && 'animate-spin')}
        />
      </button>

      {/* Interval selector */}
      <div className="relative">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setDropdownOpen((prev) => !prev);
          }}
          title="Set refresh interval"
          aria-label="Set refresh interval"
          aria-expanded={dropdownOpen}
          className="inline-flex h-9 items-center gap-1 rounded-lg border border-input bg-background px-3 transition-colors hover:bg-accent"
        >
          <span className="text-xs font-medium">
            {isPaused ? 'Paused' : currentLabel}
          </span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>

        {dropdownOpen && (
          <div className="absolute right-0 top-full z-50 mt-1 min-w-[100px] rounded-lg border border-input bg-popover p-1 shadow-md">
            {INTERVAL_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={(e) => {
                  e.stopPropagation();
                  handleIntervalSelect(opt.value);
                }}
                className={cn(
                  'flex w-full items-center rounded-md px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent',
                  interval === opt.value &&
                    'bg-primary/10 text-primary'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Paused badge */}
      {isPaused && (
        <span className="rounded-md bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
          Paused
        </span>
      )}

      {/* Last updated timestamp */}
      {timeAgoText && (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          Updated {timeAgoText}
        </span>
      )}
    </div>
  );
}
