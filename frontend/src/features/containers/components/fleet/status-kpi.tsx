import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { cn } from '@/shared/lib/utils';
import { transition } from '@/shared/lib/motion-tokens';

export const ENDPOINT_STATUS_COLORS: Record<string, { dot: string; text: string }> = {
  up: { dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400' },
  down: { dot: 'bg-red-500', text: 'text-red-700 dark:text-red-400' },
};

export const STACK_STATUS_COLORS: Record<string, { dot: string; text: string }> = {
  active: { dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400' },
  inactive: { dot: 'bg-gray-500', text: 'text-gray-700 dark:text-gray-400' },
};

export interface StatusKpiPill {
  key: string;
  label: string;
  count: number;
  isActive: boolean;
  colors: { dot: string; text: string };
  onClick: () => void;
}

export interface StatusKpiProps {
  pills: StatusKpiPill[];
  ariaLabel: string;
}

function StatusPill({
  label,
  count,
  isActive,
  colors,
  onClick,
  reduceMotion,
}: {
  label: string;
  count: number;
  isActive: boolean;
  colors: { dot: string; text: string };
  onClick: () => void;
  reduceMotion: boolean | null;
}) {
  return (
    <motion.button
      type="button"
      initial={reduceMotion ? false : { opacity: 0, scale: 0.9 }}
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
      transition={reduceMotion ? { duration: 0 } : transition.fast}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-all duration-150',
        count === 0 && 'opacity-50',
        isActive
          ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
          : 'hover:ring-1 hover:ring-primary/30',
      )}
      title={isActive ? `Clear ${label} filter` : `Filter by ${label}`}
      data-testid={`status-pill-${label.toLowerCase()}`}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', colors.dot)} />
      <span className={cn(colors.text, 'capitalize')}>{label}</span>
      <span className="text-muted-foreground">({count})</span>
    </motion.button>
  );
}

/**
 * Slim, inline status KPI — a row of clickable status pills meant to sit on a
 * tab's search row. Purely presentational: the caller supplies counts, active
 * state, colors, and click handlers.
 */
export function StatusKpi({ pills, ariaLabel }: StatusKpiProps) {
  const reduceMotion = useReducedMotion();

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex items-center gap-2"
      data-testid="status-kpi"
    >
      <AnimatePresence mode="popLayout">
        {pills.map((pill) => (
          <StatusPill
            key={pill.key}
            label={pill.label}
            count={pill.count}
            isActive={pill.isActive}
            colors={pill.colors}
            onClick={pill.onClick}
            reduceMotion={reduceMotion}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
