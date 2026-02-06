import { Timer, TimerOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type RefreshInterval } from '@/hooks/use-auto-refresh';

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

export function AutoRefreshToggle({ interval, onIntervalChange, className }: AutoRefreshToggleProps) {
  const isActive = interval > 0;

  return (
    <div className={cn('inline-flex items-center rounded-md border border-input bg-background p-0.5', className)}>
      {INTERVALS.map((opt, i) => {
        const isSelected = interval === opt.value;
        const isOff = opt.value === 0;
        return (
          <button
            key={opt.value}
            onClick={() => onIntervalChange(opt.value)}
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors',
              i === 0 && 'rounded-l-[3px]',
              i === INTERVALS.length - 1 && 'rounded-r-[3px]',
              i > 0 && i < INTERVALS.length - 1 && 'rounded-none',
              isSelected
                ? isOff
                  ? 'bg-muted text-foreground'
                  : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {isOff && (
              isSelected
                ? <TimerOff className="h-3.5 w-3.5" />
                : <TimerOff className="h-3.5 w-3.5" />
            )}
            {!isOff && isSelected && (
              <Timer className="h-3.5 w-3.5" />
            )}
            {opt.label}
          </button>
        );
      })}
      {isActive && (
        <span className="ml-0.5 mr-1 h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
      )}
    </div>
  );
}
