import { useMemo, useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { LlmLatencyBreakdown } from '@/features/ai-intelligence/components/llm-latency-breakdown';
import { useLlmTraces, useLlmStats, type LlmTrace } from '@/features/ai-intelligence/hooks/use-llm-observability';
import { useAutoRefresh } from '@/shared/hooks/use-auto-refresh';
import { RefreshButton } from '@/shared/components/ui/refresh-button';
import { AutoRefreshToggle } from '@/shared/components/ui/auto-refresh-toggle';
import { KpiCard } from '@/shared/components/data-display/kpi-card';
import { SpotlightCard } from '@/shared/components/data-display/spotlight-card';
import { TiltCard } from '@/shared/components/data-display/tilt-card';
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

function StatusBadge({ status }: { status: string }) {
  const isSuccess = status === 'success';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        isSuccess
          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
      )}
    >
      {status}
    </span>
  );
}

function TracesTable({ traces, isLoading, privacyMode }: { traces: LlmTrace[]; isLoading: boolean; privacyMode: boolean }) {
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
        title="No LLM traces yet"
        description="LLM interactions will appear here once the assistant is used."
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

export default function LlmObservabilityPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>(24);
  const [privacyMode, setPrivacyMode] = useState(true);
  const { interval, setInterval } = useAutoRefresh(30);

  const { data: stats, isLoading: statsLoading, isPending: statsPending, refetch: refetchStats } = useLlmStats(timeRange);
  const { data: traces, isLoading: tracesLoading, isPending: tracesPending, refetch: refetchTraces } = useLlmTraces(50);
  // Treat both isLoading and isPending-without-data as "loading" to avoid
  // rendering a blank page during SPA navigation before data arrives.
  const showStatsSkeleton = statsLoading || (statsPending && !stats);
  const showTracesSkeleton = tracesLoading || (tracesPending && !traces);
  const modelBreakdown = stats?.modelBreakdown ?? [];
  const totalModelQueries = modelBreakdown.reduce((sum, model) => sum + model.count, 0);
  const maxModelQueries = modelBreakdown.reduce((max, model) => Math.max(max, model.count), 0);

  const handleRefresh = () => {
    refetchStats();
    refetchTraces();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">LLM Observability</h1>
          <p className="text-muted-foreground">
            Monitor LLM usage and performance
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Time Range Selector */}
          <div className="flex items-center rounded-md border border-input bg-background">
            {TIME_RANGES.map((range) => (
              <button
                key={range.value}
                onClick={() => setTimeRange(range.value)}
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
          <AutoRefreshToggle interval={interval} onIntervalChange={setInterval} />
          <RefreshButton onClick={handleRefresh} />
        </div>
      </div>

      {/* KPI Cards */}
      {showStatsSkeleton ? (
        <div className="grid gap-4 md:grid-cols-4">
          <SkeletonKpi />
          <SkeletonKpi />
          <SkeletonKpi />
          <SkeletonKpi />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-4">
          <TiltCard>
            <KpiCard
              label="Total Queries"
              value={stats?.totalQueries ?? 0}
              icon={<MessageSquare className="h-5 w-5" />}
            />
          </TiltCard>
          <TiltCard>
            <KpiCard
              label="Total Tokens"
              value={stats?.totalTokens ?? 0}
              icon={<Hash className="h-5 w-5" />}
            />
          </TiltCard>
          <TiltCard>
            <KpiCard
              label="Avg Latency"
              value={`${Math.round(stats?.avgLatencyMs ?? 0)}ms`}
              icon={<Zap className="h-5 w-5" />}
            />
          </TiltCard>
          <TiltCard>
            <KpiCard
              label="Error Rate"
              value={`${((stats?.errorRate ?? 0) * 100).toFixed(1)}%`}
              icon={<AlertTriangle className="h-5 w-5" />}
              trend={(stats?.errorRate ?? 0) > 0.05 ? 'down' : undefined}
              trendValue={(stats?.errorRate ?? 0) > 0.05 ? 'Above 5%' : undefined}
            />
          </TiltCard>
        </div>
      )}

      {/* Model Breakdown */}
      {stats && (
        <SpotlightCard>
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-4">Model Breakdown</h2>
          {modelBreakdown.length === 0 ? (
            <p className="text-sm text-muted-foreground">No model data available.</p>
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
        <LlmLatencyBreakdown />
      </div>
      </SpotlightCard>

      {/* Recent Traces */}
      <SpotlightCard>
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Recent Traces</h2>
        </div>
        <TracesTable traces={traces ?? []} isLoading={showTracesSkeleton} privacyMode={privacyMode} />
      </div>
      </SpotlightCard>
    </div>
  );
}
