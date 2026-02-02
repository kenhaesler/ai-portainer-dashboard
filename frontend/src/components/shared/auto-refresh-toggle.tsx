import { Timer, TimerOff } from 'lucide-react';
import { cn } from '@/lib/utils';

const INTERVALS = [
  { label: 'Off', value: 0 },
  { label: '15s', value: 15 },
  { label: '30s', value: 30 },
  { label: '1m', value: 60 },
  { label: '2m', value: 120 },
  { label: '5m', value: 300 },
];

interface AutoRefreshToggleProps {
  interval: number;
  onIntervalChange: (interval: number) => void;
  className?: string;
}

export function AutoRefreshToggle({ interval, onIntervalChange, className }: AutoRefreshToggleProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {interval > 0 ? (
        <Timer className="h-4 w-4 text-emerald-500" />
      ) : (
        <TimerOff className="h-4 w-4 text-muted-foreground" />
      )}
      <select
        value={interval}
        onChange={(e) => onIntervalChange(Number(e.target.value))}
        className="rounded-md border border-input bg-background px-2 py-1.5 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {INTERVALS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
