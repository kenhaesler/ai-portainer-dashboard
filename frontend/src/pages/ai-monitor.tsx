import { useState, useMemo } from 'react';
import { useMonitoring } from '@/hooks/use-monitoring';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import { RefreshButton } from '@/components/shared/refresh-button';
import { AutoRefreshToggle } from '@/components/shared/auto-refresh-toggle';
import { SkeletonCard } from '@/components/shared/loading-skeleton';
import { cn, formatDate } from '@/lib/utils';
import {
  AlertTriangle,
  Info,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Activity,
  Shield,
  Sparkles,
  Server,
  Box,
  Filter,
} from 'lucide-react';

type Severity = 'critical' | 'warning' | 'info';

interface InsightCardProps {
  insight: {
    id: string;
    endpoint_id: number | null;
    endpoint_name: string | null;
    container_id: string | null;
    container_name: string | null;
    severity: Severity;
    category: string;
    title: string;
    description: string;
    suggested_action: string | null;
    is_acknowledged: number;
    created_at: string;
  };
}

function SeverityBadge({ severity }: { severity: Severity }) {
  const config = {
    critical: {
      icon: AlertTriangle,
      label: 'Critical',
      className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    },
    warning: {
      icon: AlertCircle,
      label: 'Warning',
      className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    },
    info: {
      icon: Info,
      label: 'Info',
      className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    },
  }[severity];

  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
        config.className
      )}
    >
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  );
}

function InsightCard({ insight }: InsightCardProps) {
  const [expanded, setExpanded] = useState(false);

  const categoryIcon = {
    security: Shield,
    anomaly: Activity,
    'ai-analysis': Sparkles,
  }[insight.category.split(':')[0]] || Server;

  const CategoryIcon = categoryIcon;

  return (
    <div
      className={cn(
        'rounded-lg border bg-card transition-all',
        expanded && 'ring-2 ring-primary/20'
      )}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 text-left transition-colors hover:bg-muted/30"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="mt-0.5 rounded-full bg-muted p-2">
              <CategoryIcon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <SeverityBadge severity={insight.severity} />
                <span className="text-xs text-muted-foreground">
                  {formatDate(insight.created_at)}
                </span>
              </div>
              <h3 className="font-semibold text-base leading-snug mb-1">
                {insight.title}
              </h3>
              {!expanded && (
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {insight.description}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {insight.container_name && (
              <div className="hidden sm:flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs">
                <Box className="h-3 w-3 text-muted-foreground" />
                <span className="font-mono">{insight.container_name}</span>
              </div>
            )}
            {expanded ? (
              <ChevronDown className="h-5 w-5 text-muted-foreground flex-shrink-0" />
            ) : (
              <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
            )}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t px-4 py-4 bg-muted/10">
          <div className="space-y-3">
            <div>
              <h4 className="text-sm font-medium mb-1">Description</h4>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {insight.description}
              </p>
            </div>

            {insight.suggested_action && (
              <div>
                <h4 className="text-sm font-medium mb-2">Suggested Action</h4>
                <div className="rounded-md bg-blue-50 dark:bg-blue-900/20 p-3">
                  <p className="text-sm text-blue-900 dark:text-blue-100">
                    {insight.suggested_action}
                  </p>
                </div>
              </div>
            )}

            {(insight.endpoint_name || insight.container_name) && (
              <div>
                <h4 className="text-sm font-medium mb-2">Resource Details</h4>
                <div className="rounded-md bg-muted p-3 space-y-1">
                  {insight.endpoint_name && (
                    <div className="flex gap-2 text-xs">
                      <span className="text-muted-foreground font-medium min-w-[120px]">
                        Endpoint:
                      </span>
                      <span className="font-mono">{insight.endpoint_name}</span>
                    </div>
                  )}
                  {insight.container_name && (
                    <div className="flex gap-2 text-xs">
                      <span className="text-muted-foreground font-medium min-w-[120px]">
                        Container:
                      </span>
                      <span className="font-mono">{insight.container_name}</span>
                    </div>
                  )}
                  {insight.container_id && (
                    <div className="flex gap-2 text-xs">
                      <span className="text-muted-foreground font-medium min-w-[120px]">
                        Container ID:
                      </span>
                      <span className="font-mono">{insight.container_id.slice(0, 12)}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t text-xs text-muted-foreground">
              <div className="flex items-center gap-4">
                <span>Category: {insight.category}</span>
                <span>ID: {insight.id.slice(0, 8)}</span>
              </div>
              <span className={insight.is_acknowledged ? 'text-emerald-600' : ''}>
                {insight.is_acknowledged ? 'Acknowledged' : 'Unacknowledged'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AiMonitorPage() {
  const [severityFilter, setSeverityFilter] = useState<'all' | Severity>('all');
  const { interval, setInterval } = useAutoRefresh(30);

  const {
    insights,
    isLoading,
    error,
    subscribedSeverities,
    subscribeSeverity,
    unsubscribeSeverity,
    refetch,
  } = useMonitoring();

  // Filter insights by severity
  const filteredInsights = useMemo(() => {
    if (severityFilter === 'all') return insights;
    return insights.filter((i) => i.severity === severityFilter);
  }, [insights, severityFilter]);

  // Stats
  const stats = useMemo(() => ({
    total: insights.length,
    critical: insights.filter((i) => i.severity === 'critical').length,
    warning: insights.filter((i) => i.severity === 'warning').length,
    info: insights.filter((i) => i.severity === 'info').length,
  }), [insights]);

  const handleSeverityToggle = (severity: Severity) => {
    if (subscribedSeverities.has(severity)) {
      unsubscribeSeverity(severity);
      // If we're filtering by this severity and we unsubscribe, reset to 'all'
      if (severityFilter === severity) {
        setSeverityFilter('all');
      }
    } else {
      subscribeSeverity(severity);
    }
  };

  // Error state
  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">AI Monitor</h1>
          <p className="text-muted-foreground">
            Real-time AI-powered infrastructure insights
          </p>
        </div>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
          <p className="mt-4 font-medium text-destructive">Failed to load insights</p>
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">AI Monitor</h1>
          <p className="text-muted-foreground">
            Real-time AI-powered infrastructure insights
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoRefreshToggle interval={interval} onIntervalChange={setInterval} />
          <RefreshButton onClick={() => refetch()} />
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">Total Insights</p>
            <Activity className="h-5 w-5 text-primary" />
          </div>
          <p className="mt-2 text-3xl font-bold">{stats.total}</p>
        </div>
        <div
          className={cn(
            'rounded-lg border p-4 cursor-pointer transition-all',
            subscribedSeverities.has('critical')
              ? 'bg-red-50 dark:bg-red-900/20 ring-2 ring-red-500/20'
              : 'bg-card opacity-60'
          )}
          onClick={() => handleSeverityToggle('critical')}
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-red-800 dark:text-red-200">Critical</p>
            <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
          </div>
          <p className="mt-2 text-3xl font-bold text-red-900 dark:text-red-100">
            {stats.critical}
          </p>
        </div>
        <div
          className={cn(
            'rounded-lg border p-4 cursor-pointer transition-all',
            subscribedSeverities.has('warning')
              ? 'bg-amber-50 dark:bg-amber-900/20 ring-2 ring-amber-500/20'
              : 'bg-card opacity-60'
          )}
          onClick={() => handleSeverityToggle('warning')}
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Warnings</p>
            <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>
          <p className="mt-2 text-3xl font-bold text-amber-900 dark:text-amber-100">
            {stats.warning}
          </p>
        </div>
        <div
          className={cn(
            'rounded-lg border p-4 cursor-pointer transition-all',
            subscribedSeverities.has('info')
              ? 'bg-blue-50 dark:bg-blue-900/20 ring-2 ring-blue-500/20'
              : 'bg-card opacity-60'
          )}
          onClick={() => handleSeverityToggle('info')}
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-blue-800 dark:text-blue-200">Info</p>
            <Info className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <p className="mt-2 text-3xl font-bold text-blue-900 dark:text-blue-100">
            {stats.info}
          </p>
        </div>
      </div>

      {/* Severity Filter Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto rounded-lg border bg-card p-1">
        <button
          onClick={() => setSeverityFilter('all')}
          className={cn(
            'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap',
            severityFilter === 'all'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          <Filter className="h-4 w-4" />
          All
          <span
            className={cn(
              'rounded-full px-1.5 py-0.5 text-xs',
              severityFilter === 'all'
                ? 'bg-primary-foreground/20'
                : 'bg-muted-foreground/20'
            )}
          >
            {stats.total}
          </span>
        </button>
        {(['critical', 'warning', 'info'] as const).map((severity) => {
          const config = {
            critical: { icon: AlertTriangle, label: 'Critical', count: stats.critical },
            warning: { icon: AlertCircle, label: 'Warnings', count: stats.warning },
            info: { icon: Info, label: 'Info', count: stats.info },
          }[severity];

          const Icon = config.icon;

          return (
            <button
              key={severity}
              onClick={() => setSeverityFilter(severity)}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap',
                severityFilter === severity
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <Icon className="h-4 w-4" />
              {config.label}
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-xs',
                  severityFilter === severity
                    ? 'bg-primary-foreground/20'
                    : 'bg-muted-foreground/20'
                )}
              >
                {config.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Insights Feed */}
      {isLoading ? (
        <SkeletonCard className="h-[400px]" />
      ) : filteredInsights.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/20 p-12 text-center">
          <Activity className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold">No insights</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {severityFilter === 'all'
              ? 'AI monitoring has not generated any insights yet. Check back soon.'
              : `No ${severityFilter} insights found. Try a different filter.`}
          </p>
          {!subscribedSeverities.has(severityFilter as Severity) && severityFilter !== 'all' && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
              You are not subscribed to {severityFilter} severity. Click the stat card above to subscribe.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredInsights.map((insight) => (
            <InsightCard key={insight.id} insight={insight} />
          ))}
        </div>
      )}
    </div>
  );
}
