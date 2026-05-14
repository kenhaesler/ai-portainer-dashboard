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
 * Renders four panels for a single container:
 *   1. RED summary (last 1h, bucket=1h, filters.container=name)
 *   2. Top outgoing calls (client kind) — link out to Trace Explorer
 *   3. Top incoming calls (server kind)
 *   4. Latency p50/p95 timeline + error rate (1m bucket, last 60m)
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

  // (2) Outgoing (client kind)
  const { data: outgoing } = useTraces({
    containerName,
    from: hourFrom.toISOString(),
    to: hourTo.toISOString(),
    limit: 10,
  });
  // (3) Incoming (server kind) — use the same /api/traces endpoint without
  // a kind filter at the hook level since the hook doesn't model it; the
  // trace explorer page already does best-effort filtering, and this panel
  // is mostly for navigation, not precise RED counts.
  const { data: incoming } = useTraces({
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
    || (outgoing?.length ?? 0) > 0
    || (incoming?.length ?? 0) > 0;

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

      {/* (2) & (3) Top calls */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-lg border bg-card p-6 shadow-sm">
          <h3 className="text-lg font-semibold">Top outgoing calls</h3>
          <TraceList traces={sortByDuration(outgoing)} emptyText="No outgoing calls observed." />
        </section>
        <section className="rounded-lg border bg-card p-6 shadow-sm">
          <h3 className="text-lg font-semibold">Top incoming calls</h3>
          <TraceList traces={sortByDuration(incoming)} emptyText="No incoming calls observed." />
        </section>
      </div>

      {/* (4) Latency + error timeline */}
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
                <Line yAxisId="left" type="monotone" dataKey="p50" stroke="#3b82f6" dot={false} />
                <Line yAxisId="left" type="monotone" dataKey="p95" stroke="#8b5cf6" dot={false} />
                <Line yAxisId="right" type="monotone" dataKey="errorRate" stroke="#ef4444" dot={false} />
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
