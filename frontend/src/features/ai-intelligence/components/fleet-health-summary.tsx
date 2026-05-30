import { Activity, AlertCircle, AlertTriangle, CheckCircle2, HelpCircle, Info } from 'lucide-react';
import { SkeletonChart } from '@/shared/components/feedback/skeleton';
import { HealthScoreCard } from '@/shared/components/data-display/health-score-card';
import {
  calculateHealthStats,
  calculateHealthScore,
  type HealthStats,
} from '@/shared/lib/health-score';

// Re-export the shared helpers so existing imports from this module keep
// working. The canonical home for the types and calculators is
// `@/shared/lib/health-score` — see that file for the score formula.
export { calculateHealthStats, calculateHealthScore };
export type { HealthStats };

/**
 * Compact horizontal stat tile used in the Fleet Vitals strip. Replaces the
 * earlier 4-card grid of large boxed stats — keeps all four numbers visible
 * but in roughly half the vertical mass so the hero score still dominates.
 */
function HealthStatTile({
  icon: Icon,
  label,
  value,
  percentage,
  variant = 'default',
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  percentage?: number;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  onClick?: () => void;
}) {
  const iconVariantClasses = {
    default: 'text-muted-foreground',
    success: 'text-emerald-600 dark:text-emerald-400',
    warning: 'text-amber-600 dark:text-amber-400',
    danger: 'text-red-600 dark:text-red-400',
    info: 'text-blue-600 dark:text-blue-400',
  };

  const inner = (
    <>
      <div className={`flex h-8 w-8 items-center justify-center rounded-md bg-background ${iconVariantClasses[variant]}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold tabular-nums leading-none">{value}</span>
          {percentage !== undefined && value > 0 && (
            <span className="text-xs text-muted-foreground tabular-nums">{percentage.toFixed(0)}%</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">{label}</p>
      </div>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-3 rounded-md bg-muted/40 px-3 py-2 text-left transition-colors hover:bg-muted/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
      >
        {inner}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-md bg-muted/40 px-3 py-2">
      {inner}
    </div>
  );
}

/**
 * Optional second row of stat tiles for insight counts (Total / Critical /
 * Warning / Info). When provided, renders below the container-status row
 * inside the same hero pane so the page only has one Vitals card to scan.
 */
export interface InsightStats {
  total: number;
  critical: number;
  warning: number;
  info: number;
}

/**
 * Caller-supplied tile appended after the four container-status tiles (e.g.
 * Stopped, Security Findings on the Home page). Rendered with the same
 * `HealthStatTile`; an `onClick` turns it into a button.
 */
export interface ExtraTile {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  percentage?: number;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  onClick?: () => void;
}

export function FleetHealthSummary({ stats, isLoading, insightStats, statusColumns = 4, extraTiles }: {
  stats: HealthStats | null;
  isLoading: boolean;
  insightStats?: InsightStats;
  /** Column count for the container-status tile row (default 4). */
  statusColumns?: 3 | 4;
  /** Tiles appended after the four container-status tiles. */
  extraTiles?: ExtraTile[];
}) {
  if (isLoading || !stats) {
    return <SkeletonChart size="md" className="h-44" />;
  }

  return (
    <div
      className="rounded-lg border bg-card p-6 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 hover:border-primary/20"
      data-testid="fleet-health-hero"
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        {/* Hero — score + issue count */}
        <HealthScoreCard stats={stats} />

        {/* Compact status strip — container stats on row 1, insights stats on
            row 2 (when supplied). Two rows of 4 tiles inside the same hero. */}
        <div className="flex flex-col gap-2 lg:w-auto">
          <div className={`grid grid-cols-2 gap-2 ${statusColumns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-4'}`}>
            <HealthStatTile
              icon={Activity}
              label="Running"
              value={stats.running}
              percentage={stats.total > 0 ? (stats.running / stats.total) * 100 : 0}
              variant="success"
            />
            <HealthStatTile
              icon={CheckCircle2}
              label="Healthy"
              value={stats.healthy}
              percentage={stats.total > 0 ? (stats.healthy / stats.total) * 100 : 0}
              variant="success"
            />
            <HealthStatTile
              icon={AlertTriangle}
              label="Unhealthy"
              value={stats.unhealthy}
              percentage={stats.total > 0 ? (stats.unhealthy / stats.total) * 100 : 0}
              variant="danger"
            />
            <HealthStatTile
              icon={HelpCircle}
              label="No Healthcheck"
              value={stats.noHealthcheck}
              percentage={stats.total > 0 ? (stats.noHealthcheck / stats.total) * 100 : 0}
              variant={stats.noHealthcheck > 0 ? 'warning' : 'default'}
            />
            {extraTiles?.map((tile) => (
              <HealthStatTile
                key={tile.label}
                icon={tile.icon}
                label={tile.label}
                value={tile.value}
                percentage={tile.percentage}
                variant={tile.variant}
                onClick={tile.onClick}
              />
            ))}
          </div>
          {insightStats && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <HealthStatTile
                icon={Activity}
                label="Total Insights"
                value={insightStats.total}
              />
              <HealthStatTile
                icon={AlertTriangle}
                label="Critical"
                value={insightStats.critical}
                variant="danger"
              />
              <HealthStatTile
                icon={AlertCircle}
                label="Warnings"
                value={insightStats.warning}
                variant="warning"
              />
              <HealthStatTile
                icon={Info}
                label="Info"
                value={insightStats.info}
                variant="info"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
