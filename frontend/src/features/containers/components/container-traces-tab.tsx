import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { useRed } from '@/features/observability/hooks/use-red';
import { useTraces } from '@/features/observability/hooks/use-traces';
import { NoTraceDataCallout } from '@/features/observability/components/no-trace-data-callout';

interface ContainerTracesTabProps {
  containerName: string;
  endpointId: number;
}

/**
 * The latency/error series, as theme tokens.
 *
 * These were hardcoded hex (`#3b82f6`, `#8b5cf6`, `#ef4444`), which assumes one
 * background; the app ships 16 themes, 8 of them light. Purple is reserved for
 * AI insight, so p95 takes a chart colour rather than violet, and only the
 * error series keeps a status colour.
 */
export const LATENCY_SERIES = [
  { dataKey: 'p50', yAxisId: 'left', stroke: 'var(--color-chart-1)' },
  { dataKey: 'p95', yAxisId: 'left', stroke: 'var(--color-chart-2)' },
  { dataKey: 'errorRate', yAxisId: 'right', stroke: 'var(--color-destructive)' },
] as const;

// Rounds a Date down to the start of its current minute, then forward
// `offsetMs` — used to keep RED window edges stable across renders for the
// React Query cache key.
function flooredNow(): Date {
  const d = new Date();
  d.setSeconds(0, 0);
  return d;
}

/**
 * Container Detail → "Calls" tab (#1235).
 *
 * Renders three panels for a single container:
 *   1. RED summary (last 1h, bucket=1h, filters.container=name)
 *   2. Slowest calls — link out to Trace Explorer
 *   3. Latency p50/p95 timeline + error rate (1m bucket, last 60m)
 *
 * There used to be two call panels, "Top outgoing calls" and "Top incoming
 * calls", issued as two identical `useTraces` queries — same container, same
 * window, same limit, no span-kind filter — so they rendered byte-identical
 * lists under two headings that promised opposite directions. Splitting them
 * again needs a span `kind` filter on the traces hook and API.
 *
 * Empty state for every panel is the shared NoTraceDataCallout.
 */
export function ContainerTracesTab({ containerName }: ContainerTracesTabProps) {
  // Stabilise both windows once per render — same minute → same query key.
  const { hourFrom, hourTo, minuteFrom, minuteTo } = useMemo(() => {
    const to = flooredNow();
    const hourFrom = new Date(to.getTime() - 60 * 60 * 1000);
    const minuteFrom = new Date(to.getTime() - 60 * 60 * 1000);
    return { hourFrom, hourTo: to, minuteFrom, minuteTo: to };
  }, []);

  // (1) RED summary
  const { data: redSummary } = useRed({
    from: hourFrom,
    to: hourTo,
    bucket: '1h',
    groupBy: 'container',
    container: containerName,
  });
  // (4) Latency/error sparkline
  const { data: redSparkline } = useRed({
    from: minuteFrom,
    to: minuteTo,
    bucket: '1m',
    groupBy: 'container',
    container: containerName,
  });

  // (2) Calls touching this container in the window. The traces hook models no
  // span `kind`, so this is every call, not a direction.
  const { data: calls } = useTraces({
    containerName,
    from: hourFrom.toISOString(),
    to: hourTo.toISOString(),
    limit: 10,
  });

  // Build sparkline series from the 1m-bucketed RED result.
  const sparklineData = useMemo(() => {
    if (!redSparkline?.buckets) return [] as { time: string; p50: number; p95: number; errorRate: number }[];
    return redSparkline.buckets
      .slice()
      .sort((a, b) => a.bucketStart.localeCompare(b.bucketStart))
      .map((b) => {
        const row = b.rows.find((r) => r.group === containerName) ?? b.rows[0];
        return {
          time: new Date(b.bucketStart).toLocaleTimeString(),
          p50: row?.p50Ms ?? 0,
          p95: row?.p95Ms ?? 0,
          errorRate: (row?.errorRate ?? 0) * 100,
        };
      });
  }, [redSparkline, containerName]);

  const summaryRow = redSummary?.buckets[0]?.rows[0];
  const hasAnyData = (redSummary?.buckets.length ?? 0) > 0
    || (calls?.length ?? 0) > 0;

  if (!hasAnyData) {
    return (
      <div className="space-y-6">
        <NoTraceDataCallout description="No trace data observed for this container in the last hour. Deploy Beyla to start collecting RED metrics." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* (1) RED summary */}
      <section className="rounded-lg border bg-card p-6 shadow-sm">
        <h3 className="text-lg font-semibold">RED summary (last 1h)</h3>
        {summaryRow ? (
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
            <div>
              <dt className="text-xs text-muted-foreground">Rate</dt>
              <dd className="mt-1 font-mono text-base">{summaryRow.rate.toFixed(2)} /s</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Error rate</dt>
              <dd className="mt-1 font-mono text-base">{(summaryRow.errorRate * 100).toFixed(2)}%</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">p50</dt>
              <dd className="mt-1 font-mono text-base">{summaryRow.p50Ms.toFixed(0)} ms</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">p95</dt>
              <dd className="mt-1 font-mono text-base">{summaryRow.p95Ms.toFixed(0)} ms</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">p99</dt>
              <dd className="mt-1 font-mono text-base">{summaryRow.p99Ms.toFixed(0)} ms</dd>
            </div>
          </dl>
        ) : (
          <NoTraceDataCallout className="mt-4" />
        )}
      </section>

      {/* (2) Slowest calls */}
      <section className="rounded-lg border bg-card p-6 shadow-sm">
        <h3 className="text-lg font-semibold">Slowest calls (last 1h)</h3>
        <TraceList traces={sortByDuration(calls)} emptyText="No calls observed in the last hour." />
      </section>

      {/* (3) Latency + error timeline */}
      <section className="rounded-lg border bg-card p-6 shadow-sm">
        <h3 className="text-lg font-semibold">Latency p50/p95 + error rate over time</h3>
        {sparklineData.length === 0 ? (
          <NoTraceDataCallout className="mt-4" />
        ) : (
          <div className="mt-4 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparklineData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="time" fontSize={11} />
                <YAxis yAxisId="left" fontSize={11} label={{ value: 'ms', angle: -90, position: 'insideLeft', fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" fontSize={11} label={{ value: 'err %', angle: 90, position: 'insideRight', fontSize: 11 }} />
                <Tooltip />
                {LATENCY_SERIES.map((series) => (
                  <Line
                    key={series.dataKey}
                    yAxisId={series.yAxisId}
                    type="monotone"
                    dataKey={series.dataKey}
                    stroke={series.stroke}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
    </div>
  );
}

interface TraceLike {
  traceId: string;
  duration: number;
  status: 'ok' | 'error' | 'unset';
  rootSpan: { operationName: string; serviceName: string; startTime: string };
}

function sortByDuration(traces: TraceLike[] | undefined): TraceLike[] {
  if (!traces) return [];
  return traces.slice().sort((a, b) => b.duration - a.duration).slice(0, 10);
}

function TraceList({ traces, emptyText }: { traces: TraceLike[]; emptyText: string }) {
  if (traces.length === 0) {
    return <p className="mt-4 text-sm text-muted-foreground">{emptyText}</p>;
  }
  return (
    <ul className="mt-3 divide-y divide-border">
      {traces.map((t) => (
        <li key={t.traceId} className="py-2">
          <Link
            to={`/traces?trace=${encodeURIComponent(t.traceId)}`}
            className="flex items-center justify-between gap-3 text-sm hover:text-primary"
          >
            <span className="truncate font-mono">{t.rootSpan.operationName}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {t.duration.toFixed(0)} ms{t.status === 'error' ? ' · error' : ''}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
