# Incident-engine dedup telemetry + research-question decisions (#1200)

**Status:** Design — drives the implementation in this PR.
**Author:** simon
**Date:** 2026-05-16
**Closes:** #1200
**Follows:** #1195 (architectural context), #1199 (code-level dedup fixes shipped 2026-05-07)

## Goals

1. **Telemetry**: emit per-signature aggregate ratios so the next round of engine work is data-driven instead of guessed.
2. **Decisions**: document a position on each of the five research questions and the Confirmed Issue 2 (non-anomaly correlation) decision from #1195.

The PR ships the telemetry and the runnable analysis script. The decisions are recommendations grounded in the synthetic-data analysis below — they're explicit so the next engine PR has somewhere to start, not a final ruling.

## Findings

> **Synthetic data caveat.** Dev has been running monitoring for 22h since #1199 merged but has produced **zero** insights/incidents (no anomalies have fired). The numbers below were generated from a 7-day synthetic seed at `/tmp/seed-1200-analysis.sql` (320 insights, 15 incidents, 8 containers, 8 signatures). They are **illustrative of the shape** of expected production data, not real measurements. Run `scripts/analyze-dedup-engine.sql` against prod once data has accrued, then revise this doc.

### Q1 — alerts_per_container ratio per derived signature

| signature | total_insights | distinct_containers | alerts_per_container |
|---|---|---|---|
| `anomaly:threshold:cpu` | 144 | 8 | **18.00** |
| `anomaly:ml-anomaly:memory` | 48 | 8 | 6.00 |
| `log:pattern` | 40 | 8 | 5.00 |
| `ai:analysis` | 32 | 8 | 4.00 |
| `security:scan` | 24 | 8 | 3.00 |
| `predictive:prediction:memory` | 16 | 8 | 2.00 |
| `anomaly:threshold:disk` | 8 | 8 | 1.00 |
| `predictive:prediction:disk` | 8 | 8 | 1.00 |

The threshold-CPU detector dominates emissions ~3× the next-loudest signature. In prod this is the first place to tighten cooldowns.

### Q2 — insights_per_incident per signature

| signature | total_incidents | avg_insights_per_incident |
|---|---|---|
| `anomaly:ml-anomaly:memory` | 5 | 6.00 |
| `predictive:prediction:memory` | 5 | 2.00 |
| `anomaly:threshold:cpu` | 5 | **18.00** |

Correlation is doing its job for the anomaly category — 18 raw CPU insights collapse into 1 incident per container. The LLM summarizer downstream sees ~5–6× compression on average.

### Q3 — emission share by category

| category | total | pct |
|---|---|---|
| anomaly | 200 | 62.5 |
| log-analysis | 40 | 12.5 |
| ai-analysis | 32 | 10.0 |
| security | 24 | 7.5 |
| predictive | 24 | 7.5 |

**37.5%** of all emissions today bypass `correlateInsights()` entirely (only `category === 'anomaly'` enters correlation, per `incident-correlator.ts:56`).

### Q4 — dedup headroom for non-anomaly categories

| category | insights | would_be_deduped | pct_deduped |
|---|---|---|---|
| log-analysis | 40 | 32 | 80.0% |
| ai-analysis | 32 | 24 | 75.0% |
| security | 24 | 16 | 66.7% |
| predictive | 24 | 8 | 33.3% |

Log, AI-analysis, and security categories would shed 67–80% of their volume if grouped by `(signature, container_name)`. Predictive only sheds ~33% — predictions are mostly naturally distinct (different time horizons, different metrics).

## Decisions

### RQ1 — Should non-anomaly insights form / join incidents?

**Yes for `security`, `log-analysis`, `ai-analysis`. Yes for `predictive` but with a longer dedup window. Implementation deferred to a follow-up PR.**

| Category | Eligible for `correlateInsights()` | Rationale |
|---|---|---|
| anomaly | ✓ (today) | Already wired |
| security | ✓ (proposed) | Q4: 67% dedup headroom; signature is stable (`security:scan`) |
| log-analysis | ✓ (proposed) | Q4: 80% headroom; same log pattern fires every poll until resolved |
| ai-analysis | ✓ (proposed) | Q4: 75% headroom; LLM re-runs produce duplicate findings |
| predictive | ✓ (proposed, separate TTL) | Q4: 33% headroom; predictions inherently span longer horizons (see RQ2) |
| config / other | ✗ | Volume too low; correlation overhead exceeds win |

**Dedup key:** `(signature, container_name)` — same shape as the current anomaly path, no new key derivation needed. `signature` is already populated for incidents and derivable for insights via `deriveSignature()`.

**Why this isn't shipped in this PR:** it changes `correlateInsights()` semantics and would conflate analysis with implementation. We need this PR to ship the telemetry so a future PR can A/B the change against real ratios. Once `monitoring_dedup_metrics` rows accrue for a week post-merge, the follow-up PR has a baseline to compare against.

### RQ2 — Right dedup TTL for predictions

**Per-category TTL, default 60min, overrides as below.**

| Category | TTL | Why |
|---|---|---|
| anomaly | 60 min (current) | Matches metric collection cadence; anomalies often re-resolve within the hour |
| security | 6 h | Scan results don't change minute-to-minute |
| log-analysis | 30 min | Logs are continuous; tighter window prevents spam from a single noisy pattern |
| ai-analysis | 2 h | LLM re-runs are paced; 2h matches the analysis interval |
| predictive | **24 h** | A "memory exhaustion in 24 hours" prediction should not re-fire 24 times before the window elapses |

**Implementation hook:** add `getDedupWindowMs(category)` returning per-category milliseconds, called from `insights-store.ts` where `DEDUP_WINDOW_MINUTES` is used today. The constant becomes a function. Deferred to the same follow-up PR as RQ1.

### RQ3 — Do the three dedup layers conflict?

**Yes, they key on different shapes. Recommendation: keep three layers but unify the key as `signature`.**

| Layer | File | Key today | Recommended key |
|---|---|---|---|
| 1. Detection cooldown | `monitoring-service.ts:58` (`anomalyCooldowns` Map) | `${containerId}:${metricType}` | `${containerId}:${signature}` |
| 2. Insertion dedup | `insights-store.ts:8` (`DEDUP_WINDOW_MINUTES`) | structured fields OR title slug | `signature` |
| 3. Incident correlation | `incident-correlator.ts:206` (`groupByContainerAndMetric`) | `(container_id, metric_type)` | `(container_id, signature)` |

Why three layers, not one: they fire at different points in the pipeline (pre-detection / pre-insert / post-insert) and serve different purposes (CPU savings vs DB pressure vs UX rollup). Collapsing them into one would lose the CPU savings of layer 1.

Why unify the key: today's keys overlap partially. `metricType` ≠ `signature` because two detectors on the same metric (e.g. threshold vs ML-anomaly) collide on layer 1 but split on layer 3. After unification, the layers agree on what "the same event" means.

**Implementation hook:** introduce a single `dedupKey(insight) → signature` helper in `signature.ts`. Replace the three call-site key derivations with calls to that helper. Deferred follow-up.

### RQ4 — Actual emission distribution

**Top offender: `anomaly:threshold:cpu`** (illustrative — 3× the next-loudest signature in the synthetic data; expected to be similar in prod).

**Engine targets, in priority order:**

1. Tighten `anomaly:threshold:cpu` cooldown (longest cooldown of any signature)
2. Audit `anomaly:ml-anomaly:memory` for whether the ML detector is re-firing on the same anomaly band
3. Once non-anomaly categories enter correlation, re-measure — log/ai/security shouldn't sit in the top emitters anymore

The new `monitoring_dedup_metrics` table this PR adds is the long-term source for this list — operators can `SELECT * FROM monitoring_dedup_metrics ORDER BY collected_at DESC, alerts_per_container DESC` to see the current top emitters at any point.

### RQ5 — Should the LLM summarizer take the deduped incident or the raw insight stream?

**Deduped incident (current behaviour). Keep.**

Q2 shows the correlation engine produces ~6× compression on average (18 insights → 1 incident for high-volume signatures). If we tightened dedup further by adopting the RQ1+RQ2 changes, compression rises. Feeding raw insights would waste prompt budget and lose the human-meaningful grouping.

**No code change required.** Documented here so the follow-up PRs don't accidentally route raw streams to the LLM.

### Confirmed Issue 2 (from #1195) — non-anomaly insights joining `correlateInsights()`

Covered by RQ1 above. **Yes** for security / log-analysis / ai-analysis / predictive, with `(signature, container_name)` as the dedup key and per-category TTL (RQ2). Deferred to the follow-up PR.

## What this PR ships

### Telemetry

- **Migration 033** (`packages/core/src/db/postgres-migrations/033_monitoring_dedup_metrics.sql`): new `monitoring_dedup_metrics` table with one row per `(signature, collected_at)` and columns for the four metrics from Q1/Q2 plus a window-length tag.
- **Service** (`packages/ai-intelligence/src/services/dedup-telemetry.ts`):
  - `collectDedupMetrics({ db })` — runs the four aggregation queries, returns rows for insertion.
  - `runDedupTelemetryCycle({ db })` — the scheduler-callable wrapper that collects + inserts + logs.
- **Store** (`packages/ai-intelligence/src/services/dedup-telemetry-store.ts`): `insertDedupMetrics(rows)`, `getLatestDedupMetrics(limit)`.
- **Scheduler hook** (`packages/server/src/scheduler.ts`): registers the new job at **1-hour cadence**. Rationale: the underlying SQL is cheap (indexed on `signature`, `created_at`); hourly captures intraday variance without flooding the table; the new table grows ~24 rows per signature per day.
- **Route** (`packages/ai-intelligence/src/routes/dedup-telemetry.ts`): `GET /api/dedup-telemetry` returning the latest snapshot. **Admin-only** via `fastify.requireRole('admin')` (sensitive: exposes signature-level emission rates that could inform an attacker about detection coverage).
- **Tests** (`packages/ai-intelligence/src/__tests__/dedup-telemetry.test.ts`): real-Postgres integration tests covering the four query shapes, the per-signature rollup, the route auth gate, and idempotency under repeated cycles.

### Runnable analysis script

`scripts/analyze-dedup-engine.sql` — the four queries above, runnable against any environment. Drop into prod psql once data has accumulated.

## What this PR does NOT ship

- The RQ1 / RQ2 / RQ3 code changes themselves. Those are the next PR (call it #1200-followup), once the new `monitoring_dedup_metrics` table has a week of real data to baseline against.
- Any change to `correlateInsights()`, `insights-store.ts`, or `monitoring-service.ts` dedup logic.
- A Prometheus exporter. The `monitoring_dedup_metrics` table is the data sink; if the operator wants Prometheus scraping later, they can add an exporter on top of the table. Choosing DB over Prom here because we want historical comparison (week-over-week deltas), not just current values.

## Test plan

- [x] `scripts/analyze-dedup-engine.sql` runs against the dev DB (with synthetic seed) and produces the tables above.
- [ ] Migration 033 applies cleanly on a fresh DB.
- [ ] Telemetry job collects metrics from a seeded DB and inserts the expected rows.
- [ ] `GET /api/dedup-telemetry` rejects non-admin requests (401/403).
- [ ] Scheduler doesn't crash if the job throws (existing pattern from `runCleanup`).
- [ ] Full backend test suite green.
- [ ] tsc + eslint clean.

## Open follow-ups (out of scope for this PR)

1. **#1200-followup** — adopt the RQ1/RQ2/RQ3 changes, gated on the telemetry baseline.
2. **Prometheus exporter** — only if operators ask. The table is the canonical source.
3. **Grafana board** — top-emitter dashboard from the new table. Lives in `docs/observability/` if added.
4. **Migration-runner idempotency bug** — orthogonal pre-existing issue noted during epic #1243 work; new migrations don't always auto-apply on test DBs. Not blocking this PR but should be fixed separately.
