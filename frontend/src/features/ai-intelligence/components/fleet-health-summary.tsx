import { Activity, AlertCircle, AlertTriangle, CheckCircle2, Pause, XCircle } from 'lucide-react';
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
  };

  containers.forEach((container) => {
    if (container.state === 'running') stats.running++;
    else if (container.state === 'exited') stats.stopped++;
    else if (container.state === 'paused') stats.paused++;

    if (container.healthStatus === 'unhealthy') stats.unhealthy++;
    else if (container.healthStatus === 'healthy') stats.healthy++;
    else if (container.state === 'running') stats.healthy++;
    else stats.unknown++;
  });

  return stats;
}

function HealthStatCard({
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
  const variantClasses = {
    default: 'bg-card border-border',
    success: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-900/30',
    warning: 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-900/30',
    danger: 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-900/30',
  };

  const iconVariantClasses = {
    default: 'text-primary',
    success: 'text-emerald-600 dark:text-emerald-400',
    warning: 'text-amber-600 dark:text-amber-400',
    danger: 'text-red-600 dark:text-red-400',
  };

  return (
    <div className={`rounded-lg border p-4 shadow-sm ${variantClasses[variant]}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm text-muted-foreground mb-1">{label}</p>
          <p className="text-3xl font-bold">{value}</p>
          {percentage !== undefined && (
            <p className="text-xs text-muted-foreground mt-1">{percentage.toFixed(1)}%</p>
          )}
        </div>
        <div className={`rounded-lg p-2 ${iconVariantClasses[variant]}`}>
          <Icon className="h-6 w-6" />
        </div>
      </div>
    </div>
  );
}

export function FleetHealthSummary({ stats, healthPercentage, isLoading }: {
  stats: HealthStats | null;
  healthPercentage: number;
  isLoading: boolean;
}) {
  if (isLoading || !stats) {
    return (
      <>
        <SkeletonCard className="h-36" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <SkeletonCard className="h-24" />
          <SkeletonCard className="h-24" />
          <SkeletonCard className="h-24" />
          <SkeletonCard className="h-24" />
        </div>
      </>
    );
  }

  return (
    <>
      {/* Overall Health Score */}
      <div className="rounded-lg border bg-gradient-to-br from-primary/5 to-primary/10 p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">Overall Health Score</p>
            <p className="text-5xl font-bold">{healthPercentage.toFixed(1)}%</p>
            <p className="text-sm text-muted-foreground mt-2">
              {stats.healthy} of {stats.total} containers healthy
            </p>
          </div>
          <div className="flex h-32 w-32 items-center justify-center rounded-full border-8 border-primary/20">
            {healthPercentage >= 80 ? (
              <CheckCircle2 className="h-16 w-16 text-emerald-500" />
            ) : healthPercentage >= 50 ? (
              <AlertCircle className="h-16 w-16 text-amber-500" />
            ) : (
              <XCircle className="h-16 w-16 text-red-500" />
            )}
          </div>
        </div>
      </div>

      {/* Health Statistics Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <HealthStatCard
          icon={Activity}
          label="Running"
          value={stats.running}
          percentage={stats.total > 0 ? (stats.running / stats.total) * 100 : 0}
          variant="success"
        />
        <HealthStatCard
          icon={CheckCircle2}
          label="Healthy"
          value={stats.healthy}
          percentage={stats.total > 0 ? (stats.healthy / stats.total) * 100 : 0}
          variant="success"
        />
        <HealthStatCard
          icon={AlertTriangle}
          label="Unhealthy"
          value={stats.unhealthy}
          percentage={stats.total > 0 ? (stats.unhealthy / stats.total) * 100 : 0}
          variant="danger"
        />
        <HealthStatCard
          icon={Pause}
          label="Stopped"
          value={stats.stopped}
          percentage={stats.total > 0 ? (stats.stopped / stats.total) * 100 : 0}
          variant="warning"
        />
      </div>
    </>
  );
}
