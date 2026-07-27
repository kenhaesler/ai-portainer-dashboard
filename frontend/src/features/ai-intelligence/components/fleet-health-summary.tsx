import { Activity, AlertCircle, AlertTriangle, CheckCircle2, ChevronRight, HelpCircle, Info } from 'lucide-react';
import { Link } from 'react-router';
import { SkeletonChart } from '@/shared/components/feedback/skeleton';
import { HealthScoreCard } from '@/shared/components/data-display/health-score-card';
import {
  calculateHealthStats,
  calculateHealthcheckPassRate,
  type HealthStats,
} from '@/shared/lib/health-score';

// Re-export the shared helpers so existing imports from this module keep
// working. The canonical home for the types and calculators is
// `@/shared/lib/health-score` — see that file for the pass-rate formula and
// for `calculateNeedsAttention`, which drives the hero.
export { calculateHealthStats, calculateHealthcheckPassRate };
export type { HealthStats };

/**
 * Compact horizontal stat tile used in the Fleet Vitals strip.
 *
 * Deliberately count-only. Each tile used to carry its own percentage of
 * `stats.total`, which put `11 · 85%` (11/13) forty pixels from a hero reading
 * `100.0%` (11/11) with neither denominator labelled. One denominator per row
 * now: the row states `of N containers` once and the tiles state counts.
 */
function HealthStatTile({
  icon: Icon,
  label,
  value,
  variant = 'default',
  onClick,
  to,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  onClick?: () => void;
  /**
   * Destination for a tile that drills into the rows behind its number. Pass
   * it conditionally — a tile reading `0` that links to an empty filtered
   * table is a dead end wearing a chevron.
   */
  to?: string;
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
        <span className="text-xl font-bold tabular-nums leading-none">{value}</span>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">{label}</p>
      </div>
    </>
  );

  // A tile that navigates says so. Without the chevron the five dead tiles and
  // the one live one were styled identically.
  const affordance = <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />;
  const interactiveClasses =
    'flex w-full items-center gap-3 rounded-md bg-muted/40 px-3 py-2 text-left transition-colors hover:bg-muted/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer';

  if (to) {
    return (
      <Link to={to} className={interactiveClasses} data-testid={`fleet-tile-link-${label}`}>
        {inner}
        {affordance}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={interactiveClasses}>
        {inner}
        {affordance}
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
 * Warning / Info).
 *
 * `unacknowledgedCritical` / `unacknowledgedWarning` are what the hero's
 * "Needs attention" number is built from; they are optional so a caller that
 * has not computed them yet degrades to a container-only count rather than to
 * a wrong one.
 */
export interface InsightStats {
  total: number;
  critical: number;
  warning: number;
  info: number;
  unacknowledgedCritical?: number;
  unacknowledgedWarning?: number;
}

/**
 * Caller-supplied tile appended after the four container-status tiles (e.g.
 * Stopped, Security Findings on the Home page). Rendered with the same
 * `HealthStatTile`; `to` makes it a link, `onClick` a button.
 */
export interface ExtraTile {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  onClick?: () => void;
  to?: string;
}

export function FleetHealthSummary({
  stats,
  isLoading,
  insightStats,
  statusColumns = 4,
  extraTiles,
  layout = 'status-first',
}: {
  stats: HealthStats | null;
  isLoading: boolean;
  insightStats?: InsightStats;
  /** Column count for the container-status tile row (default 4). */
  statusColumns?: 3 | 4;
  /** Tiles appended after the four container-status tiles. */
  extraTiles?: ExtraTile[];
  /**
   * `'status-first'` (Home) renders the container-status tiles in full.
   * `'insights-first'` (Health & Monitoring) leads with the insight tiles and
   * collapses container status to one line — Home has already carried that
   * strip in full, and navigating Home → Health used to leave the top ~180px
   * of the viewport unchanged.
   */
  layout?: 'status-first' | 'insights-first';
}) {
  if (isLoading || !stats) {
    return <SkeletonChart size="md" className="h-44" />;
  }

  const insightCounts = insightStats
    ? {
        critical: insightStats.unacknowledgedCritical ?? 0,
        warning: insightStats.unacknowledgedWarning ?? 0,
      }
    : undefined;

  const insightTiles = insightStats ? (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <HealthStatTile icon={Activity} label="Total Insights" value={insightStats.total} />
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
      <HealthStatTile icon={Info} label="Info" value={insightStats.info} variant="info" />
    </div>
  ) : null;

  const statusTiles = (
    <div className="flex flex-col gap-1.5">
      {/* One denominator for the whole row, stated once. */}
      <p className="text-xs text-muted-foreground" data-testid="fleet-status-denominator">
        of {stats.total} containers
      </p>
      <div className={`grid grid-cols-2 gap-2 ${statusColumns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-4'}`}>
        <HealthStatTile
          icon={Activity}
          label="Running"
          value={stats.running}
          variant="success"
          to={stats.running > 0 ? '/workloads?state=running' : undefined}
        />
        <HealthStatTile icon={CheckCircle2} label="Healthy" value={stats.healthy} variant="success" />
        <HealthStatTile
          icon={AlertTriangle}
          label="Unhealthy"
          value={stats.unhealthy}
          variant="danger"
          to={stats.unhealthy > 0 ? '/health' : undefined}
        />
        <HealthStatTile
          icon={HelpCircle}
          label="No Healthcheck"
          value={stats.noHealthcheck}
          variant={stats.noHealthcheck > 0 ? 'warning' : 'default'}
        />
        {extraTiles?.map((tile) => (
          <HealthStatTile
            key={tile.label}
            icon={tile.icon}
            label={tile.label}
            value={tile.value}
            variant={tile.variant}
            onClick={tile.onClick}
            to={tile.to}
          />
        ))}
      </div>
    </div>
  );

  const collapsedStatusLine = (
    <p className="text-xs text-muted-foreground" data-testid="fleet-status-line">
      {stats.total} containers · {stats.running} running · {stats.healthy} healthy ·{' '}
      {stats.unhealthy} unhealthy · {stats.noHealthcheck} without a healthcheck
    </p>
  );

  return (
    <div
      className="rounded-lg border bg-card p-6 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 hover:border-primary/20"
      data-testid="fleet-health-hero"
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        {/* Hero — needs-attention count + healthcheck pass rate */}
        <HealthScoreCard stats={stats} insightCounts={insightCounts} />

        <div className="flex flex-col gap-2 lg:w-auto">
          {layout === 'insights-first' ? (
            <>
              {insightTiles}
              {collapsedStatusLine}
            </>
          ) : (
            <>
              {statusTiles}
              {insightTiles}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
