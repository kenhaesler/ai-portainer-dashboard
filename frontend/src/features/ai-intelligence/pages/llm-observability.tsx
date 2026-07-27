import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { LlmLatencyBreakdown, formatWindowLabel } from '@/features/ai-intelligence/components/llm-latency-breakdown';
import { useLlmTraces, useLlmStats, type LlmTrace } from '@/features/ai-intelligence/hooks/use-llm-observability';
import { useAutoRefresh } from '@/shared/hooks/use-auto-refresh';
import { RefreshControls } from '@/shared/components/ui/refresh-controls';
import { PageHeader } from '@/shared/components/layout/page-header';
import { DataFreshness } from '@/shared/components/feedback/data-freshness';
import { KpiCard } from '@/shared/components/data-display/kpi-card';
import { SpotlightCard } from '@/shared/components/data-display/spotlight-card';
import { DataTable } from '@/shared/components/tables/data-table';
import { SkeletonKpi, SkeletonList } from '@/shared/components/feedback/skeleton';
import { EmptyState } from '@/shared/components/feedback/empty-state';
import { cn, formatDate } from '@/shared/lib/utils';
import {
  Activity,
  MessageSquare,
  Zap,
  AlertTriangle,
  Hash,
  Eye,
  EyeOff,
} from 'lucide-react';

type ModelBreakdownRow = { model: string; count: number; tokens: number };

type TimeRange = 1 | 6 | 24 | 168;

const TIME_RANGES: { label: string; value: TimeRange }[] = [
  { label: '1h', value: 1 },
  { label: '6h', value: 6 },
  { label: '24h', value: 24 },
  { label: '7d', value: 168 },
];

/** Newest `limit` traces the API returned, narrowed to the selected window. */
export function tracesWithinWindow(traces: LlmTrace[], hours: number): LlmTrace[] {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return traces.filter((trace) => {
    const at = Date.parse(trace.created_at);
    // An unparseable timestamp is not evidence the row is out of range, so
    // keep it rather than silently hiding a call that did happen.
    return Number.isNaN(at) ? true : at >= cutoff;
  });
}

function StatusBadge({ status }: { status: string }) {
  const isSuccess = status === 'success';
  return (
    <span
      className={cn(
        // `capitalize` because the API's raw lowercase value sits inches from
        // Title Case column headers and badges everywhere else on the page.
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize',
        isSuccess
          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
      )}
    >
      {status}
    </span>
  );
}

function TracesTable({
  traces,
  isLoading,
  privacyMode,
  windowLabel,
}: {
  traces: LlmTrace[];
  isLoading: boolean;
  privacyMode: boolean;
  windowLabel: string;
}) {
  const columns = useMemo<ColumnDef<LlmTrace, unknown>[]>(() => [
    {
      accessorKey: 'created_at',
      header: 'Time',
      cell: ({ getValue }) => (
        <span className="whitespace-nowrap text-muted-foreground">{formatDate(getValue<string>())}</span>
      ),
    },
    {
      accessorKey: 'model',
      header: 'Model',
      cell: ({ getValue }) => (
        <span className="whitespace-nowrap font-mono text-xs">{getValue<string>()}</span>
      ),
    },
    {
      accessorKey: 'user_query',
      header: 'Query',
      cell: ({ row }) => {
        const query = row.original.user_query;
        return (
          <span
            className={cn(
              'block max-w-[300px] truncate select-none',
              privacyMode && 'blur-sm hover:blur-none transition-[filter] duration-200'
            )}
            title={privacyMode ? undefined : (query ?? undefined)}
          >
            {query || '—'}
          </span>
        );
      },
    },
    {
      accessorKey: 'total_tokens',
      header: () => <span className="block w-full text-right">Tokens</span>,
      cell: ({ getValue }) => (
        <div className="text-right whitespace-nowrap font-mono">{getValue<number>().toLocaleString()}</div>
      ),
    },
    {
      accessorKey: 'latency_ms',
      header: () => <span className="block w-full text-right">Latency</span>,
      cell: ({ getValue }) => (
        <div className="text-right whitespace-nowrap font-mono">{getValue<number>().toLocaleString()}ms</div>
      ),
    },
    {
      accessorKey: 'status',
      header: () => <span className="block w-full text-center">Status</span>,
      cell: ({ getValue }) => (
        <div className="text-center">
          <StatusBadge status={getValue<string>()} />
        </div>
      ),
    },
  ], [privacyMode]);

  if (isLoading) {
    return <SkeletonList rows={4} />;
  }

  if (traces.length === 0) {
    return (
      <EmptyState
        icon={MessageSquare}
        title={`No LLM calls in the ${windowLabel}`}
        description="Every question asked in Assistant is recorded here with its model, token count and latency."
      />
    );
  }

  return <DataTable columns={columns} data={traces} hideSearch getRowId={(trace) => String(trace.id)} />;
}

function ModelBreakdownTable({
  modelBreakdown,
  totalModelQueries,
  maxModelQueries,
}: {
  modelBreakdown: ModelBreakdownRow[];
  totalModelQueries: number;
  maxModelQueries: number;
}) {
  const columns = useMemo<ColumnDef<ModelBreakdownRow, unknown>[]>(() => [
    {
      accessorKey: 'model',
      header: 'Model',
      cell: ({ getValue }) => (
        <span className="inline-flex rounded-md bg-muted/50 px-2 py-1 font-mono text-xs">
          {getValue<string>()}
        </span>
      ),
    },
    {
      accessorKey: 'count',
      header: () => <span className="block w-full text-right">Queries</span>,
      cell: ({ getValue }) => (
        <div className="text-right font-medium">{getValue<number>().toLocaleString()}</div>
      ),
    },
    {
      accessorKey: 'tokens',
      header: () => <span className="block w-full text-right">Tokens</span>,
      cell: ({ getValue }) => (
        <div className="text-right font-medium">{getValue<number>().toLocaleString()}</div>
      ),
    },
    {
      id: 'share',
      header: 'Share',
      enableSorting: false,
      cell: ({ row }) => {
        const model = row.original;
        const queryShare = totalModelQueries > 0 ? Math.round((model.count / totalModelQueries) * 100) : 0;
        const density = maxModelQueries > 0 ? Math.round((model.count / maxModelQueries) * 100) : 0;
        return (
          <div className="flex min-w-36 items-center gap-2">
            <div className="h-2 w-24 overflow-hidden rounded-full bg-muted" aria-label={`${model.model} share`}>
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.max(4, density)}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground">{queryShare}%</span>
          </div>
        );
      },
    },
  ], [totalModelQueries, maxModelQueries]);

  return <DataTable columns={columns} data={modelBreakdown} hideSearch getRowId={(model) => model.model} />;
}

/** Traces are fetched newest-first with this cap; the window narrows them. */
const TRACE_LIMIT = 50;

/**
 * Error-rate threshold, in percent, matching the wording of the hover detail.
 *
 * `stats.errorRate` is a percentage (0-100). The comparison was written against
 * `0.05` as though it were a fraction, so the "above the 5% error threshold"
 * note actually fired at 0.05% — any window containing a single failed call out
 * of two thousand. Named so the number and the sentence cannot drift apart.
 */
const ERROR_RATE_THRESHOLD_PCT = 5;

export default function LlmObservabilityPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>(24);
  const [privacyMode, setPrivacyMode] = useState(true);
  const queryClient = useQueryClient();

  const {
    data: stats,
    isLoading: statsLoading,
    isPending: statsPending,
    dataUpdatedAt: statsUpdatedAt,
    refetch: refetchStats,
  } = useLlmStats(timeRange);
  const {
    data: traces,
    isLoading: tracesLoading,
    isPending: tracesPending,
    dataUpdatedAt: tracesUpdatedAt,
    refetch: refetchTraces,
  } = useLlmTraces(TRACE_LIMIT);

  const handleRefresh = useCallback(() => {
    refetchStats();
    refetchTraces();
    // The latency panel owns its own per-peer fan-out, so a page refresh has
    // to reach it explicitly or the "Every 30s" control would be honest about
    // two of the page's three sections.
    queryClient.invalidateQueries({ queryKey: ['llm-latency-breakdown'] });
  }, [refetchStats, refetchTraces, queryClient]);

  // The hook owns the timer. Before `onTick` the dropdown set state and
  // scheduled nothing, so this page rendered a pulsing "live" dot over a
  // control that refreshed exactly nothing.
  const { interval, setRefreshInterval } = useAutoRefresh(30, {
    onTick: handleRefresh,
    storageKey: 'llm-observability',
  });

  // Treat both isLoading and isPending-without-data as "loading" to avoid
  // rendering a blank page during SPA navigation before data arrives.
  const showStatsSkeleton = statsLoading || (statsPending && !stats);
  const showTracesSkeleton = tracesLoading || (tracesPending && !traces);
  const modelBreakdown = stats?.modelBreakdown ?? [];
  const totalModelQueries = modelBreakdown.reduce((sum, model) => sum + model.count, 0);
  const maxModelQueries = modelBreakdown.reduce((max, model) => Math.max(max, model.count), 0);

  const windowLabel = formatWindowLabel(timeRange);

  // "Recent Traces" was a fixed newest-50 whatever the range selector said.
  const visibleTraces = useMemo(
    () => tracesWithinWindow(traces ?? [], timeRange),
    [traces, timeRange],
  );

  const lastUpdated = Math.max(statsUpdatedAt ?? 0, tracesUpdatedAt ?? 0) || null;
  const hasQueries = (stats?.totalQueries ?? 0) > 0;

  // Token and latency aggregates cover successful calls only. When some calls
  // failed, the tiles must say what they are an average *of* — otherwise a
  // window where most calls errored reports a confident latency for a handful
  // of survivors and reads as though it describes the whole window.
  const hasSucceeded = (stats?.succeededQueries ?? 0) > 0;
  const aggregateBasis =
    (stats?.failedQueries ?? 0) > 0
      ? `Over ${stats?.succeededQueries ?? 0} successful ${
          (stats?.succeededQueries ?? 0) === 1 ? 'call' : 'calls'
        } — ${stats?.failedQueries} failed and are excluded`
      : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="LLM Observability"
        actions={
          <>
            {/* Time Range Selector */}
            <div className="flex items-center rounded-md border border-input bg-background">
              {TIME_RANGES.map((range) => (
                <button
                  key={range.value}
                  onClick={() => setTimeRange(range.value)}
                  aria-pressed={timeRange === range.value}
                  className={cn(
                    'px-3 py-1.5 text-sm font-medium transition-colors',
                    timeRange === range.value
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                    range.value === 1 && 'rounded-l-md',
                    range.value === 168 && 'rounded-r-md'
                  )}
                >
                  {range.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setPrivacyMode(!privacyMode)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
                privacyMode
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-input bg-background text-muted-foreground hover:text-foreground'
              )}
              title={privacyMode ? 'Queries are blurred — click to reveal' : 'Queries are visible — click to blur'}
            >
              {privacyMode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              Privacy
            </button>
            <DataFreshness lastUpdated={lastUpdated} onRefresh={handleRefresh} />
            <RefreshControls
              interval={interval}
              onIntervalChange={setRefreshInterval}
              onRefresh={handleRefresh}
            />
          </>
        }
      />

      {/* KPI Cards. Four tiles over zero traffic are four zeroes, and an
          "Error Rate 0.0%" computed from no calls is not 0% — it is undefined.
          With no queries in the window we say so in one line instead. */}
      {showStatsSkeleton ? (
        <div className="grid gap-6 md:grid-cols-4">
          <SkeletonKpi />
          <SkeletonKpi />
          <SkeletonKpi />
          <SkeletonKpi />
        </div>
      ) : hasQueries ? (
        <div className="grid gap-6 md:grid-cols-4">
          <KpiCard
            label="Total Queries"
            value={stats?.totalQueries ?? 0}
            icon={<MessageSquare className="h-5 w-5" />}
          />
          {/* An em dash, not a zero, when every call in the window failed:
              "0 tokens / 0ms" is a measurement of work that never happened,
              and 0ms in particular reads as an impossibly fast model. */}
          <KpiCard
            label="Total Tokens"
            value={hasSucceeded ? (stats?.totalTokens ?? 0) : '—'}
            icon={<Hash className="h-5 w-5" />}
            hoverDetail={aggregateBasis}
          />
          <KpiCard
            label="Avg Latency"
            value={hasSucceeded ? `${Math.round(stats?.avgLatencyMs ?? 0)}ms` : '—'}
            icon={<Zap className="h-5 w-5" />}
            hoverDetail={aggregateBasis}
          />
          <KpiCard
            label="Error Rate"
            // `errorRate` arrives as a percentage (0-100). This multiplied it
            // by 100 a second time, so a single failed call — 100% of a
            // one-call window — rendered as "10000.0%".
            value={`${(stats?.errorRate ?? 0).toFixed(1)}%`}
            icon={<AlertTriangle className="h-5 w-5" />}
            // No trend arrow: a down arrow on a rising error rate reads as an
            // improvement, and there is no direction in this payload anyway.
            hoverDetail={
              // Compared against 5, not 0.05 — on a percentage the old
              // threshold fired at 0.05% while the text claimed 5%.
              (stats?.errorRate ?? 0) > ERROR_RATE_THRESHOLD_PCT
                ? `${stats?.failedQueries ?? 0} of ${stats?.totalQueries ?? 0} calls failed, above the ${ERROR_RATE_THRESHOLD_PCT}% error threshold`
                : undefined
            }
          />
        </div>
      ) : (
        <div
          data-testid="llm-no-traffic"
          className="rounded-lg border bg-card p-4 text-sm text-muted-foreground shadow-sm"
        >
          No LLM calls in the {windowLabel}. Ask something in{' '}
          <Link to="/assistant" className="font-medium text-primary underline-offset-4 hover:underline">
            Assistant
          </Link>{' '}
          and its model, tokens and latency land here.
        </div>
      )}

      {/* Model Breakdown */}
      {stats && (
        <SpotlightCard>
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-4">Model Breakdown</h2>
          {modelBreakdown.length === 0 ? (
            <EmptyState
              icon={Hash}
              title={`No model recorded in the ${windowLabel}`}
              description="Each call is attributed to the model that served it; the split appears once calls are made."
            />
          ) : (
            <ModelBreakdownTable
              modelBreakdown={modelBreakdown}
              totalModelQueries={totalModelQueries}
              maxModelQueries={maxModelQueries}
            />
          )}
        </div>
        </SpotlightCard>
      )}

      {/* LLM Latency Breakdown (#1239) — Network vs Model split per provider */}
      <SpotlightCard>
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <LlmLatencyBreakdown hours={timeRange} />
      </div>
      </SpotlightCard>

      {/* Recent Traces */}
      <SpotlightCard>
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1">
          <Activity className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Recent Traces</h2>
          {/* The cap is part of what the operator is looking at, so it is on
              screen rather than buried in the request. */}
          <span className="text-xs text-muted-foreground">
            up to {TRACE_LIMIT} newest, {windowLabel}
          </span>
        </div>
        <TracesTable
          traces={visibleTraces}
          isLoading={showTracesSkeleton}
          privacyMode={privacyMode}
          windowLabel={windowLabel}
        />
      </div>
      </SpotlightCard>
    </div>
  );
}
