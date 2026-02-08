import { cn } from '@/lib/utils';

type Status = 'running' | 'stopped' | 'paused' | 'unhealthy' | 'healthy' | 'unknown' |
  'up' | 'down' | 'active' | 'inactive' |
  'pending' | 'approved' | 'rejected' | 'executing' | 'completed' | 'failed' | 'succeeded' |
  'critical' | 'warning' | 'info' | 'ok' | 'error' |
  'capturing' | 'processing' |
  'deployed' | 'planned' | 'excluded' |
  'not_deployed' | 'unreachable' | 'incompatible';

const statusColors: Record<string, string> = {
  running: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  stopped: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  paused: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  unhealthy: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  healthy: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  unknown: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
  up: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  down: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  inactive: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  approved: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  executing: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  succeeded: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  ok: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  error: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  capturing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  processing: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  deployed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  planned: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  excluded: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
  not_deployed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  unreachable: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  incompatible: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
};

const statusDotColors: Record<string, string> = {
  running: 'bg-emerald-500',
  healthy: 'bg-emerald-500',
  up: 'bg-emerald-500',
  active: 'bg-emerald-500',
  completed: 'bg-emerald-500',
  succeeded: 'bg-emerald-500',
  ok: 'bg-emerald-500',
  stopped: 'bg-red-500',
  down: 'bg-red-500',
  unhealthy: 'bg-red-500',
  failed: 'bg-red-500',
  error: 'bg-red-500',
  critical: 'bg-red-500',
  rejected: 'bg-red-500',
  paused: 'bg-amber-500',
  pending: 'bg-amber-500',
  warning: 'bg-amber-500',
  executing: 'bg-purple-500',
  approved: 'bg-blue-500',
  info: 'bg-blue-500',
  unknown: 'bg-gray-500',
  inactive: 'bg-gray-500',
  capturing: 'bg-blue-500',
  processing: 'bg-purple-500',
  deployed: 'bg-emerald-500',
  planned: 'bg-blue-500',
  excluded: 'bg-gray-500',
  not_deployed: 'bg-blue-500',
  unreachable: 'bg-orange-500',
  incompatible: 'bg-gray-500',
};

// Active statuses get a pulse animation
const activeStatuses = ['running', 'healthy', 'up', 'active', 'executing', 'pending', 'capturing'];

interface StatusBadgeProps {
  status: Status | string;
  className?: string;
  showDot?: boolean;
  label?: string;
}

export function StatusBadge({ status, className, showDot = true, label }: StatusBadgeProps) {
  const colorClass = statusColors[status] || statusColors.unknown;
  const dotColorClass = statusDotColors[status] || statusDotColors.unknown;
  const isActive = activeStatuses.includes(status);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize transition-colors duration-500',
        colorClass,
        className
      )}
    >
      {showDot && (
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            dotColorClass,
            isActive && 'status-pulse'
          )}
        />
      )}
      {label ?? status}
    </span>
  );
}
