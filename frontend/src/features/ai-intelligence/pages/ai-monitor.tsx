import { useState, useMemo, useEffect } from 'react';
import { useMonitoring } from '@/features/ai-intelligence/hooks/use-monitoring';
import { useInvestigations } from '@/features/ai-intelligence/hooks/use-investigations';
import { useCorrelatedAnomalies, type CorrelatedAnomaly } from '@/features/observability/hooks/use-correlated-anomalies';
import { useContainers } from '@/features/containers/hooks/use-containers';
import { FleetHealthSummary, calculateHealthStats } from '@/features/ai-intelligence/components/fleet-health-summary';
import { IncidentGroupsView } from '@/features/ai-intelligence/components/incident-groups-view';
import { InsightCard } from '@/features/ai-intelligence/components/insight-card';
import type { Severity } from '@/features/ai-intelligence/components/insight-card';
import { useForceRefresh } from '@/shared/hooks/use-force-refresh';
import { useAutoRefresh } from '@/shared/hooks/use-auto-refresh';
import { RefreshButton } from '@/shared/components/ui/refresh-button';
import { AutoRefreshToggle } from '@/shared/components/ui/auto-refresh-toggle';
import { SkeletonCard } from '@/shared/components/feedback/loading-skeleton';
import { SpotlightCard } from '@/shared/components/data-display/spotlight-card';
import { cn } from '@/shared/lib/utils';
import {
  AlertTriangle,
  Info,
  AlertCircle,
  Activity,
  Box,
  Filter,
  Search,
  XCircle,
  Clock,
  Brain,
  Layers,
  Zap,
  Bell,
  BellOff,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';

function CorrelatedAnomalyCard({ anomaly }: { anomaly: CorrelatedAnomaly }) {
  const patternDescription = anomaly.pattern?.includes(':')
    ? anomaly.pattern.split(':').slice(1).join(':').trim()
    : null;

  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-4 transition-all',
        anomaly.severity === 'critical' && 'border-red-500/40 bg-red-50/30 dark:bg-red-900/10',
        anomaly.severity === 'high' && 'border-orange-500/40 bg-orange-50/30 dark:bg-orange-900/10',
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Box className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <span className="font-mono text-sm font-medium truncate">{anomaly.containerName}</span>
        </div>
        <span className="text-lg font-bold tabular-nums flex-shrink-0" title="Composite score">
          {anomaly.compositeScore.toFixed(2)}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-3">
        <CorrelationSeverityBadge severity={anomaly.severity} />
        {anomaly.pattern && <PatternBadge pattern={anomaly.pattern} />}
      </div>

      {/* Per-metric z-score bars */}
      <div className="space-y-1.5" data-testid="zscore-bars">
        {anomaly.metrics.map((m) => {
          const absZ = Math.abs(m.zScore);
          const widthPct = Math.min((absZ / 5) * 100, 100);
          const barColor = absZ >= 3 ? 'bg-red-500' : absZ >= 2 ? 'bg-amber-500' : 'bg-blue-500';

          return (
            <div key={m.type} className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-20 truncate font-mono">{m.type}</span>
              <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all', barColor)}
                  style={{ width: `${widthPct}%` }}
                />
              </div>
              <span className="text-xs tabular-nums text-muted-foreground w-10 text-right">
                {m.zScore.toFixed(1)}
              </span>
            </div>
          );
        })}
      </div>

      {patternDescription && (
        <p className="mt-2 text-xs text-muted-foreground">{patternDescription}</p>
      )}
    </div>
  );
}

function HealthIssueCard({ container }: { container: { id: string; name: string; image: string; state: string; healthStatus?: string; endpointId: number } }) {
  const isUnhealthy = container.healthStatus === 'unhealthy';
  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-4 transition-all',
        isUnhealthy
          ? 'border-red-500/40 bg-red-50/30 dark:bg-red-900/10'
          : 'border-orange-500/40 bg-orange-50/30 dark:bg-orange-900/10',
      )}
      data-testid="health-issue-card"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <Link
          to={`/containers/${container.endpointId}/${container.id}`}
          className="flex items-center gap-2 min-w-0 hover:text-foreground transition-colors"
          title={`Open ${container.name}`}
        >
          <Box className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <span className="font-mono text-sm font-medium truncate">{container.name}</span>
        </Link>
        {isUnhealthy ? (
          <XCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
        ) : (
          <AlertCircle className="h-5 w-5 text-orange-500 flex-shrink-0" />
        )}
      </div>
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className={cn(
          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
          isUnhealthy
            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
            : 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
        )}>
          {isUnhealthy ? 'Unhealthy' : 'Stopped'}
        </span>
      </div>
      <p className="text-xs text-muted-foreground font-mono truncate" title={container.image}>
        {container.image}
      </p>
    </div>
  );
}

function CorrelationTypeBadge({ type }: { type: string }) {
  const config: Record<string, { icon: typeof Clock; label: string; className: string }> = {
    temporal: {
      icon: Clock,
      label: 'Temporal',
      className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    },
    cascade: {
      icon: Layers,
      label: 'Cascade',
      className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    },
    dedup: {
      icon: Filter,
      label: 'Dedup',
      className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    },
    semantic: {
      icon: Brain,
      label: 'Semantic',
      className: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
    },
  };

  const entry = config[type] ?? config.temporal;
  const Icon = entry.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
        entry.className,
      )}
    >
      <Icon className="h-3 w-3" />
      {entry.label}
    </span>
  );
}

function ConfidenceBadge({ confidence }: { confidence: 'high' | 'medium' | 'low' }) {
  const config = {
    high: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    low: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  }[confidence];

  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize', config)}>
      {confidence} confidence
    </span>
  );
}

function CorrelationSeverityBadge({ severity }: { severity: 'low' | 'medium' | 'high' | 'critical' }) {
  const config = {
    critical: {
      icon: AlertTriangle,
      label: 'Critical',
      className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    },
    high: {
      icon: AlertCircle,
      label: 'High',
      className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    },
    medium: {
      icon: AlertCircle,
      label: 'Medium',
      className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    },
    low: {
      icon: Info,
      label: 'Low',
      className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    },
  }[severity];

  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
        config.className,
      )}
    >
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  );
}

function PatternBadge({ pattern }: { pattern: string }) {
  const shortLabel = pattern.includes(':') ? pattern.split(':')[0].trim() : pattern;

  const colorMap: Record<string, string> = {
    'Resource Exhaustion': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    'Memory Leak Suspected': 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    'CPU Spike': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  };

  const colorClass = colorMap[shortLabel] ?? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400';

  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium', colorClass)}>
      <Zap className="h-3 w-3" />
      {shortLabel}
    </span>
  );
}

export default function AiMonitorPage() {
  const [severityFilter, setSeverityFilter] = useState<'all' | Severity>('all');
  const [acknowledgementFilter, setAcknowledgementFilter] = useState<'all' | 'unacknowledged'>('all');
  const { interval, setInterval } = useAutoRefresh(30);

  // URL-synced controls so reloads, deep links, and back-navigation preserve
  // the operator's filter context. Trade-off: each control change invalidates
  // a render but the page already re-renders on every refetch so this isn't
  // load-bearing.
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchInput, setSearchInput] = useState(searchParams.get('q') ?? '');
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') ?? '');

  // Debounce search input → query (~150ms) so each keystroke doesn't refilter
  // the full list. URL-sync happens on the debounced value.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchQuery(searchInput);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (searchInput) next.set('q', searchInput);
        else next.delete('q');
        return next;
      }, { replace: true });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [searchInput, setSearchParams]);

  // Sync local input state from URL when the URL changes from outside this
  // component (browser back/forward, deep link). Without this, navigating
  // back to a state with `?q=foo` leaves the input field empty even though
  // the filter is active.
  const urlQuery = searchParams.get('q') ?? '';
  useEffect(() => {
    setSearchInput((current) => (current === urlQuery ? current : urlQuery));
    setSearchQuery((current) => (current === urlQuery ? current : urlQuery));
  }, [urlQuery]);

  const {
    insights,
    isLoading,
    error,
    subscribedSeverities,
    subscribeSeverity,
    unsubscribeSeverity,
    acknowledgeInsight,
    acknowledgeError,
    acknowledgingInsightId,
    refetch,
  } = useMonitoring();

  const { getInvestigationForInsight } = useInvestigations();
  const { data: correlatedAnomalies, isLoading: correlatedLoading } = useCorrelatedAnomalies();

  // Fleet health data
  const { data: containers, isLoading: containersLoading, refetch: containerRefetch, isFetching: containersFetching } = useContainers();
  const { forceRefresh, isForceRefreshing } = useForceRefresh('containers', containerRefetch);

  // Wire the auto-refresh dropdown to actual refetches. The hook only owns
  // the interval state; without this effect, switching the dropdown to "30s"
  // would advertise a behaviour that never happens. We refetch the page's
  // two operator-controlled queries (insights + containers); incidents and
  // correlated anomalies have their own internal refetch cadences set in
  // their respective hooks.
  useEffect(() => {
    if (interval <= 0) return;
    const tick = () => {
      refetch();
      containerRefetch();
    };
    const id = window.setInterval(tick, interval * 1000);
    return () => window.clearInterval(id);
  }, [interval, refetch, containerRefetch]);

  const healthStats = useMemo(() => {
    if (!containers) return null;
    return calculateHealthStats(containers);
  }, [containers]);

  // Containers with a simple health issue (unhealthy or stopped) — surfaced in Correlated Anomalies (AC-4)
  const healthIssues = useMemo(() => {
    if (!containers) return [];
    return containers.filter(
      (c) => c.healthStatus === 'unhealthy' || c.state === 'exited',
    );
  }, [containers]);

  // Lowercased query for case-insensitive substring matching.
  const searchLower = searchQuery.trim().toLowerCase();
  const matchesSearch = (haystack: Array<string | null | undefined>) =>
    !searchLower ||
    haystack.some((s) => typeof s === 'string' && s.toLowerCase().includes(searchLower));

  // Filter insights by severity, acknowledgement, and search query.
  const filteredInsights = useMemo(() => {
    const bySeverity = severityFilter === 'all'
      ? insights
      : insights.filter((i) => i.severity === severityFilter);

    const bySearch = !searchLower
      ? bySeverity
      : bySeverity.filter((i) =>
          matchesSearch([i.title, i.description, i.container_name, i.endpoint_name, i.category]),
        );

    if (acknowledgementFilter === 'unacknowledged') {
      return bySearch.filter((i) => !i.is_acknowledged);
    }

    return bySearch;
  }, [acknowledgementFilter, insights, severityFilter, searchLower]);

  // Apply search to anomalies + health issues so the search box covers every
  // list on the page consistently.
  const filteredCorrelatedAnomalies = useMemo(() => {
    if (!correlatedAnomalies) return correlatedAnomalies;
    if (!searchLower) return correlatedAnomalies;
    return correlatedAnomalies.filter((a) =>
      matchesSearch([a.containerName, a.pattern, ...a.metrics.map((m) => m.type)]),
    );
  }, [correlatedAnomalies, searchLower]);

  const filteredHealthIssues = useMemo(() => {
    if (!searchLower) return healthIssues;
    return healthIssues.filter((c) => matchesSearch([c.name, c.image, c.healthStatus]));
  }, [healthIssues, searchLower]);

  // Stats
  const stats = useMemo(() => {
    const result = { total: 0, critical: 0, warning: 0, info: 0 };
    for (const i of insights) {
      result.total++;
      if (i.severity === 'critical') result.critical++;
      else if (i.severity === 'warning') result.warning++;
      else if (i.severity === 'info') result.info++;
    }
    return result;
  }, [insights]);

  const handleSeverityFilter = (severity: Severity) => {
    // Stat-card body click filters the list (or clears filter if already
    // active). Live-alert subscription is a separate control on each card.
    setSeverityFilter((current) => (current === severity ? 'all' : severity));
  };

  const handleSubscriptionToggle = (severity: Severity) => {
    if (subscribedSeverities.has(severity)) {
      unsubscribeSeverity(severity);
    } else {
      subscribeSeverity(severity);
    }
  };

  // Error state
  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Health & Monitoring</h1>
          <p className="text-muted-foreground">
            Fleet health analysis and real-time AI-powered insights
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
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Health & Monitoring</h1>
          <p className="text-muted-foreground">
            Fleet health analysis and real-time AI-powered insights
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoRefreshToggle interval={interval} onIntervalChange={setInterval} />
          <RefreshButton
            onClick={() => { refetch(); containerRefetch(); }}
            onForceRefresh={forceRefresh}
            isLoading={containersFetching || isForceRefreshing}
          />
        </div>
      </div>

      {/* Fleet Health Summary */}
      <SpotlightCard>
        <FleetHealthSummary
          stats={healthStats}
          isLoading={containersLoading}
        />
      </SpotlightCard>

      {/* Insights Filter Cards — click body to filter, bell icon toggles live alerts.
          Slimmer than before so the page hero (Fleet Vitals) keeps dominance. */}
      <SpotlightCard className="p-1">
      <div className="grid gap-3 md:grid-cols-4">
        <button
          type="button"
          onClick={() => setSeverityFilter('all')}
          aria-pressed={severityFilter === 'all'}
          className={cn(
            'rounded-lg border bg-card px-4 py-3 text-left transition-all',
            severityFilter === 'all' ? 'ring-2 ring-primary/40' : 'hover:bg-muted/30',
          )}
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total Insights</p>
            <Activity className="h-4 w-4 text-primary" />
          </div>
          <p className="mt-1 text-2xl font-bold tabular-nums">{stats.total}</p>
        </button>
        {([
          { severity: 'critical' as const, label: 'Critical', icon: AlertTriangle, count: stats.critical,
            tint: 'bg-red-50 dark:bg-red-900/20',
            text: 'text-red-800 dark:text-red-200', iconColor: 'text-red-600 dark:text-red-400',
            countColor: 'text-red-900 dark:text-red-100', ring: 'ring-red-500/40' },
          { severity: 'warning' as const, label: 'Warnings', icon: AlertCircle, count: stats.warning,
            tint: 'bg-amber-50 dark:bg-amber-900/20',
            text: 'text-amber-800 dark:text-amber-200', iconColor: 'text-amber-600 dark:text-amber-400',
            countColor: 'text-amber-900 dark:text-amber-100', ring: 'ring-amber-500/40' },
          { severity: 'info' as const, label: 'Info', icon: Info, count: stats.info,
            tint: 'bg-blue-50 dark:bg-blue-900/20',
            text: 'text-blue-800 dark:text-blue-200', iconColor: 'text-blue-600 dark:text-blue-400',
            countColor: 'text-blue-900 dark:text-blue-100', ring: 'ring-blue-500/40' },
        ]).map((card) => {
          const isSubscribed = subscribedSeverities.has(card.severity);
          const isFiltered = severityFilter === card.severity;
          const Icon = card.icon;
          return (
            <div
              key={card.severity}
              className={cn(
                'relative rounded-lg border px-4 py-3 transition-all',
                card.tint,
                isFiltered && `ring-2 ${card.ring}`,
              )}
            >
              <button
                type="button"
                onClick={() => handleSeverityFilter(card.severity)}
                aria-pressed={isFiltered}
                title={isFiltered ? 'Click to clear filter' : `Filter list to ${card.label.toLowerCase()}`}
                className="block w-full text-left"
              >
                <div className="flex items-center justify-between pr-9">
                  <p className={cn('text-xs font-medium uppercase tracking-wide', card.text)}>{card.label}</p>
                  <Icon className={cn('h-4 w-4', card.iconColor)} />
                </div>
                <p className={cn('mt-1 text-2xl font-bold tabular-nums', card.countColor)}>
                  {card.count}
                </p>
              </button>
              {/* Live-alert subscription toggle — separate sibling target.
                  No stopPropagation needed because this button is a sibling
                  of the card-body button (not nested inside it). 32×32 hit
                  area: above WCAG 2.5.5 AA (24×24) and well above the
                  practical comfort zone for pointer + touch input. */}
              <button
                type="button"
                onClick={() => handleSubscriptionToggle(card.severity)}
                aria-pressed={isSubscribed}
                title={isSubscribed ? `Pause live ${card.label.toLowerCase()} alerts` : `Resume live ${card.label.toLowerCase()} alerts`}
                className={cn(
                  'absolute right-1.5 top-1.5 inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors',
                  isSubscribed
                    ? 'bg-card text-muted-foreground hover:bg-muted'
                    : 'bg-muted text-muted-foreground/60 hover:bg-muted/80',
                )}
              >
                {isSubscribed ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
                <span className="sr-only">
                  {isSubscribed ? 'Pause' : 'Resume'} live {card.label.toLowerCase()} alerts
                </span>
              </button>
            </div>
          );
        })}
      </div>
      </SpotlightCard>

      {/* Severity Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2 overflow-x-auto rounded-lg border bg-card p-1">
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
        <div className="mx-1 hidden h-6 w-px bg-border sm:block" />
        <button
          onClick={() => setAcknowledgementFilter('all')}
          className={cn(
            'rounded-md px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap',
            acknowledgementFilter === 'all'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          All Statuses
        </button>
        <button
          onClick={() => setAcknowledgementFilter('unacknowledged')}
          className={cn(
            'rounded-md px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap',
            acknowledgementFilter === 'unacknowledged'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          Unacknowledged
        </button>
      </div>

      {/* Search box — covers incidents, anomalies, health issues, insights */}
      <SpotlightCard>
        <div className="rounded-lg border bg-card p-3 shadow-sm">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by container, image, title, or endpoint…"
              aria-label="Search incidents and insights"
              className="h-10 w-full rounded-md border border-input bg-background pl-10 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted"
              >
                <XCircle className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </SpotlightCard>

      {/* ML-Detected Anomalies */}
      {(correlatedLoading || (filteredCorrelatedAnomalies && filteredCorrelatedAnomalies.length > 0)) && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            <h2 className="text-lg font-semibold">
              ML-Detected Anomalies
              {!correlatedLoading && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({filteredCorrelatedAnomalies?.length ?? 0})
                </span>
              )}
            </h2>
          </div>
          {correlatedLoading ? (
            <div className="grid gap-4 md:grid-cols-2">
              <SkeletonCard className="h-[180px]" />
              <SkeletonCard className="h-[180px]" />
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {(filteredCorrelatedAnomalies ?? []).map((anomaly) => (
                <CorrelatedAnomalyCard key={anomaly.containerId} anomaly={anomaly} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Container Health (state-based: unhealthy / stopped) */}
      {filteredHealthIssues.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-orange-600 dark:text-orange-400" />
            <h2 className="text-lg font-semibold">
              Container Health
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({filteredHealthIssues.length})
              </span>
            </h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {filteredHealthIssues.map((container) => (
              <HealthIssueCard key={container.id} container={container} />
            ))}
          </div>
        </div>
      )}

      {/* Active Incidents (rollup view) */}
      <SpotlightCard>
        <IncidentGroupsView search={searchInput} />
      </SpotlightCard>

      {/* Insights Feed */}
      <SpotlightCard>
        {isLoading ? (
          <SkeletonCard className="h-[400px]" />
        ) : filteredInsights.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/20 p-12 text-center">
            <Activity className="mx-auto h-12 w-12 text-muted-foreground" />
            <h3 className="mt-4 text-lg font-semibold">No insights</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {acknowledgementFilter === 'unacknowledged'
                ? 'No unacknowledged insights match the current filters.'
                : severityFilter === 'all'
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
              <InsightCard
                key={insight.id}
                insight={insight}
                investigation={getInvestigationForInsight(insight.id)}
                onAcknowledge={acknowledgeInsight}
                isAcknowledging={acknowledgingInsightId === insight.id}
                acknowledgeErrorMessage={acknowledgeError instanceof Error ? acknowledgeError.message : undefined}
              />
            ))}
          </div>
        )}
      </SpotlightCard>
    </div>
  );
}
