import { useMemo } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import type { Container } from '@/hooks/use-containers';
import { cn } from '@/lib/utils';

const STATE_ORDER = ['running', 'stopped', 'exited', 'paused', 'created', 'restarting', 'dead'] as const;

const STATE_COLORS: Record<string, { dot: string; text: string; bar: string }> = {
  running: { dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400', bar: 'bg-emerald-500' },
  stopped: { dot: 'bg-red-500', text: 'text-red-700 dark:text-red-400', bar: 'bg-red-500' },
  exited: { dot: 'bg-red-500', text: 'text-red-700 dark:text-red-400', bar: 'bg-red-500' },
  paused: { dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400', bar: 'bg-amber-500' },
  created: { dot: 'bg-blue-500', text: 'text-blue-700 dark:text-blue-400', bar: 'bg-blue-500' },
  restarting: { dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400', bar: 'bg-amber-500' },
  dead: { dot: 'bg-gray-500', text: 'text-gray-700 dark:text-gray-400', bar: 'bg-gray-500' },
};

const DEFAULT_COLOR = { dot: 'bg-gray-500', text: 'text-gray-700 dark:text-gray-400', bar: 'bg-gray-500' };

interface WorkloadStatusSummaryProps {
  containers: Container[];
  activeStateFilter: string | undefined;
  onStateFilterChange: (state: string | undefined) => void;
}

export function WorkloadStatusSummary({
  containers,
  activeStateFilter,
  onStateFilterChange,
}: WorkloadStatusSummaryProps) {
  const reduceMotion = useReducedMotion();
  const stateCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const container of containers) {
      counts.set(container.state, (counts.get(container.state) || 0) + 1);
    }
    return counts;
  }, [containers]);

  const total = containers.length;

  const orderedStates = useMemo(() => {
    const result: { state: string; count: number }[] = [];
    for (const state of STATE_ORDER) {
      result.push({ state, count: stateCounts.get(state) || 0 });
    }
    for (const [state, count] of stateCounts) {
      if (!STATE_ORDER.includes(state as (typeof STATE_ORDER)[number])) {
        result.push({ state, count });
      }
    }
    return result;
  }, [stateCounts]);

  if (total === 0) return null;

  return (
    <div className="rounded-lg border bg-card/50 backdrop-blur-sm p-3 shadow-sm space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => onStateFilterChange(undefined)}
          className={cn(
            'text-sm font-medium transition-colors',
            !activeStateFilter
              ? 'text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
          title="Show all containers"
        >
          Total: {total}
        </button>

        <span className="text-border">|</span>

        <AnimatePresence mode="popLayout">
          {orderedStates.map(({ state, count }) => {
            const colors = STATE_COLORS[state] || DEFAULT_COLOR;
            const isActive = activeStateFilter === state;

            return (
              <motion.button
                key={state}
                type="button"
                initial={reduceMotion ? false : { opacity: 0, scale: 0.9 }}
                animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
                transition={reduceMotion ? { duration: 0 } : { duration: 0.15 }}
                onClick={() => onStateFilterChange(isActive ? undefined : state)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-all duration-150',
                  count === 0 && 'opacity-50',
                  isActive
                    ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                    : 'hover:ring-1 hover:ring-primary/30',
                )}
                title={isActive ? `Clear ${state} filter` : `Filter by ${state}`}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', colors.dot)} />
                <span className={cn(colors.text, 'capitalize')}>{state}</span>
                <span className="text-muted-foreground">({count})</span>
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>

      <div className="flex h-1 w-full overflow-hidden rounded-full bg-muted/50">
        {orderedStates
          .filter(({ count }) => count > 0)
          .map(({ state, count }) => {
            const colors = STATE_COLORS[state] || DEFAULT_COLOR;
            const percentage = (count / total) * 100;
            return (
              <div
                key={state}
                className={cn('transition-all duration-300', colors.bar)}
                style={{ width: `${percentage}%` }}
                title={`${state}: ${count} (${percentage.toFixed(1)}%)`}
              />
            );
          })}
      </div>
    </div>
  );
}
