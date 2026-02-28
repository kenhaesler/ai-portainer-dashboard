import { useMemo } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Server, Layers } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import type { Endpoint } from '@/features/containers/hooks/use-endpoints';
import { transition } from '@/shared/lib/motion-tokens';

interface StackWithStatus {
  status: 'active' | 'inactive';
}

const ENDPOINT_STATUS_COLORS: Record<string, { dot: string; text: string; bar: string }> = {
  up: { dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400', bar: 'bg-emerald-500' },
  down: { dot: 'bg-red-500', text: 'text-red-700 dark:text-red-400', bar: 'bg-red-500' },
};

const STACK_STATUS_COLORS: Record<string, { dot: string; text: string; bar: string }> = {
  active: { dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400', bar: 'bg-emerald-500' },
  inactive: { dot: 'bg-gray-500', text: 'text-gray-700 dark:text-gray-400', bar: 'bg-gray-500' },
};

export interface FleetStatusSummaryProps {
  endpoints: Endpoint[];
  stacks: StackWithStatus[];
  activeEndpointStatusFilter: string | undefined;
  onEndpointStatusChange: (status: string | undefined) => void;
  activeStackStatusFilter: string | undefined;
  onStackStatusChange: (status: string | undefined) => void;
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

function ProgressBar({
  segments,
  total,
}: {
  segments: { key: string; count: number; barColor: string }[];
  total: number;
}) {
  if (total === 0) return null;

  return (
    <div className="flex h-1 w-full overflow-hidden rounded-full bg-muted/50" data-testid="progress-bar">
      {segments
        .filter(({ count }) => count > 0)
        .map(({ key, count, barColor }) => {
          const percentage = (count / total) * 100;
          return (
            <div
              key={key}
              className={cn('transition-all duration-300', barColor)}
              style={{ width: `${percentage}%` }}
              title={`${key}: ${count} (${percentage.toFixed(1)}%)`}
            />
          );
        })}
    </div>
  );
}

export function FleetStatusSummary({
  endpoints,
  stacks,
  activeEndpointStatusFilter,
  onEndpointStatusChange,
  activeStackStatusFilter,
  onStackStatusChange,
}: FleetStatusSummaryProps) {
  const reduceMotion = useReducedMotion();

  const endpointCounts = useMemo(() => {
    const up = endpoints.filter((ep) => ep.status === 'up').length;
    const down = endpoints.filter((ep) => ep.status === 'down').length;
    return { up, down, total: endpoints.length };
  }, [endpoints]);

  const stackCounts = useMemo(() => {
    const active = stacks.filter((s) => s.status === 'active').length;
    const inactive = stacks.filter((s) => s.status === 'inactive').length;
    return { active, inactive, total: stacks.length };
  }, [stacks]);

  const handleEndpointPillClick = (status: string) => {
    onEndpointStatusChange(activeEndpointStatusFilter === status ? undefined : status);
  };

  const handleStackPillClick = (status: string) => {
    onStackStatusChange(activeStackStatusFilter === status ? undefined : status);
  };

  return (
    <div
      className="rounded-lg border bg-card px-6 py-4 shadow-sm text-sm space-y-4"
      data-testid="summary-bar"
    >
      {/* Endpoint summary */}
      <div className="space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" />
            <button
              type="button"
              onClick={() => onEndpointStatusChange(undefined)}
              className={cn(
                'text-sm font-medium transition-colors',
                !activeEndpointStatusFilter
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              title="Show all endpoints"
              data-testid="endpoint-total"
            >
              {endpointCounts.total} endpoint{endpointCounts.total !== 1 ? 's' : ''}
            </button>
          </div>

          <span className="text-border">|</span>

          <AnimatePresence mode="popLayout">
            <StatusPill
              key="up"
              label="Up"
              count={endpointCounts.up}
              isActive={activeEndpointStatusFilter === 'up'}
              colors={ENDPOINT_STATUS_COLORS.up}
              onClick={() => handleEndpointPillClick('up')}
              reduceMotion={reduceMotion}
            />
            <StatusPill
              key="down"
              label="Down"
              count={endpointCounts.down}
              isActive={activeEndpointStatusFilter === 'down'}
              colors={ENDPOINT_STATUS_COLORS.down}
              onClick={() => handleEndpointPillClick('down')}
              reduceMotion={reduceMotion}
            />
          </AnimatePresence>
        </div>

        <ProgressBar
          segments={[
            { key: 'up', count: endpointCounts.up, barColor: ENDPOINT_STATUS_COLORS.up.bar },
            { key: 'down', count: endpointCounts.down, barColor: ENDPOINT_STATUS_COLORS.down.bar },
          ]}
          total={endpointCounts.total}
        />
      </div>

      <div className="h-px bg-border/50" />

      {/* Stack summary */}
      <div className="space-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <button
              type="button"
              onClick={() => onStackStatusChange(undefined)}
              className={cn(
                'text-sm font-medium transition-colors',
                !activeStackStatusFilter
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              title="Show all stacks"
              data-testid="stack-total"
            >
              {stackCounts.total} stack{stackCounts.total !== 1 ? 's' : ''}
            </button>
          </div>

          <span className="text-border">|</span>

          <AnimatePresence mode="popLayout">
            <StatusPill
              key="active"
              label="Active"
              count={stackCounts.active}
              isActive={activeStackStatusFilter === 'active'}
              colors={STACK_STATUS_COLORS.active}
              onClick={() => handleStackPillClick('active')}
              reduceMotion={reduceMotion}
            />
            <StatusPill
              key="inactive"
              label="Inactive"
              count={stackCounts.inactive}
              isActive={activeStackStatusFilter === 'inactive'}
              colors={STACK_STATUS_COLORS.inactive}
              onClick={() => handleStackPillClick('inactive')}
              reduceMotion={reduceMotion}
            />
          </AnimatePresence>
        </div>

        <ProgressBar
          segments={[
            { key: 'active', count: stackCounts.active, barColor: STACK_STATUS_COLORS.active.bar },
            { key: 'inactive', count: stackCounts.inactive, barColor: STACK_STATUS_COLORS.inactive.bar },
          ]}
          total={stackCounts.total}
        />
      </div>
    </div>
  );
}
