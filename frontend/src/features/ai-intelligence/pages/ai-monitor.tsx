import { useState, useMemo, useEffect, useCallback } from 'react';
import { PageHeader } from '@/shared/components/layout/page-header';
import { useMonitoring } from '@/features/ai-intelligence/hooks/use-monitoring';
import { useInvestigations, type Investigation } from '@/features/ai-intelligence/hooks/use-investigations';
import {
  useCorrelatedAnomalies,
  type CorrelatedAnomaly,
  type MetricPatternMatch,
} from '@/features/observability/hooks/use-correlated-anomalies';
import {
  useMarkFalsePositive,
  useAnomalyFeedbackRates,
  deriveCorrelatedAnomalyId,
} from '@/features/ai-intelligence/hooks/use-anomaly-feedback';
import { useContainers } from '@/features/containers/hooks/use-containers';
import { FleetHealthSummary, calculateHealthStats } from '@/features/ai-intelligence/components/fleet-health-summary';
import { IncidentGroupsView } from '@/features/ai-intelligence/components/incident-groups-view';
import { InsightCard, SeverityBadge, ZScoreBar } from '@/features/ai-intelligence/components/insight-card';
import { SensitivityControl } from '@/features/ai-intelligence/components/sensitivity-control';
import type { Severity } from '@/features/ai-intelligence/components/insight-card';
import { useForceRefresh } from '@/shared/hooks/use-force-refresh';
import { useAutoRefresh } from '@/shared/hooks/use-auto-refresh';
import { RefreshControls } from '@/shared/components/ui/refresh-controls';
import { EmptyState } from '@/shared/components/feedback/empty-state';
import { SkeletonChart, SkeletonList } from '@/shared/components/feedback/skeleton';
import { SpotlightCard } from '@/shared/components/data-display/spotlight-card';
import { cn, formatDate } from '@/shared/lib/utils';
import {
  AlertTriangle,
  Info,
  AlertCircle,
  Activity,
  Box,
  Filter,
  Search,
  XCircle,
  Sigma,
  ThumbsDown,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';

/**
 * Map the correlated-anomaly ladder onto the product's insight severity
 * vocabulary.
 *
 * This screen used to speak two severity languages at once: these cards said
 * Critical / High / Medium / Low while the filter chips, the KPI tiles and the
 * insight feed said Critical / Warning / Info — with no way to tell whether a
 * card's "High" outranked the feed's "Warning". Nothing is lost collapsing
 * high and medium into Warning: both already rendered in the same
 * orange-on-cream badge, and the finer ordering is carried numerically by the
 * composite score printed on the same card.
 */
export function correlationSeverityToInsightSeverity(
  severity: 'low' | 'medium' | 'high' | 'critical',
): Severity {
  if (severity === 'critical') return 'critical';
  if (severity === 'high' || severity === 'medium') return 'warning';
  return 'info';
}

function CorrelatedAnomalyCard({
  anomaly,
  onMarkFalsePositive,
  isPending,
}: {
  anomaly: CorrelatedAnomaly;
  onMarkFalsePositive: (anomaly: CorrelatedAnomaly) => void;
  isPending: boolean;
}) {
  // `patternMatch.summary` restates the rule that fired and the z-scores it
  // fired on. It replaced a hardcoded sentence per rule branch, which rendered
  // byte-identically on every card hitting the same branch and read as a
  // diagnosis nothing had made. `pattern` is kept as a fallback so a stale
  // server build degrades to the old string rather than to a blank card.
  const ruleSummary = anomaly.patternMatch?.summary ?? anomaly.pattern ?? null;

  return (
    <SpotlightCard className="h-full">
      <div
        className="h-full rounded-lg border bg-card p-6 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 hover:border-primary/20"
        data-testid="correlated-anomaly-card"
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
          <SeverityBadge severity={correlationSeverityToInsightSeverity(anomaly.severity)} />
          {anomaly.patternMatch && <PatternBadge patternMatch={anomaly.patternMatch} />}
        </div>

        {/* Per-metric z-score bars, signed from a centre line. */}
        <div className="space-y-1.5" data-testid="zscore-bars">
          {anomaly.metrics.map((m) => (
            <ZScoreBar key={m.type} label={m.type} zScore={m.zScore} />
          ))}
        </div>

        {ruleSummary && (
          <p className="mt-2 text-xs text-muted-foreground" data-testid="pattern-rule-summary">
            {ruleSummary}
          </p>
        )}

        {/* False-positive feedback affordance (#1298). Optimistic dismissal
            is owned by the parent so multiple cards don't fight over the
            same set. We disable the button while the mutation is in flight
            so a rapid double-click doesn't trigger two requests. */}
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => onMarkFalsePositive(anomaly)}
            disabled={isPending}
            aria-label={`Mark anomaly for ${anomaly.containerName} as false positive`}
            data-testid="mark-false-positive"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors',
              'hover:bg-muted hover:text-foreground',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            <ThumbsDown className="h-3 w-3" />
            Mark as false positive
          </button>
        </div>
      </div>
    </SpotlightCard>
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

/**
 * Which deviation rule fired, as a neutral classificatory chip.
 *
 * Deliberately uncoloured. The `SeverityBadge` beside it already
 * encodes urgency from the composite score; colouring this one too would put
 * two competing severity signals on one row for the same anomaly. It is also
 * deliberately not purple — DESIGN.md reserves purple for AI insight, and this
 * chip reports a deterministic z-score threshold rule, not an inference. The
 * previous version keyed its colours off English pattern names and fell back to
 * purple whenever it did not recognise one, which is what made every unmatched
 * rule look like an AI finding.
 */
function PatternBadge({ patternMatch }: { patternMatch: MetricPatternMatch }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
      title={`Rule: metrics with z-score above ${patternMatch.zScoreThreshold}`}
      data-testid="pattern-badge"
      data-pattern-id={patternMatch.id}
    >
      {patternMatch.label}
    </span>
  );
}

type FeedInsight = React.ComponentProps<typeof InsightCard>['insight'];

/**
 * Group consecutive re-emissions of the same fact for the same container.
 *
 * Twelve of twenty "Info" insights on a real fleet were two facts restated
 * hourly — `Container "lcm-web" has no health check configured` at 03:40,
 * 04:43, 05:47, … each carrying the same 40-word remediation paragraph. A
 * missing HEALTHCHECK is a configuration state, not an event.
 *
 * Deliberately a display-time grouping and not a filter: every occurrence is
 * still in the feed behind a disclosure, so acknowledging stays per-insight and
 * the "20 Info" tile still reconciles against what is on screen (the group
 * header prints its own occurrence count).
 */
export function groupRepeatedInsights<T extends FeedInsight>(insights: T[]): T[][] {
  const byKey = new Map<string, T[]>();
  const order: string[] = [];
  for (const insight of insights) {
    const key = `${insight.severity}|${insight.container_id ?? ''}|${insight.title}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.push(insight);
    } else {
      byKey.set(key, [insight]);
      order.push(key);
    }
  }
  return order.map((key) => byKey.get(key)!);
}

function RepeatedInsightGroup({
  insights,
  getInvestigationForInsight,
  onAcknowledge,
  acknowledgingInsightId,
  acknowledgeErrorMessage,
}: {
  insights: FeedInsight[];
  getInvestigationForInsight: (id: string) => Investigation | undefined;
  onAcknowledge: (insightId: string) => void;
  acknowledgingInsightId: string | null;
  acknowledgeErrorMessage?: string;
}) {
  const [showEarlier, setShowEarlier] = useState(false);
  const [latest, ...earlier] = insights;
  const oldest = insights[insights.length - 1];

  return (
    <div className="space-y-2" data-testid="insight-group">
      <InsightCard
        insight={latest}
        investigation={getInvestigationForInsight(latest.id)}
        onAcknowledge={onAcknowledge}
        isAcknowledging={acknowledgingInsightId === latest.id}
        acknowledgeErrorMessage={acknowledgeErrorMessage}
      />
      {earlier.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowEarlier((v) => !v)}
            aria-expanded={showEarlier}
            data-testid="insight-group-toggle"
            className="ml-4 text-xs text-muted-foreground underline decoration-dotted hover:text-foreground"
          >
            {showEarlier ? 'Hide' : 'Show'} {earlier.length} earlier occurrence
            {earlier.length === 1 ? '' : 's'} · first seen {formatDate(oldest.created_at)}
          </button>
          {showEarlier && (
            <div className="ml-4 space-y-2 border-l pl-3">
              {earlier.map((insight) => (
                <InsightCard
                  key={insight.id}
                  insight={insight}
                  investigation={getInvestigationForInsight(insight.id)}
                  onAcknowledge={onAcknowledge}
                  isAcknowledging={acknowledgingInsightId === insight.id}
                  acknowledgeErrorMessage={acknowledgeErrorMessage}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const PAGE_TITLE = 'Health & Monitoring';

export default function AiMonitorPage() {
  const [severityFilter, setSeverityFilter] = useState<'all' | Severity>('all');
  const [acknowledgementFilter, setAcknowledgementFilter] = useState<'all' | 'unacknowledged'>('all');

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
    acknowledgeInsight,
    acknowledgeError,
    acknowledgingInsightId,
    refetch,
  } = useMonitoring();

  const { getInvestigationForInsight } = useInvestigations();
  const { data: correlatedAnomalies, isLoading: correlatedLoading } = useCorrelatedAnomalies();

  // ── False-positive feedback (#1298) ────────────────────────────
  // Locally dismissed anomaly IDs are kept in component state. The
  // optimistic update hides the card immediately; if the network
  // request fails we revert the dismissal via the hook's
  // onRevertDismiss callback. We don't persist this set to URL or
  // localStorage — dismissals are remembered server-side as soon as
  // the mutation succeeds, and refetching the correlated-anomalies
  // query will exclude the marked anomaly via the rate badge.
  const [dismissedAnomalyIds, setDismissedAnomalyIds] = useState<Set<string>>(new Set());

  const markFalsePositive = useMarkFalsePositive({
    onOptimisticDismiss: (anomalyId) => {
      setDismissedAnomalyIds((prev) => {
        const next = new Set(prev);
        next.add(anomalyId);
        return next;
      });
    },
    onRevertDismiss: (anomalyId) => {
      setDismissedAnomalyIds((prev) => {
        const next = new Set(prev);
        next.delete(anomalyId);
        return next;
      });
    },
  });

  // Per-detector false-positive rate, rendered as a badge row in the
  // Health & Monitoring header. Defaults to caller scope; admins
  // automatically receive fleet-wide data from the backend.
  const { data: feedbackRates } = useAnomalyFeedbackRates();

  const handleMarkFalsePositive = useCallback(
    (anomaly: CorrelatedAnomaly) => {
      // Correlated anomalies have no persisted id — derive a stable
      // one from (containerId, timestamp). The detector tag is
      // 'correlated-zscore' to match how the service surfaces them
      // (multivariate composite of per-metric z-scores).
      const anomalyId = deriveCorrelatedAnomalyId({
        containerId: anomaly.containerId,
        timestamp: anomaly.timestamp,
      });
      markFalsePositive.mutate({ anomalyId, detector: 'correlated-zscore' });
    },
    [markFalsePositive],
  );

  // Fleet health data
  const { data: containers, isLoading: containersLoading, refetch: containerRefetch, isFetching: containersFetching } = useContainers();
  const { forceRefresh, isForceRefreshing } = useForceRefresh('containers', containerRefetch);

  // The hook owns the timer now, so this is one argument instead of a
  // hand-rolled `window.setInterval` effect per page. We refetch the page's
  // two operator-controlled queries (insights + containers); incidents and
  // correlated anomalies have their own internal refetch cadences set in
  // their respective hooks.
  const handleTick = useCallback(() => {
    refetch();
    containerRefetch();
  }, [refetch, containerRefetch]);
  const { interval, setRefreshInterval } = useAutoRefresh(30, { onTick: handleTick });

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
  // list on the page consistently. Dismissed anomalies are hidden via the
  // optimistic-update set; we filter them here so all downstream renders
  // (count, grid) agree.
  const filteredCorrelatedAnomalies = useMemo(() => {
    if (!correlatedAnomalies) return correlatedAnomalies;
    const visible = correlatedAnomalies.filter((a) => {
      const id = deriveCorrelatedAnomalyId({
        containerId: a.containerId,
        timestamp: a.timestamp,
      });
      return !dismissedAnomalyIds.has(id);
    });
    if (!searchLower) return visible;
    return visible.filter((a) =>
      matchesSearch([a.containerName, a.pattern, ...a.metrics.map((m) => m.type)]),
    );
  }, [correlatedAnomalies, searchLower, dismissedAnomalyIds]);

  const filteredHealthIssues = useMemo(() => {
    if (!searchLower) return healthIssues;
    return healthIssues.filter((c) => matchesSearch([c.name, c.image, c.healthStatus]));
  }, [healthIssues, searchLower]);

  // Stats. The unacknowledged critical/warning split feeds the hero's
  // "Needs attention" count — the number an operator still has to act on,
  // which is not the same as the total the tiles show.
  const stats = useMemo(() => {
    const result = {
      total: 0,
      critical: 0,
      warning: 0,
      info: 0,
      unacknowledgedCritical: 0,
      unacknowledgedWarning: 0,
    };
    for (const i of insights) {
      result.total++;
      if (i.severity === 'critical') {
        result.critical++;
        if (!i.is_acknowledged) result.unacknowledgedCritical++;
      } else if (i.severity === 'warning') {
        result.warning++;
        if (!i.is_acknowledged) result.unacknowledgedWarning++;
      } else if (i.severity === 'info') {
        result.info++;
      }
    }
    return result;
  }, [insights]);

  const repeatedInsightGroups = useMemo(
    () => groupRepeatedInsights(filteredInsights),
    [filteredInsights],
  );

  // Live state, not a restatement of the title. The old subtitle promised
  // "real-time AI-powered insights" over a feed whose largest population is a
  // deterministic missing-healthcheck check.
  const subtitle = `${stats.total} insight${stats.total === 1 ? '' : 's'} · ` +
    `${stats.unacknowledgedCritical + stats.unacknowledgedWarning} unacknowledged`;

  // Error state
  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title={PAGE_TITLE} />
        <EmptyState
          variant="error"
          icon={AlertTriangle}
          title="Failed to load insights"
          description={error instanceof Error ? error.message : 'An unexpected error occurred'}
        />
        <button
          onClick={() => refetch()}
          className="mt-4 inline-flex items-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        title={PAGE_TITLE}
        subtitle={subtitle}
        actions={
          <RefreshControls
            interval={interval}
            onIntervalChange={setRefreshInterval}
            onRefresh={() => { refetch(); containerRefetch(); }}
            onForceRefresh={forceRefresh}
            isLoading={containersFetching || isForceRefreshing}
          />
        }
      />

      {/* Per-detector false-positive rate badges (#1298). Rendered in
          the Health & Monitoring header (location decision: header
          rather than Settings — operators making feedback decisions
          benefit from seeing the rate next to the anomalies they're
          rating, not buried in a settings panel they rarely open).
          Hidden when no detectors have data yet so we don't render an
          empty row of placeholders. */}
      {feedbackRates && feedbackRates.rates.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-2"
          data-testid="anomaly-feedback-rate-row"
          aria-label={`Per-detector false-positive rates (${feedbackRates.scope === 'fleet' ? 'fleet-wide' : 'your feedback only'})`}
        >
          <span className="text-xs text-muted-foreground">
            False-positive rate ({feedbackRates.scope === 'fleet' ? 'fleet' : 'mine'}):
          </span>
          {feedbackRates.rates.map((r) => {
            // Empty state ("no feedback yet") collapses to "—" so the
            // badge is still visible but doesn't imply 0% confidence.
            const noData = r.anomalies === 0;
            const pct = noData ? null : Math.round(r.rate * 100);
            const tone =
              noData
                ? 'bg-muted text-muted-foreground'
                : r.rate >= 0.5
                  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                  : r.rate >= 0.2
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
            return (
              <span
                key={r.detector}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
                  tone,
                )}
                title={
                  noData
                    ? `${r.detector}: no anomalies recorded yet`
                    : `${r.detector}: ${r.falsePositives} of ${r.anomalies} marked false positive`
                }
                data-testid={`anomaly-feedback-rate-${r.detector}`}
              >
                <span className="font-mono">{r.detector}</span>
                <span className="tabular-nums">{pct === null ? '—' : `${pct}%`}</span>
              </span>
            );
          })}
        </div>
      )}

      {/* Fleet Vitals — the same shared component Home renders, asked for a
          different emphasis: insight counts lead, container status collapses to
          one line. Home carries that strip in full, and navigating Home →
          Health used to leave the top ~180px of the viewport unchanged. */}
      <SpotlightCard>
        <FleetHealthSummary
          stats={healthStats}
          isLoading={containersLoading}
          insightStats={stats}
          layout="insights-first"
        />
      </SpotlightCard>

      {/* Search + filter pane — search input on top, severity / status tabs below.
          Single pane so the filter context lives next to the query that
          drives it; removes the visual gap between the two controls. */}
      <SpotlightCard>
        <div className="rounded-lg border bg-card p-6 shadow-sm space-y-3">
          {/* Search */}
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
          {/* Severity + acknowledgement filter tabs */}
          <div className="flex flex-wrap items-center gap-2">
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
            {/* Per-user Sensitivity preset (#1297) — adjusts the anomaly
                post-filter without altering anything in the DB. Pushed to
                the right of the severity/acknowledgement controls. */}
            <div className="ml-auto">
              <SensitivityControl />
            </div>
          </div>
        </div>
      </SpotlightCard>

      {/* Correlated metric deviations. Renamed from "ML-Detected Anomalies":
          the composite score is a root-mean-square of per-metric z-scores and
          the pattern is a z-score threshold rule — real multivariate
          statistics, but not inference, so it gets neither the Brain glyph nor
          the AI purple that DESIGN.md reserves for model output. The maths
          below is unchanged. */}
      {(correlatedLoading || (filteredCorrelatedAnomalies && filteredCorrelatedAnomalies.length > 0)) && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Sigma className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">
              Correlated metric deviations
              {!correlatedLoading && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({filteredCorrelatedAnomalies?.length ?? 0})
                </span>
              )}
            </h2>
          </div>
          {correlatedLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <SkeletonChart size="md" />
              <SkeletonChart size="md" />
              <SkeletonChart size="md" />
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {(filteredCorrelatedAnomalies ?? []).map((anomaly) => {
                const anomalyId = deriveCorrelatedAnomalyId({
                  containerId: anomaly.containerId,
                  timestamp: anomaly.timestamp,
                });
                // Each card knows whether _it_ is the one being marked
                // by comparing the in-flight mutation's variables —
                // simple per-card pending state without a per-row map.
                const isPending =
                  markFalsePositive.isPending &&
                  markFalsePositive.variables?.anomalyId === anomalyId;
                return (
                  <CorrelatedAnomalyCard
                    key={anomaly.containerId}
                    anomaly={anomaly}
                    onMarkFalsePositive={handleMarkFalsePositive}
                    isPending={isPending}
                  />
                );
              })}
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
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <IncidentGroupsView search={searchInput} />
        </div>
      </SpotlightCard>

      {/* Insights Feed */}
      <SpotlightCard>
        <div className="rounded-lg border bg-card p-6 shadow-sm">
        {isLoading ? (
          <SkeletonList rows={6} />
        ) : filteredInsights.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No insights"
            description={
              acknowledgementFilter === 'unacknowledged'
                ? 'No unacknowledged insights match the current filters.'
                : severityFilter === 'all'
                  ? 'AI monitoring has not generated any insights yet. Check back soon.'
                  : `No ${severityFilter} insights found. Try a different filter.`
            }
          />
        ) : (
          <div className="space-y-3">
            {repeatedInsightGroups.map((group) => (
              <RepeatedInsightGroup
                key={group[0].id}
                insights={group}
                getInvestigationForInsight={getInvestigationForInsight}
                onAcknowledge={acknowledgeInsight}
                acknowledgingInsightId={acknowledgingInsightId}
                acknowledgeErrorMessage={acknowledgeError instanceof Error ? acknowledgeError.message : undefined}
              />
            ))}
          </div>
        )}
        </div>
      </SpotlightCard>
    </div>
  );
}
