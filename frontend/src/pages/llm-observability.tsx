import { useState } from 'react';
import { useLlmTraces, useLlmStats, type LlmTrace } from '@/hooks/use-llm-observability';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import { RefreshButton } from '@/components/shared/refresh-button';
import { AutoRefreshToggle } from '@/components/shared/auto-refresh-toggle';
import { KpiCard } from '@/components/shared/kpi-card';
import { SkeletonCard } from '@/components/shared/loading-skeleton';
import { cn, formatDate } from '@/lib/utils';
import {
  Activity,
  MessageSquare,
  Zap,
  AlertTriangle,
  Hash,
  Eye,
  EyeOff,
} from 'lucide-react';

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
  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (traces.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/20 p-12 text-center">
        <MessageSquare className="mx-auto h-12 w-12 text-muted-foreground" />
        <h3 className="mt-4 text-lg font-semibold">No LLM traces yet</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          LLM interactions will appear here once the assistant is used.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Time</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Model</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Query</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Tokens</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Latency</th>
              <th className="px-4 py-3 text-center font-medium text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {traces.map((trace) => (
              <tr key={trace.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                  {formatDate(trace.created_at)}
                </td>
                <td className="px-4 py-3 whitespace-nowrap font-mono text-xs">
                  {trace.model}
                </td>
                <td className={cn(
                  'px-4 py-3 max-w-[300px] truncate select-none',
                  privacyMode && 'blur-sm hover:blur-none transition-[filter] duration-200'
                )} title={privacyMode ? undefined : (trace.user_query ?? undefined)}>
                  {trace.user_query || '—'}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap font-mono">
                  {trace.total_tokens.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap font-mono">
                  {trace.latency_ms.toLocaleString()}ms
                </td>
                <td className="px-4 py-3 text-center">
                  <StatusBadge status={trace.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function LlmObservabilityPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>(24);
  const [privacyMode, setPrivacyMode] = useState(true);
  const { interval, setInterval } = useAutoRefresh(30);

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useLlmStats(timeRange);
  const { data: traces, isLoading: tracesLoading, refetch: refetchTraces } = useLlmTraces(50);

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
      {statsLoading ? (
        <div className="grid gap-4 md:grid-cols-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-4">
          <KpiCard
            label="Total Queries"
            value={stats?.totalQueries ?? 0}
            icon={<MessageSquare className="h-5 w-5" />}
          />
          <KpiCard
            label="Total Tokens"
            value={stats?.totalTokens ?? 0}
            icon={<Hash className="h-5 w-5" />}
          />
          <KpiCard
            label="Avg Latency"
            value={`${Math.round(stats?.avgLatencyMs ?? 0)}ms`}
            icon={<Zap className="h-5 w-5" />}
          />
          <KpiCard
            label="Error Rate"
            value={`${((stats?.errorRate ?? 0) * 100).toFixed(1)}%`}
            icon={<AlertTriangle className="h-5 w-5" />}
            trend={(stats?.errorRate ?? 0) > 0.05 ? 'down' : undefined}
            trendValue={(stats?.errorRate ?? 0) > 0.05 ? 'Above 5%' : undefined}
          />
        </div>
      )}

      {/* Model Breakdown */}
      {stats && stats.modelBreakdown.length > 0 && (
        <div className="rounded-lg border bg-card p-6">
          <h2 className="text-lg font-semibold mb-4">Model Breakdown</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="pb-2 text-left font-medium text-muted-foreground">Model</th>
                  <th className="pb-2 text-right font-medium text-muted-foreground">Queries</th>
                  <th className="pb-2 text-right font-medium text-muted-foreground">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {stats.modelBreakdown.map((model) => (
                  <tr key={model.model} className="border-b last:border-0">
                    <td className="py-2 font-mono text-xs">{model.model}</td>
                    <td className="py-2 text-right">{model.count.toLocaleString()}</td>
                    <td className="py-2 text-right">{model.tokens.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Traces */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Activity className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Recent Traces</h2>
        </div>
        <TracesTable traces={traces ?? []} isLoading={tracesLoading} privacyMode={privacyMode} />
      </div>
    </div>
  );
}
