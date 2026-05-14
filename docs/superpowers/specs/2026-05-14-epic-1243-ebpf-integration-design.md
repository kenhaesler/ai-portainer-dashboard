# Epic #1243 — Integrate Beyla eBPF Trace Data Across the Dashboard

**Status:** Draft for review
**Date:** 2026-05-14
**Owner:** simon (with Claude agent teams)
**Scope:** 10 child issues (#1233–#1242)
**Delivery:** 3 phased PRs into `dev`

---

## 1. Motivation

The dashboard already ingests Beyla OTLP spans into a 60+ column `spans` table and surfaces them on a single Trace Explorer page. Every other surface — Network Topology, Container Detail, Workloads, Anomaly Detection, Logs, LLM Observability, Security Audit — treats this signal as if it doesn't exist. Meanwhile, there is no retention or sampling on the ingest path, so the trace store is one chatty fleet away from a slow-burn disk-fill incident.

This epic threads eBPF trace data through the existing pages **and** adds the operational guardrails the pipeline needs before fleet rollout.

## 2. Phasing

The epic is delivered as three PRs, in order. Each PR is mergeable and adds value on its own; later phases depend on earlier ones.

| PR  | Phase            | Issues                          | Why this grouping                                                                                                                                                                       |
| --- | ---------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Enablers**     | #1234 RED, #1241 retention, #1242 sampling | Backend-only. RED unblocks half the page work. Retention + sampling protect the database the moment more pages start querying / more agents start writing. Ship together to land all operational risk in one review. |
| 2   | **RED-consumer pages** | #1233 topology, #1235 container detail, #1237 workloads | Three frontend integrations that all read `/api/traces/red` or `/api/traces/service-map`. Cohesive review (same hook, same empty-state pattern, same Trace-Explorer deep-link convention). |
| 3   | **Advanced integrations** | #1236 anomaly, #1238 logs ↔ traces, #1239 LLM latency, #1240 security destinations | Each integration touches a different consuming service (anomaly detector, logs viewer, LLM observability page, security audit + migration). Independent surfaces, can be implemented in parallel worktrees and merged together. |

PR scope rules:

- Each PR ships its own tests (backend Vitest + Postgres integration, frontend Vitest + RTL, E2E where the user-visible behaviour warrants it).
- Each PR updates `.env.example`, `CLAUDE.md` env-var section, and `docs/ebpf-trace-ingestion.md`.
- Each PR is `feature/1243-phase{N}-<slug> → dev`.
- Phase 1 must merge before Phases 2 or 3 start touching frontend; Phases 2 and 3 can be built concurrently after Phase 1 lands locally (we do not need them merged into `dev` to start the next branch — only the local trunk needs the new endpoint).

## 3. Architectural decisions

### 3.1 Single read API for "RED" — `GET /api/traces/red`

We do **not** add per-page SQL aggregations. Every page that wants rate/errors/duration goes through the same endpoint with different `groupBy` / filter parameters. Rationale:

- Cardinality and percentile correctness live in one place (and one test surface).
- Caching, sampling-aware compensation, and future continuous-aggregate migration are local to one module.
- The `truncated: true` flag is uniform.

### 3.2 Sampling and retention are policies, not knobs you set per page

Pages always query `/api/traces/red` over the **full** retained window. Sampling/retention are enforced at ingest and on a daily job; consumers never see them. This keeps page code dumb and keeps the policy auditable from a single config surface.

### 3.3 No new packages

All work fits inside existing packages:

- `packages/observability/` — RED endpoint, retention job, sampler, ingest-stats endpoint, logs viewer query-param wiring (frontend side lives in `frontend/`).
- `packages/ai-intelligence/` — trace-driven anomaly detection.
- `packages/security/` — observed-destinations service + rule store.
- `packages/server/src/scheduler.ts` — new retention job entry.
- `frontend/src/features/...` — page integrations.

### 3.4 Observer-only throughout

No mutation paths. The Security observed-destinations panel **flags**; it never blocks, firewalls, or alerts on the box. Action workflows route through the existing Remediation Approval system in a follow-up.

### 3.5 Graceful no-Beyla degradation (epic acceptance criterion)

Every page that integrates trace data renders a uniform empty-state component when `/api/traces/red` returns zero rows for the visible window: small inline panel with a `Deploy Beyla` CTA linking to `/security/ebpf-coverage`. New shared component `frontend/src/features/observability/components/no-trace-data-callout.tsx` to avoid copy-pasting empty states.

## 4. Cross-cutting work (Phase 1)

These are referenced by multiple per-issue specs.

### 4.1 `packages/observability/src/services/trace-red.ts`

```ts
export interface RedQuery {
  from: Date;
  to: Date;
  bucket: '1m' | '5m' | '1h';
  groupBy: 'service' | 'route' | 'container' | 'namespace';
  filters?: { service?: string; route?: string; container?: string; endpointId?: number };
}

export interface RedBucket {
  bucketStart: string; // ISO
  rows: RedRow[];
}

export interface RedRow {
  group: string;       // value of the groupBy column
  rate: number;        // req/s
  errorRate: number;   // 0..1
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  callCount: number;
}

export async function computeRed(query: RedQuery): Promise<{ buckets: RedBucket[]; truncated: boolean }>;
```

SQL skeleton (Postgres ≥ 13, uses `percentile_cont`):

```sql
SELECT
  date_trunc($bucket, start_time) AS bucket_start,
  <groupByExpr>                   AS grp,
  count(*)                        AS call_count,
  count(*) FILTER (WHERE status = 'error')::float / NULLIF(count(*), 0) AS error_rate,
  count(*)::float / EXTRACT(EPOCH FROM ($to - $from)) AS rate,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms) AS p50_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms) AS p99_ms
FROM spans
WHERE start_time >= $from AND start_time < $to
  AND <filterClause>
GROUP BY bucket_start, grp
ORDER BY bucket_start
LIMIT 100;
```

- Cap rows at 100 per bucket; emit `truncated: true` when capped.
- Uses `idx_spans_source_time` and the existing `idx_spans_service`, `idx_spans_container_name`, etc. No new index required.
- Zod validation for querystring; route registered in `routes/traces.ts` as `GET /api/traces/red` so it sits next to existing `/api/traces/summary`.

### 4.2 `packages/observability/src/services/trace-retention.ts`

```ts
export async function cleanOldSpans(days: number): Promise<{ deleted: number }>;
```

- Reads `TRACES_RETENTION_DAYS` (default 7).
- `DELETE FROM spans WHERE start_time < now() - $1::interval` batched at 10k rows/iteration to keep DELETE locks short.
- Wired into `packages/server/src/scheduler.ts` alongside `cleanOldMetrics`.

### 4.3 `packages/observability/src/services/trace-sampler.ts`

```ts
export interface SamplerStats {
  acceptedTotal: number;
  droppedTotal: number;
  perSource: Map<string, { accepted: number; dropped: number; lastWarnedAt: number }>;
}

export function shouldAccept(span: SpanInsert): boolean;
export function getStats(): SamplerStats;
```

- **Head sampling**: deterministic on `trace_id` hash so all spans of a trace travel together. Comparison is `(hash & 0xFFFF) / 0xFFFF < TRACES_SAMPLE_RATE`. Default 1.0 (off).
- **Per-source rate limit**: token bucket keyed by `service_namespace || service_name`. Tokens refill at `TRACES_INGEST_MAX_SPANS_PER_SEC`; default `0` = unbounded. On overflow drop and log a once-per-minute `warn` with cumulative drop count.
- Applied in `traces-ingest.ts` immediately after `transformOtlpToSpans` and before `insertSpans`.
- New endpoint `GET /api/traces/ingest-stats` (authenticated, admin) returns `{ accepted, dropped, perSource: [...] }`. Tail-sampling deferred to a follow-up.

### 4.4 Env additions (Phase 1)

```bash
TRACES_RETENTION_DAYS=7
TRACES_SAMPLE_RATE=1.0
TRACES_INGEST_MAX_SPANS_PER_SEC=0     # 0 = unbounded
TRACES_ANOMALY_P95_ZSCORE=2.5         # Phase 3, but documented now
TRACES_ANOMALY_ERROR_RATE_PCT=5       # Phase 3, but documented now
LLM_PEER_HOSTNAMES=api.anthropic.com,api.openai.com,api.mistral.ai,api.deepseek.com,api.groq.com
```

## 5. Per-issue specs

### 5.1 #1234 — RED endpoint  *(Phase 1)*

**Files:**
- `packages/observability/src/services/trace-red.ts` (new)
- `packages/observability/src/services/trace-red.test.ts` (new, unit tests on SQL builder)
- `packages/observability/src/routes/traces.ts` (add route)
- `packages/observability/src/routes/traces-red.test.ts` (new, integration test against seeded `spans`)
- `docs/ebpf-trace-ingestion.md` (extend "Read API" section)

**Acceptance:** see issue. Zod validation, `truncated` flag, percentile_cont, honours `getDbForDomain('traces')`.

### 5.2 #1241 — Retention  *(Phase 1)*

**Files:**
- `packages/observability/src/services/trace-retention.ts` (new)
- `packages/observability/src/services/trace-retention.test.ts` (new)
- `packages/server/src/scheduler.ts` (call `cleanOldSpans` daily inside the existing cleanup interval near `cleanOldMetrics`)
- `packages/core/src/config/env.schema.ts` (add `TRACES_RETENTION_DAYS`)
- `.env.example`, `CLAUDE.md` env section, `docs/ebpf-trace-ingestion.md`

**Acceptance:** batched DELETE, logs rows deleted, uses existing `idx_spans_time`.

### 5.3 #1242 — Sampling + ingest guardrails  *(Phase 1)*

**Files:**
- `packages/observability/src/services/trace-sampler.ts` (new)
- `packages/observability/src/services/trace-sampler.test.ts` (new — head sample distribution test, rate-limit drop test, warning suppression test)
- `packages/observability/src/routes/traces-ingest.ts` (call `shouldAccept` between transform and insert; bump `acceptedTotal` / `droppedTotal`)
- `packages/observability/src/routes/traces.ts` (add `GET /api/traces/ingest-stats`, admin-only)
- `frontend/src/features/security/pages/ebpf-coverage.tsx` (small "Trace ingest" panel calling the new endpoint)
- `packages/core/src/config/env.schema.ts` (add sampler env)
- `.env.example`, `CLAUDE.md`, `docs/ebpf-trace-ingestion.md`

**Acceptance:** decision before insert, no DB lookup in the hot path, admin role required on stats endpoint.

### 5.4 #1233 — Network Topology RPC overlay  *(Phase 2, frontend-only)*

**Files:**
- `frontend/src/features/observability/hooks/use-service-map.ts` (new — small wrapper around existing `/api/traces/service-map`, returns nodes/edges)
- `frontend/src/features/containers/pages/network-topology.tsx` (merge edges, header toggle)
- `frontend/src/features/containers/components/network/topology-graph.tsx` (accept observed edges with weight/colour props)
- `frontend/src/features/containers/pages/network-topology.test.tsx`

**Acceptance:** as per issue. Edge thickness `log1p(callCount)`; colour ramp green < 1% < amber < 5% < red. Cap 100 edges (sorted by callCount desc). Toggle default on when any trace data exists in last 24h.

### 5.5 #1235 — Container Detail Calls tab  *(Phase 2, frontend-only)*

**Files:**
- `frontend/src/features/observability/hooks/use-red.ts` (new — wraps `/api/traces/red`)
- `frontend/src/features/containers/components/container-traces-tab.tsx` (new)
- `frontend/src/features/containers/pages/container-detail.tsx` (add tab)
- `frontend/src/features/containers/components/container-traces-tab.test.tsx`

**Acceptance:** four panels (RED summary, top outgoing, top incoming, latency sparkline). All filters scoped by `containerName`. Empty-state via `<NoTraceDataCallout/>`. Each row deep-links into `/observability/trace-explorer?trace=<id>`.

### 5.6 #1237 — Workloads RED columns  *(Phase 2, frontend-only)*

**Files:**
- `frontend/src/features/containers/pages/workload-explorer.tsx` (add 3 columns; single batched RED fetch with `groupBy=service`)
- `frontend/src/features/containers/pages/workload-explorer.test.tsx`

**Acceptance:** one HTTP call per refresh (not N), distinct "no data" vs "0 traffic" cell, sortable columns, deep link to Trace Explorer.

### 5.7 #1236 — Trace anomaly detection  *(Phase 3, backend)*

**Files:**
- `packages/ai-intelligence/src/services/trace-anomaly.ts` (new — pulls RED via in-process function, not HTTP)
- `packages/ai-intelligence/src/services/trace-anomaly.test.ts`
- `packages/ai-intelligence/src/services/monitoring-service.ts` (wire trace-anomaly into the existing cycle)
- `packages/core/src/config/env.schema.ts` (already added in Phase 1)

**Acceptance:** two metric families (`latency_p95`, `error_rate`) feed adaptive z-score detector; anomalies write to existing predictive-alerts table; no UI change. Sampled logs (max 1/min per series).

### 5.8 #1238 — Trace ↔ logs correlation  *(Phase 3, frontend-only)*

**Files:**
- `frontend/src/features/observability/pages/trace-explorer.tsx` (span drawer: add "View logs" link)
- `frontend/src/features/observability/pages/log-viewer.tsx` (accept `from`, `to`, `trace`, `containerId` query params; banner; filter input)
- `frontend/src/features/observability/lib/log-viewer.ts` (substring filter for trace id)
- `frontend/src/features/observability/pages/log-viewer.test.tsx`

**Acceptance:** filter via query params + manual input, banner with "Disable filter" clears it. Pure frontend.

### 5.9 #1239 — LLM latency breakdown  *(Phase 3, full-stack)*

**Files:**
- `packages/ai-intelligence/src/services/llm-client.ts` (emit correlation ID + optional outbound header `x-trace-correlation-id`)
- `frontend/src/features/ai-intelligence/pages/llm-observability.tsx` (new "Latency breakdown" panel — calls `/api/traces?netPeerName=<each-in-LLM_PEER_HOSTNAMES>` and aggregates)
- `frontend/src/features/ai-intelligence/components/llm-latency-breakdown.tsx` (new)
- Tests for matching by correlation ID and graceful degradation when no match.

**Acceptance:** stacked bar per provider; empty-state via shared callout when no LLM spans.

### 5.10 #1240 — Security observed destinations  *(Phase 3, full-stack)*

**Files:**
- `packages/core/src/db/postgres-migrations/032_security_destination_rules.sql` (new; default rules: RFC1918 + `localhost` → allow, public Internet → warn)
- `packages/security/src/services/observed-destinations.ts` (new — aggregation + rule matching by CIDR / hostname suffix)
- `packages/security/src/services/observed-destinations.test.ts`
- `packages/security/src/routes/security.ts` or equivalent — add `GET /api/security/observed-destinations` (admin role)
- `frontend/src/features/security/pages/security-audit.tsx` (add panel below findings)
- `frontend/src/features/security/components/observed-destinations-panel.tsx` (new)

**Acceptance:** as per issue. Hostnames may be sensitive → admin-only endpoint, never leaked to non-admin sessions.

## 6. Testing strategy

- **Backend unit:** every new service module gets a Vitest file in the same dir; pure SQL builders test against a real Postgres via `test-db-helper.ts` (`POSTGRES_TEST_URL`).
- **Backend integration:** every new route gets a route test that builds a real Fastify app, decorates `authenticate` with the project's standard test helper, seeds `spans`, and exercises the route. Mocks only at HTTP boundaries (Portainer, LLM provider).
- **Frontend:** Vitest + RTL. Mock `globalThis.fetch`; render component; assert empty/loading/full states.
- **Regression-security:** sampler tests live in `backend/src/routes/security-regression-infra.test.ts` (rate-limit DoS protection) and observed-destinations tests live in `security-regression-rbac.test.ts` (admin-only).
- **E2E (optional, Phase 2 only):** one Playwright smoke that loads `/containers/<id>` and asserts the Calls tab renders without error.

## 7. Risk and rollout

| Risk | Mitigation |
| --- | --- |
| RED endpoint pegs the trace DB on large windows | Result-row cap of 100, default windows ≤ 24h, percentile_cont is sub-quadratic, indexes already present. |
| Retention DELETE locks `spans` for too long | Batched delete; runs daily off-peak (matches existing cleanup interval). |
| Sampler drops too aggressively | Defaults are no-op (`rate=1.0`, `limit=0`). Ops opts in deliberately. |
| Anomaly detector fires on cold start | Adaptive z-score already has a warm-up period; reuse it. |
| Observed-destinations leaks hostnames to non-admin | Route guarded by `requireRole('admin')`; regression test added. |
| Trace-id substring filter shows nothing if app didn't log the ID | Banner explicitly says "Lines without this ID are hidden" — failure is legible. |

## 8. Out of scope (deferred)

- Continuous aggregates / TimescaleDB compression on `spans`.
- Tail sampling (#1242 acknowledges this).
- Auto-injection of `trace_id` into application logs (#1238 acknowledges this).
- UI for managing `security_destination_rules` — v1 ships seeded defaults only.
- Per-route remediation actions on suspicious destinations.

## 9. Acceptance checklist (epic-level)

- [ ] All 10 child issues closed by their corresponding PRs.
- [ ] No regression in Trace Explorer / eBPF Coverage / existing pages without trace data.
- [ ] `docs/ebpf-trace-ingestion.md` extended with a "Consumer pages" section listing every integration point.
- [ ] `.env.example` lists every new env var with a one-line description.
- [ ] `CLAUDE.md` env section updated.
- [ ] Each integrated page degrades gracefully with `<NoTraceDataCallout/>`.
