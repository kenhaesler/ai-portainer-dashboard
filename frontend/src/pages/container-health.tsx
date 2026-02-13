import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Activity,
  CheckCircle2,
  XCircle,
  Pause,
  TrendingUp,
  Brain,
  AlertCircle,
  ExternalLink
} from 'lucide-react';
import { useContainers, type Container } from '@/hooks/use-containers';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import { StatusBadge } from '@/components/shared/status-badge';
import { AutoRefreshToggle } from '@/components/shared/auto-refresh-toggle';
import { RefreshButton } from '@/components/shared/refresh-button';
import { useForceRefresh } from '@/hooks/use-force-refresh';
import { SkeletonCard } from '@/components/shared/loading-skeleton';
import { SpotlightCard } from '@/components/shared/spotlight-card';

interface HealthStats {
  total: number;
  running: number;
  stopped: number;
  paused: number;
  unhealthy: number;
  healthy: number;
  unknown: number;
}

function calculateHealthStats(containers: Container[]): HealthStats {
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
    // Count by state
    if (container.state === 'running') stats.running++;
    else if (container.state === 'exited') stats.stopped++;
    else if (container.state === 'paused') stats.paused++;

    // Count by health
    if (container.healthStatus === 'unhealthy') stats.unhealthy++;
    else if (container.healthStatus === 'healthy') stats.healthy++;
    else if (container.state === 'running') stats.healthy++;
    else stats.unknown++;
  });

  return stats;
}

interface StatCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  percentage?: number;
  variant?: 'default' | 'success' | 'warning' | 'danger';
}

function StatCard({ icon: Icon, label, value, percentage, variant = 'default' }: StatCardProps) {
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
    <SpotlightCard>
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
    </SpotlightCard>
  );
}

interface UnhealthyContainerRowProps {
  container: Container;
  onClick: () => void;
}

function UnhealthyContainerRow({ container, onClick }: UnhealthyContainerRowProps) {
  return (
    <button
      onClick={onClick}
      className="group w-full flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent transition-colors text-left"
    >
      <div className="flex items-center gap-4 flex-1 min-w-0">
        <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate">{container.name}</p>
          <p className="text-sm text-muted-foreground truncate">{container.endpointName}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={container.state} className="text-xs" />
          <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
        </div>
      </div>
    </button>
  );
}

export default function ContainerHealthPage() {
  const navigate = useNavigate();
  const { data: containers, isLoading, isError, error, refetch, isFetching } = useContainers();
  const { forceRefresh, isForceRefreshing } = useForceRefresh('containers', refetch);
  const { interval, setInterval } = useAutoRefresh(30);

  const stats = useMemo(() => {
    if (!containers) return null;
    return calculateHealthStats(containers);
  }, [containers]);

  const unhealthyContainers = useMemo(() => {
    if (!containers) return [];
    return containers.filter(
      (c) => c.healthStatus === 'unhealthy' || (c.state !== 'running' && c.state !== 'created')
    );
  }, [containers]);

  const healthPercentage = useMemo(() => {
    if (!stats || stats.total === 0) return 0;
    return (stats.healthy / stats.total) * 100;
  }, [stats]);

  if (isError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Container Health</h1>
          <p className="text-muted-foreground">
            Fleet-wide health analysis and AI assessment
          </p>
        </div>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
          <p className="mt-4 font-medium text-destructive">Failed to load containers</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'An unexpected error occurred'}
          </p>
          <button
            onClick={() => refetch()}
            className="mt-4 inline-flex items-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (isLoading || !stats) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Container Health</h1>
          <p className="text-muted-foreground">
            Fleet-wide health analysis and AI assessment
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <SkeletonCard className="h-32" />
          <SkeletonCard className="h-32" />
          <SkeletonCard className="h-32" />
          <SkeletonCard className="h-32" />
        </div>
        <SkeletonCard className="h-[400px]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Container Health</h1>
          <p className="text-muted-foreground">
            Fleet-wide health analysis and AI assessment
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoRefreshToggle interval={interval} onIntervalChange={setInterval} />
          <RefreshButton onClick={() => refetch()} onForceRefresh={forceRefresh} isLoading={isFetching || isForceRefreshing} />
        </div>
      </div>

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
        <StatCard
          icon={Activity}
          label="Running"
          value={stats.running}
          percentage={(stats.running / stats.total) * 100}
          variant="success"
        />
        <StatCard
          icon={CheckCircle2}
          label="Healthy"
          value={stats.healthy}
          percentage={(stats.healthy / stats.total) * 100}
          variant="success"
        />
        <StatCard
          icon={AlertTriangle}
          label="Unhealthy"
          value={stats.unhealthy}
          percentage={(stats.unhealthy / stats.total) * 100}
          variant="danger"
        />
        <StatCard
          icon={XCircle}
          label="Stopped"
          value={stats.stopped}
          percentage={(stats.stopped / stats.total) * 100}
          variant="warning"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Unhealthy Containers */}
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            Issues Detected ({unhealthyContainers.length})
          </h3>
          {unhealthyContainers.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500 mb-2" />
              <p className="text-sm text-muted-foreground">
                All containers are healthy!
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {unhealthyContainers.map((container) => (
                <UnhealthyContainerRow
                  key={container.id}
                  container={container}
                  onClick={() => navigate(`/containers/${container.endpointId}/${container.id}`)}
                />
              ))}
            </div>
          )}
        </div>

        {/* AI Health Assessment */}
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            AI Health Assessment
          </h3>
          <div className="space-y-4">
            {/* AI Insights */}
            <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900/30 p-4">
              <div className="flex items-start gap-3">
                <TrendingUp className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-blue-900 dark:text-blue-100 mb-1">Fleet Status</p>
                  <p className="text-sm text-blue-700 dark:text-blue-300">
                    {healthPercentage >= 80
                      ? 'Your container fleet is in excellent health. All critical services are operational.'
                      : healthPercentage >= 50
                      ? 'Some containers require attention. Review unhealthy containers for potential issues.'
                      : 'Critical health issues detected. Immediate action recommended for multiple containers.'}
                  </p>
                </div>
              </div>
            </div>

            {/* Recommendations */}
            {stats.unhealthy > 0 && (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/30 p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-amber-900 dark:text-amber-100 mb-1">Recommendations</p>
                    <ul className="text-sm text-amber-700 dark:text-amber-300 space-y-1">
                      <li>• Check logs for unhealthy containers to identify root causes</li>
                      <li>• Verify resource availability (CPU, memory, disk space)</li>
                      <li>• Review recent deployments or configuration changes</li>
                      <li>• Consider scaling resources if persistent issues occur</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* AI Chat Link */}
            <button
              onClick={() => navigate('/assistant')}
              className="w-full flex items-center justify-between p-4 rounded-lg border bg-gradient-to-r from-primary/10 to-primary/5 hover:from-primary/20 hover:to-primary/10 transition-all"
            >
              <div className="flex items-center gap-3">
                <Brain className="h-5 w-5 text-primary" />
                <div className="text-left">
                  <p className="font-medium">Ask AI for detailed analysis</p>
                  <p className="text-xs text-muted-foreground">Get personalized recommendations</p>
                </div>
              </div>
              <ExternalLink className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
