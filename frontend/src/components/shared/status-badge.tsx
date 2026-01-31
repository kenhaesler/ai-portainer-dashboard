import { cn } from '@/lib/utils';

type Status = 'running' | 'stopped' | 'paused' | 'unhealthy' | 'healthy' | 'unknown' |
  'up' | 'down' | 'active' | 'inactive' |
  'pending' | 'approved' | 'rejected' | 'executing' | 'completed' | 'failed' |
  'critical' | 'warning' | 'info' | 'ok' | 'error';

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
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  ok: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  error: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

interface StatusBadgeProps {
  status: Status | string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const colorClass = statusColors[status] || statusColors.unknown;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
        colorClass,
        className
      )}
    >
      {status}
    </span>
  );
}
