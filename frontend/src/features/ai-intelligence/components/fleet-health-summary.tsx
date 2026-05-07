import { Activity, AlertCircle, AlertTriangle, CheckCircle2, HelpCircle, XCircle } from 'lucide-react';
import { SkeletonCard } from '@/shared/components/feedback/loading-skeleton';
import type { Container } from '@/features/containers/hooks/use-containers';

export interface HealthStats {
  total: number;
  running: number;
  stopped: number;
  paused: number;
  unhealthy: number;
  healthy: number;
  unknown: number;
  /**
   * Running containers without a Docker healthcheck configured. These are
   * excluded from the health-score denominator (score = healthy / (healthy +
   * unhealthy)) so the operator's choice not to configure a healthcheck
   * doesn't artificially deflate the fleet health number.
   */
  noHealthcheck: number;
}

export function calculateHealthStats(containers: Container[]): HealthStats {
  const stats: HealthStats = {
    total: containers.length,
    running: 0,
    stopped: 0,
    paused: 0,
    unhealthy: 0,
    healthy: 0,
    unknown: 0,
    noHealthcheck: 0,
  };

  containers.forEach((container) => {
    if (container.state === 'running') stats.running++;
    else if (container.state === 'exited') stats.stopped++;
    else if (container.state === 'paused') stats.paused++;

    if (container.healthStatus === 'unhealthy') stats.unhealthy++;
    else if (container.healthStatus === 'healthy') stats.healthy++;
    else {
      stats.unknown++;
      if (container.state === 'running') stats.noHealthcheck++;
    }
  });

  return stats;
}

/**
 * Score = healthy / (healthy + unhealthy). Containers without a healthcheck
 * are excluded so the operator's choice not to configure one doesn't drag
 * the score down. Returns null when no container reports a health signal.
 */
export function calculateHealthScore(stats: HealthStats): number | null {
  const reporting = stats.healthy + stats.unhealthy;
  if (reporting === 0) return null;
  return (stats.healthy / reporting) * 100;
}

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
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  percentage?: number;
  variant?: 'default' | 'success' | 'warning' | 'danger';
}) {
  const iconVariantClasses = {
    default: 'text-muted-foreground',
    success: 'text-emerald-600 dark:text-emerald-400',
    warning: 'text-amber-600 dark:text-amber-400',
    danger: 'text-red-600 dark:text-red-400',
  };

  return (
    <div className="flex items-center gap-3 rounded-md bg-muted/40 px-3 py-2">
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
    </div>
  );
}

export function FleetHealthSummary({ stats, isLoading }: {
  stats: HealthStats | null;
  isLoading: boolean;
}) {
  if (isLoading || !stats) {
    return <SkeletonCard className="h-44" />;
  }

  const healthScore = calculateHealthScore(stats);
  const reporting = stats.healthy + stats.unhealthy;
  const issueCount = stats.unhealthy + stats.stopped;

  return (
    <div
      className="rounded-lg border bg-card p-6 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 hover:border-primary/20"
      data-testid="fleet-health-hero"
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        {/* Hero — score + issue count */}
        <div className="flex items-center gap-5 min-w-0">
          <div className="flex h-24 w-24 flex-shrink-0 items-center justify-center rounded-full border-8 border-primary/20 bg-muted/30">
            {healthScore === null ? (
              <HelpCircle className="h-12 w-12 text-muted-foreground" />
            ) : healthScore >= 80 ? (
              <CheckCircle2 className="h-12 w-12 text-emerald-500" />
            ) : healthScore >= 50 ? (
              <AlertCircle className="h-12 w-12 text-amber-500" />
            ) : (
              <XCircle className="h-12 w-12 text-red-500" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground">Overall Health Score</p>
            {healthScore === null ? (
              <>
                <p className="text-2xl font-semibold text-muted-foreground" data-testid="health-score-na">
                  No healthchecks configured
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {stats.total} containers tracked. Configure Docker healthchecks to enable scoring.
                </p>
              </>
            ) : (
              <>
                <p className="text-4xl font-bold tabular-nums leading-none mt-1" data-testid="health-score">
                  {healthScore.toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {stats.healthy} of {reporting} reporting healthy
                  {stats.noHealthcheck > 0 && ` · ${stats.noHealthcheck} without healthcheck`}
                </p>
              </>
            )}
            {issueCount > 0 && (
              <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-red-700 dark:text-red-400">
                <AlertTriangle className="h-4 w-4" />
                {issueCount} container{issueCount === 1 ? '' : 's'} need{issueCount === 1 ? 's' : ''} attention
              </p>
            )}
          </div>
        </div>

        {/* Compact status strip — 4 stats inline instead of separate large cards */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:w-auto">
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
        </div>
      </div>
    </div>
  );
}
