# Anomaly detector runtime audit + config-default rationale (#1294)

**Status:** Design — drives the implementation in PR feature/1294-anomaly-config-defaults.
**Author:** simon
**Date:** 2026-05-27
**Closes:** #1294 (child A of epic #1291)

## Goals

1. **Audit:** quantify which detector (trace, isolation-forest, metric-zscore, predictive, log-pattern) currently dominates false-positive volume on the Health & Monitoring page.
2. **Use the audit** to either confirm or revise the ordering of the remaining epic #1291 children (B–E).
3. Capture the rationale for the five config-default adjustments shipped in this PR (fixes 1, 4, 5, 7, 8).

## Detector inventory (anchor — same table as epic #1291)

| Detector | Symbol used in audit | Existing defaults (pre-#1294) |
|---|---|---|
| Trace p95 | `trace:latency_p95` | z-score 2.5σ vs 24h baseline |
| Trace error rate | `trace:error_rate` | abs floor 5% + baseline+1pp |
| Metric z-score | `metric-zscore:cpu`, `metric-zscore:memory` | 3.5σ over 20-sample window |
| Isolation Forest | `isolation-forest:multivariate` | contamination 0.15 |
| Predictive | `predictive` | LR forecast over `PREDICTIVE_ALERT_THRESHOLD_HOURS` |

The runtime audit script lives at [`scripts/audit-anomaly-detectors.ts`](../../../scripts/audit-anomaly-detectors.ts). It groups rows from the `insights` table by detector source over the last 14 days and estimates a false-positive share using the proxies available today (described below).

## Why this audit is provisional

The schema currently exposes:

- `insights.is_acknowledged BOOLEAN`
- `incidents.status` ∈ {`active`, `resolved`} + `incidents.resolved_at`

There is **no explicit `false_positive` disposition column** today — that lands in #1298. Until then we estimate FP share as

```
fp_share ≈ ( is_acknowledged WITHOUT a still-active follow-up incident )
         + ( insights whose only correlated incident self-resolved within 10 min and was never acknowledged )
         / total_insights
```

Both proxies overcount (e.g. an acknowledged but real incident that the operator simply silenced) and undercount (e.g. an unread real anomaly that the user never opened). Treat the numbers as **directional**, not measurements.

## Results

> **Synthetic-data caveat.** Dev has produced **zero** trace anomalies since
> #1236 merged and only a handful of isolation-forest insights — not enough
> to anchor a real audit. The numbers below were generated from the same
> 7-day synthetic seed used by `docs/superpowers/specs/2026-05-16-1200-dedup-telemetry-design.md`,
> projected forward two weeks. Re-run `scripts/audit-anomaly-detectors.ts`
> against prod after this PR has been deployed for ≥ 7 days and revise the
> table below. Until then the recommended ordering of #1291-B…E falls back
> to the default order documented in the epic body.

| Detector | Total anomalies (14d) | Critical | Warning | Info | Est. FP share | Suggested ordering for #1291-B…E |
|---|---|---|---|---|---|---|
| `isolation-forest:multivariate` | 412 | 18 | 311 | 83 | **~62%** | Highest-yield: #1291-B should attack this. Most of the volume comes from contamination=0.15 pushing 15% of stable readings into the anomaly class by construction. #1294 already lowers this to 0.05. |
| `metric-zscore:cpu` | 218 | 9 | 174 | 35 | ~38% | Mostly traffic-ramp false positives — #1291-B (CV variance scaling + hour-of-day baseline) targets this directly. Confirm next. |
| `trace:latency_p95` | 96 | 4 | 71 | 21 | ~41% | 2.5σ is too sensitive on stable services with low variance. #1294 raises to 3.0σ; #1291-B's CV variance scaling will further tighten this on cyclic traffic. |
| `trace:error_rate` | 58 | 7 | 46 | 5 | ~22% | Flat 5% floor; #1291-C correlated-suppression collapses paired p95+error spikes into one record. |
| `metric-zscore:memory` | 41 | 2 | 31 | 8 | ~31% | Mirrors CPU pattern. |
| `predictive` | 22 | 1 | 17 | 4 | ~9% | Lowest noise share — defer until later in the epic. |
| `log-pattern` | 14 | 0 | 12 | 2 | ~14% | Out of epic scope. |

### Recommended ordering for epic #1291 children

Based on the synthetic-projected FP share, **the default ordering documented in #1291 (B → C → D → E) stands**:

1. **#1291-B (CV variance scaling + hour-of-day baseline)** — largest expected
   impact on `metric-zscore:cpu` and `trace:latency_p95`, the two highest-
   volume noisy detectors after isolation-forest is calibrated by this PR.
2. **#1291-C (correlated suppression)** — addresses the trace p95+error_rate
   pairing and is a prerequisite for credible per-detector FP rates in the
   #1298 feedback loop.
3. **#1291-D (sensitivity preset UI)** — operator-facing only after the
   underlying detectors are tuned.
4. **#1291-E (feedback loop + false-positive table)** — last because it
   depends on real labelled data, which the prior steps make safe to collect.

If the post-rollout audit reveals **trace anomalies dominating** after #1294 (FP share > 50% on either trace branch), bump #1291-C ahead of #1291-B. Otherwise hold the order.

The recommended-ordering comment on epic #1291 mirrors the table above.

## Config-default changes shipped in this PR

| Fix | Variable | Before | After | Why |
|---|---|---|---|---|
| 1 | `TRACES_ANOMALY_P95_ZSCORE` | 2.5 | **3.0** | At 2.5σ a Gaussian baseline produces ~1.2% false-positive samples; 3.0σ drops that to ~0.27%. Matches the metric-detector posture. |
| 4 | `ANOMALY_MOVING_AVERAGE_WINDOW` | 20 | **60** | 20 samples (~20 min) over-reacts to morning traffic ramps and other short-lived bursts. 60 (~1h) smooths these while preserving sensitivity to sustained shifts. |
| 5 | `ISOLATION_FOREST_CONTAMINATION` | 0.15 | **0.05** | Contamination calibrates the threshold so the top fraction of training scores are "anomalous". 0.15 means ~15% of stable workloads' points are flagged by definition. 0.05 aligns with the broader 2.5–3σ regime. |
| 7 | per-service rate limit | — | **`TRACES_ANOMALY_PER_SERVICE_MIN=5`** | The pre-existing 10-min cooldown was per-(service, metric_type), letting a single flapping service emit both a latency_p95 and an error_rate anomaly back to back. New per-service ceiling caps a service to one anomaly per 5 min regardless of metric_type. |
| 8 | trace-path warm-up | (effective floor of 3 samples) | **`TRACES_ANOMALY_MIN_SAMPLES=10`** | The trace detector previously only required `>= 3` baseline buckets — a brand-new service could fire on its first hour of data. Mirroring `ANOMALY_MIN_SAMPLES = 10` makes the trace and metric paths consistent. |

### Determinism for the isolation-forest regression test (fix 5)

`packages/ai-intelligence/src/services/isolation-forest-detector.test.ts`
pins the new contamination default with a deterministic synthetic series:

- **RNG:** Mulberry32 ([reference](https://github.com/bryc/code/blob/master/jshash/PRNGs.md#mulberry32)). 32-bit single-state, full 2^32 period, BigCrush-passing — adequate for a sanity-check synthetic.
- **Seed:** `0x9E3779B9` (the golden-ratio fractional bits — commonly used hash-mix constant; any fixed 32-bit value is fine because Mulberry32 has full period).
- **Training series:** 950 (cpu, memory) pairs of Gaussian noise σ=0.1 around (cpu=50, memory=60), plus 50 explicit outliers at (80, 90). The outliers seat the contamination=0.05 threshold above the noise floor, mirroring how the forest is calibrated in production where real anomalies do exist.
- **Evaluation series:** 1000 fresh Gaussian-noise samples drawn from the *same* clean distribution (no outliers).
- **Assertion:** ≤ 1% of those clean-eval samples are flagged. Pre-fix (contamination=0.15) the threshold sits much lower in the score distribution and well over 1% of clean samples trip it — the regression value of the lowered default. Without the outlier injection, evaluating same-distribution samples would floor at ≈ contamination% by construction (algorithmic property: the threshold is a percentile of training scores), which would test API plumbing rather than real-world FP behaviour.

Both the seed and the Gaussian shape are documented in the test header so reviewers can reproduce the run.

## Verification gate

- `npm run lint` — clean
- `npm run typecheck` — clean
- `npx vitest run -w packages/ai-intelligence` — covers the new burst-case, warm-up, and contamination tests
- `npx vitest run -w packages/core` — covers env-schema defaults

## Out of scope

- A proper `insights.false_positive` disposition column (lands in #1298).
- UI sensitivity presets (#1297).
- CV variance scaling + hour-of-day baseline (#1295).
- Correlated suppression of paired p95+error_rate spikes (#1296).
