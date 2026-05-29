import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import {
  BarChart,
  Bar,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '@/shared/lib/api';
import { DataTable } from '@/shared/components/tables/data-table';
import { NoTraceDataCallout } from '@/features/observability/components/no-trace-data-callout';

/**
 * Default LLM provider hostnames used when the parent doesn't pass a list.
 * Mirrors the LLM_PEER_HOSTNAMES default in env.schema.ts. Hardcoded here
 * because the backend currently has no /api/config/public endpoint to expose
 * the env-derived list to the frontend; see #1239 follow-up.
 */
export const DEFAULT_LLM_PEER_HOSTNAMES = [
  'api.anthropic.com',
  'api.openai.com',
  'api.mistral.ai',
  'api.deepseek.com',
  'api.groq.com',
];

interface PeerSpan {
  traceId?: string;
  duration?: number;
  duration_ms?: number;
  attributes?: Record<string, unknown>;
}

interface BreakdownRow {
  peer: string;
  p50: number;
  p95: number;
  p99: number;
  calls: number;
  network: number;
  model: number;
}

interface LlmLatencyBreakdownProps {
  /** LLM provider hostnames to query (one /api/traces call per peer). */
  peers?: string[];
  /** Override the lookback window. Default = last 1 hour. */
  fromIso?: string;
  toIso?: string;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

function durationOf(span: PeerSpan): number {
  const v = span.duration ?? span.duration_ms ?? 0;
  return Number.isFinite(v) ? v : 0;
}

/**
 * LLM latency breakdown panel (#1239).
 *
 * Fetches /api/traces?netPeerName=<host> for each configured LLM provider
 * hostname in parallel and renders a stacked bar per peer split into
 * network roundtrip vs model latency.
 *
 * The "model" portion is estimated from spans that carry an
 * `x-trace-correlation-id` attribute (matched to llm_traces.latency_ms).
 * When no correlation is available we fall back to showing total duration
 * as a single "network + model" bar so the panel stays informative.
 */
export function LlmLatencyBreakdown({ peers, fromIso, toIso }: LlmLatencyBreakdownProps) {
  const peerList = peers && peers.length > 0 ? peers : DEFAULT_LLM_PEER_HOSTNAMES;

  // Stable window per render — 1h lookback by default.
  const window = useMemo(() => {
    const to = toIso ?? new Date().toISOString();
    const from = fromIso ?? new Date(Date.now() - 60 * 60 * 1000).toISOString();
    return { from, to };
  }, [fromIso, toIso]);

  const queries = useQueries({
    queries: peerList.map((peer) => ({
      queryKey: ['llm-latency-breakdown', peer, window.from, window.to],
      queryFn: async () => {
        // /api/traces wraps its payload as { traces: [...] }; unwrap here
        // so the rest of the component can treat the result as a span list.
        const body = await api.get<{ traces: PeerSpan[] }>('/api/traces', {
          params: {
            netPeerName: peer,
            from: window.from,
            to: window.to,
            limit: 500,
          } as Record<string, string | number | boolean | undefined>,
        });
        return body?.traces ?? [];
      },
    })),
  });

  const isLoading = queries.some((q) => q.isLoading);
  const allSpans = queries.flatMap((q) => q.data ?? []);

  const chartData = useMemo<BreakdownRow[]>(() => {
    return peerList
      .map((peer, idx) => {
        const spans = queries[idx]?.data ?? [];
        const durations = spans.map(durationOf);
        if (durations.length === 0) {
          return { peer, p50: 0, p95: 0, p99: 0, calls: 0, network: 0, model: 0 };
        }
        // Estimate model latency from correlation-id-tagged spans. The Beyla
        // span captures total roundtrip; we treat the matched llm_traces
        // latency_ms (when available as `model_latency_ms` attribute) as the
        // server-side model portion, leaving the rest as network.
        const totals = durations;
        const matched = spans.filter((s) => {
          const attrs = s.attributes ?? {};
          return (
            typeof attrs['x-trace-correlation-id'] === 'string'
            || typeof attrs['model_latency_ms'] === 'number'
          );
        });
        const modelPortions = matched
          .map((s) => Number((s.attributes ?? {})['model_latency_ms']) || 0)
          .filter((v) => v > 0);

        const avgTotal = totals.reduce((a, b) => a + b, 0) / totals.length;
        const avgModel = modelPortions.length > 0
          ? modelPortions.reduce((a, b) => a + b, 0) / modelPortions.length
          : 0;
        const network = Math.max(0, avgTotal - avgModel);

        return {
          peer,
          p50: percentile(totals, 0.5),
          p95: percentile(totals, 0.95),
          p99: percentile(totals, 0.99),
          calls: totals.length,
          network,
          model: avgModel,
        };
      })
      .filter((row) => row.calls > 0);
  }, [peerList, queries]);

  const columns = useMemo<ColumnDef<BreakdownRow, unknown>[]>(() => [
    {
      accessorKey: 'peer',
      header: 'Provider',
      cell: ({ getValue }) => (
        <span className="font-mono text-xs">{getValue<string>()}</span>
      ),
    },
    {
      accessorKey: 'calls',
      header: () => <span className="block text-right">Calls</span>,
      cell: ({ getValue }) => <span className="block text-right">{getValue<number>()}</span>,
    },
    {
      accessorKey: 'p50',
      header: () => <span className="block text-right">p50 (ms)</span>,
      cell: ({ getValue }) => <span className="block text-right">{getValue<number>().toFixed(0)}</span>,
    },
    {
      accessorKey: 'p95',
      header: () => <span className="block text-right">p95 (ms)</span>,
      cell: ({ getValue }) => <span className="block text-right">{getValue<number>().toFixed(0)}</span>,
    },
    {
      accessorKey: 'p99',
      header: () => <span className="block text-right">p99 (ms)</span>,
      cell: ({ getValue }) => <span className="block text-right">{getValue<number>().toFixed(0)}</span>,
    },
  ], []);

  if (!isLoading && allSpans.length === 0) {
    return (
      <NoTraceDataCallout
        description="No outbound LLM spans seen in the last hour. Deploy Beyla on the host running the dashboard to capture HTTPS calls to your provider."
      />
    );
  }

  return (
    <section data-testid="llm-latency-breakdown">
      <h3 className="text-base font-semibold tracking-tight">LLM latency breakdown</h3>
      <p className="text-sm text-muted-foreground">
        Network roundtrip vs estimated model latency per upstream provider, last 1h.
      </p>

      <div className="mt-4 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 12, left: 4, bottom: 24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
            <XAxis dataKey="peer" fontSize={11} angle={-15} dy={10} />
            <YAxis fontSize={11} label={{ value: 'ms', angle: -90, position: 'insideLeft', fontSize: 11 }} />
            <Tooltip />
            <Legend />
            <Bar dataKey="network" stackId="latency" fill="#60a5fa" name="Network roundtrip (avg ms)" />
            <Bar dataKey="model" stackId="latency" fill="#a78bfa" name="Model latency (avg ms)" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4">
        <DataTable
          columns={columns}
          data={chartData}
          hideSearch
          pageSize={100}
          getRowId={(row) => row.peer}
        />
      </div>
    </section>
  );
}
