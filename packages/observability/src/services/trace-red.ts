/**
 * RED-metrics aggregate over the `spans` table.
 *
 * R (rate)     — requests per second across the [from, to) window
 * E (errors)   — fraction of spans with status='error'
 * D (duration) — p50/p95/p99 of `duration_ms` via percentile_cont
 *
 * Cardinality is capped at 100 rows per time bucket. When the cap is hit, the
 * `truncated` flag flips so callers can render a "showing top N" hint.
 *
 * The query uses `date_bin` (Postgres ≥ 14) for fixed-size buckets; the project
 * pins Postgres 17, so this is safe.
 */
import { getDbForDomain } from '@dashboard/core/db/app-db-router.js';

export type RedBucket = '1m' | '5m' | '1h';
export type RedGroupBy = 'service' | 'route' | 'container' | 'namespace';

export interface RedQuery {
  from: Date;
  to: Date;
  bucket: RedBucket;
  groupBy: RedGroupBy;
  filters?: {
    service?: string;
    route?: string;
    container?: string;
  };
}

export interface RedRow {
  group: string;
  rate: number;        // req/s
  errorRate: number;   // 0..1
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  callCount: number;
}

export interface RedResult {
  buckets: { bucketStart: string; rows: RedRow[] }[];
  truncated: boolean;
}

// Whitelist-mapped to avoid any user-controlled SQL fragment.
const GROUP_COL: Record<RedGroupBy, string> = {
  service: 'service_name',
  route: 'http_route',
  container: 'container_name',
  namespace: 'k8s_namespace',
};

const BUCKET_INTERVAL: Record<RedBucket, string> = {
  '1m': '1 minute',
  '5m': '5 minutes',
  '1h': '1 hour',
};

// Per-bucket duration in seconds — used as the divisor for `rate` (req/s) so
// that rate is "requests during this bucket / bucket length", not "requests
// during this bucket / window length". With the window divisor, a 1m bucket
// over a 1h window reports 1/60th of the real rate.
const BUCKET_SECONDS: Record<RedBucket, number> = {
  '1m': 60,
  '5m': 300,
  '1h': 3600,
};

const ROW_CAP = 100;

interface AggRow {
  bucket_start: string;
  grp: string | null;
  call_count: number | string;
  error_rate: number | string | null;
  rate: number | string | null;
  p50: number | string | null;
  p95: number | string | null;
  p99: number | string | null;
}

export async function computeRed(q: RedQuery): Promise<RedResult> {
  const db = getDbForDomain('traces');
  const groupCol = GROUP_COL[q.groupBy];
  const bucketInterval = BUCKET_INTERVAL[q.bucket];

  const fromIso = q.from.toISOString();
  const toIso = q.to.toISOString();
  const bucketSeconds = BUCKET_SECONDS[q.bucket];

  const filterVals: unknown[] = [];
  const filterClauses: string[] = [`${groupCol} IS NOT NULL`];
  if (q.filters?.service) {
    filterVals.push(q.filters.service);
    filterClauses.push('service_name = ?');
  }
  if (q.filters?.route) {
    filterVals.push(q.filters.route);
    filterClauses.push('http_route = ?');
  }
  if (q.filters?.container) {
    filterVals.push(q.filters.container);
    filterClauses.push('container_name = ?');
  }

  // `bucketInterval` and `bucketSeconds` are whitelist-mapped from a TS union —
  // no injection risk. Rate is divided by the BUCKET duration (in seconds)
  // not the window duration, so each bucket reports requests/sec correctly
  // regardless of (bucket vs window) ratio.
  const sql = `
    WITH agg AS (
      SELECT
        date_bin('${bucketInterval}'::interval, start_time, ?::timestamptz) AS bucket_start,
        ${groupCol} AS grp,
        count(*)::int AS call_count,
        (count(*) FILTER (WHERE status = 'error'))::float / NULLIF(count(*), 0) AS error_rate,
        count(*)::float / ${bucketSeconds} AS rate,
        percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms) AS p50,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95,
        percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms) AS p99
      FROM spans
      WHERE start_time >= ? AND start_time < ?
        AND ${filterClauses.join(' AND ')}
      GROUP BY bucket_start, grp
    ), ranked AS (
      SELECT *, row_number() OVER (PARTITION BY bucket_start ORDER BY call_count DESC) AS rn
      FROM agg
    )
    SELECT bucket_start, grp, call_count, error_rate, rate, p50, p95, p99
    FROM ranked
    WHERE rn <= ${ROW_CAP + 1}
    ORDER BY bucket_start, call_count DESC
  `;

  // Placeholders, in order:
  //   1: date_bin anchor → from
  //   2: lower bound     → from
  //   3: upper bound     → to
  //   4+: optional filter vals
  const sqlParams: unknown[] = [fromIso, fromIso, toIso, ...filterVals];

  const rows = await db.query<AggRow>(sql, sqlParams);

  const byBucket = new Map<string, RedRow[]>();
  let truncated = false;
  for (const r of rows) {
    const key = new Date(r.bucket_start).toISOString();
    const list = byBucket.get(key) ?? [];
    if (list.length >= ROW_CAP) {
      truncated = true;
      continue;
    }
    list.push({
      group: r.grp ?? '',
      rate: Number(r.rate ?? 0),
      errorRate: Number(r.error_rate ?? 0),
      p50Ms: Number(r.p50 ?? 0),
      p95Ms: Number(r.p95 ?? 0),
      p99Ms: Number(r.p99 ?? 0),
      callCount: Number(r.call_count ?? 0),
    });
    byBucket.set(key, list);
  }

  return {
    buckets: Array.from(byBucket.entries()).map(([bucketStart, rows]) => ({ bucketStart, rows })),
    truncated,
  };
}
