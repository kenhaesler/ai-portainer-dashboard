# AI & Anomaly Detection Techniques

The monitoring pipeline runs a multi-phase analysis on every cycle (cadence is configurable via `MONITORING_INTERVAL_MINUTES`). Each technique operates independently and degrades gracefully when its prerequisites are unavailable. Detector internals live in `packages/ai-intelligence/src/services/`; defaults are defined in `packages/core/src/config/env.schema.ts` and documented in the [configuration reference](configuration.md).

> **Recent tuning (issues #1294–#1298).** The pipeline was reworked to cut false positives and add a human-in-the-loop feedback signal: a wider moving-average window, lower Isolation Forest contamination, an hour-of-day seasonal baseline, coefficient-of-variation (CV) threshold scaling, a per-user false-positive feedback loop, and per-user sensitivity presets. Each is described below.

## Statistical Anomaly Detection

Anomalies are detected per-container, per-metric from historical time-series. The **adaptive** detector (`adaptive-anomaly-detector.ts`) picks a method per series based on its coefficient of variation (CV = σ/μ):

| Method | Algorithm | Selected when |
|--------|-----------|---------------|
| **Bollinger Bands** | mean ± k·σ channel | very stable series (`CV < 0.1`) |
| **Z-Score** | deviation from rolling mean/σ | moderate variance (`0.1 ≤ CV < 0.3`), or `< 20` samples |
| **Adaptive (CV-scaled z-score)** | z-score with threshold scaled by CV regime | naturally noisy series (`CV ≥ 0.3`) |

**CV threshold scaling** (`anomaly-stats.ts`) widens the effective z-threshold for noisy workloads and keeps it tight for stable ones:

| CV regime | Range | Threshold multiplier |
|-----------|-------|----------------------|
| low | `CV < 0.1` | 1.0× |
| medium | `0.1 ≤ CV < 0.3` | 1.2× |
| high | `CV ≥ 0.3` | 1.5× |

> Note (#1295): very stable services now use a **1.0×** multiplier (previously 1.2×). After upgrading, expect a one-time uptick in alerts on historically quiet, low-variance services — this is intentional and surfaces previously-suppressed anomalies.

### Hour-of-day seasonal baseline (#1295)

Instead of a single flat 24h baseline, the detector compares each observation against the baseline for the **same UTC hour** over a lookback window. This eliminates false positives during predictable diurnal ramps (morning traffic, nightly batch). When an hour bucket hasn't warmed up, it falls back to the flat baseline.

| Variable | Default | Meaning |
|----------|---------|---------|
| `ANOMALY_HOUROFDAY_LOOKBACK_DAYS` | `14` | Days of history per hour-of-day bucket |
| `ANOMALY_HOUROFDAY_MIN_SAMPLES` | `3` | Min samples in a bucket before it's used (else flat fallback) |

### Core configuration

| Variable | Default | Meaning |
|----------|---------|---------|
| `ANOMALY_DETECTION_METHOD` | `robust-mad` | Detection strategy. `robust-mad` (default, #1362) uses median + MAD (modified z-score), outlier-resistant; `adaptive`/`zscore`/`bollinger` are the mean/std methods (rollback). |
| `ANOMALY_DETECTION_DIRECTION` | `spike` | Which deviations are flagged: `spike` (increases only), `drop` (decreases only), or `both` (legacy two-sided). Resource/latency drops are rarely incidents, so flagging them doubled false positives (#1361). |
| `ANOMALY_ZSCORE_THRESHOLD` | `3.5` | Base z-score threshold (before CV scaling) |
| `ANOMALY_MOVING_AVERAGE_WINDOW` | `60` | Rolling window in samples (~1h at 60s cadence; raised from 20 in #1294) |
| `ANOMALY_MIN_SAMPLES` | `10` | Warm-up minimum before detection activates |
| `ANOMALY_PERSISTENCE_ENABLED` | `true` | M-of-N persistence + multi-window gate (#1363). An anomaly must persist before it surfaces; `false` = legacy (surface every raw anomaly). |
| `ANOMALY_PERSISTENCE_M` / `ANOMALY_PERSISTENCE_N` | `3` / `5` | Confirm only when ≥ M of the last N cycles are anomalous — suppresses isolated benign blips. |
| `ANOMALY_FAST_BURN_MULTIPLIER` | `2` | A severe single sample (severity ≥ this × threshold) bypasses persistence and surfaces immediately (short high-burn-rate window). |
| `ANOMALY_COOLDOWN_MINUTES` | `30` | Per-container/metric cooldown to prevent alert spam |
| `BOLLINGER_BANDS_ENABLED` | `true` | Enable the Bollinger method |

## Isolation Forest (ML)

A from-scratch Isolation Forest (zero external dependencies) detects multivariate anomalies that per-metric methods miss. Anomalous points isolate with fewer random splits, yielding shorter average path lengths.

**How it works:**
1. Training data is built from 7 days of `[cpu, memory]` pairs per container (**minimum 50 samples**).
2. A forest of randomized isolation trees is built from random subsamples.
3. Each point's anomaly score is `2^(-E(h(x)) / c(n))`, where `c(n)` is the expected path length of an unsuccessful BST search.
4. Points above the contamination threshold are flagged.

**Key properties:** considers CPU and memory simultaneously; per-container model caching with a configurable retrain interval; skips containers already flagged by statistical detection; falls back silently when data is insufficient.

| Variable | Default | Meaning |
|----------|---------|---------|
| `ISOLATION_FOREST_ENABLED` | `true` | Feature toggle |
| `ISOLATION_FOREST_TREES` | `100` | Trees per forest |
| `ISOLATION_FOREST_SAMPLE_SIZE` | `256` | Subsample size per tree |
| `ISOLATION_FOREST_CONTAMINATION` | `0.05` | Expected anomaly fraction (lowered from 0.15 in #1294) |
| `ISOLATION_FOREST_RETRAIN_HOURS` | `6` | Model cache TTL / retrain interval |

## Trace Anomaly Detection

For services with distributed traces (Beyla/OTLP — see [eBPF Trace Ingestion](ebpf-trace-ingestion.md)), `trace-anomaly.ts` runs two parallel detectors per service using the same hour-of-day + CV-scaling machinery:

- **Latency (p95):** CV-scaled z-score vs baseline; when σ is 0, a relative rule fires if `p95 > mean + max(0.5·mean, 50ms)`.
- **Error rate (%):** absolute threshold + baseline comparison (fires at ≥ threshold and above baseline + 1pp).

Same-minute anomalies for one service collapse into a **single multi-dimensional insight** (#1296). Severity is `critical` past 2× the effective threshold, else `warning`.

| Variable | Default | Meaning |
|----------|---------|---------|
| `TRACES_ANOMALY_P95_ZSCORE` | `3.0` | p95 latency z-threshold (raised from 2.5 in #1294) |
| `TRACES_ANOMALY_ERROR_RATE_PCT` | `5` | Error-rate threshold (%) |
| `TRACES_ANOMALY_PER_SERVICE_MIN` | `5` | Per-service rate limit: max 1 anomaly / N min |
| `TRACES_ANOMALY_MIN_SAMPLES` | `10` | Baseline warm-up before a service is eligible |

A **10-minute per-dimension cooldown** sits on top of the per-service rate limit.

## Predictive Alerting

Linear regression on recent metric trends forecasts time-to-threshold and emits predictive insights. Only fires for increasing trends with medium/high confidence.

| Time to threshold | Severity |
|-------------------|----------|
| < 6 hours | Critical |
| 6–12 hours | Warning |
| 12–24 hours | Info |

Configuration: `PREDICTIVE_ALERTING_ENABLED`, `PREDICTIVE_ALERT_THRESHOLD_HOURS`.

## Anomaly Explanations & NLP Log Analysis (LLM)

When an LLM endpoint is available, detected anomalies are sent (with metric values, container info, and baseline) for a plain-English explanation appended to the insight. Separately, recent container logs can be analyzed for error/warning patterns that metric detection misses, producing `log-analysis` insights. Both are skipped when the LLM is unavailable.

Configuration: `ANOMALY_EXPLANATION_ENABLED`, `ANOMALY_EXPLANATION_MAX_PER_CYCLE`, `NLP_LOG_ANALYSIS_ENABLED`, `NLP_LOG_ANALYSIS_MAX_PER_CYCLE`, `NLP_LOG_ANALYSIS_TAIL_LINES`.

## Root Cause Investigation (LLM)

Triggered automatically on critical anomalies. The investigation service gathers metrics, logs, and container config, sends them to the LLM for deep-dive analysis, and stores the result as an investigation linked to the triggering insight.

Configuration: `INVESTIGATION_ENABLED`, `INVESTIGATION_COOLDOWN_MINUTES`, `INVESTIGATION_MAX_CONCURRENT`.

## Smart Alert Grouping (Incident Correlation)

`incident-correlator.ts` correlates insights into incidents within a 5-minute window using strategies applied in order:

| Strategy | Trigger | Confidence |
|----------|---------|------------|
| **Dedup** | Same container + metric type | high |
| **Cascade** | Same endpoint, multiple containers, ≥ 2 distinct anomaly types | high (3+) / medium |
| **Temporal** | Any insights on the same endpoint in window | medium |
| **Semantic** | Jaccard text similarity over titles/descriptions (union-find clustering) | medium |

When the LLM is available and `INCIDENT_SUMMARY_ENABLED` is on, grouped incidents get an LLM-generated relationship summary; otherwise a rule-based summary is used.

Configuration: `SMART_GROUPING_ENABLED`, `SMART_GROUPING_SIMILARITY_THRESHOLD` (default `0.3`), `INCIDENT_SUMMARY_ENABLED`.

## Anomaly Feedback Loop (#1298)

Any authenticated user can flag an anomaly as a false positive; the row is always scoped to the caller's `user_id` (no spoofing). Feedback is stored in `anomaly_feedback` with a unique `(anomaly_id, user_id)` constraint, so submissions are idempotent.

- `POST /api/monitoring/anomaly-feedback` — body `{ anomalyId, disposition?, detector? }`. The `detector` field is restricted to an allowlist (`threshold`, `ml-anomaly`, `prediction`, `health-check`, `log-pattern`, `security-scan`, `correlated-zscore`, `isolation-forest`) so client input can't pollute the per-detector breakdown.
- `GET /api/monitoring/anomaly-feedback/rates` — per-detector false-positive rates. Admins receive **fleet-wide** aggregates (counts per detector only, never individual user dispositions); `?scope=mine` returns caller-scoped data. Non-admins are always caller-scoped, even if they pass `?scope=fleet`.

## Per-User Sensitivity Presets (#1297)

Each user can tune how aggressively anomalies are surfaced **to them**, without affecting detection globally. The preset is stored in `user_settings` under `monitoring.sensitivity_preset` and applied as a post-filter on the caller's z-score.

| Preset | Z-threshold multiplier | Effect |
|--------|------------------------|--------|
| `low` | 1.3× (stricter) | Fewer alerts — alert-fatigue reduction |
| `default` | 1.0× | Baseline |
| `high` | 0.85× (looser) | More alerts — higher sensitivity |

- `GET /api/monitoring/sensitivity` → `{ preset }` (defaults to `default`)
- `PUT /api/monitoring/sensitivity` ← `{ preset }`

> **Contract caveat:** the post-filter extracts the z-score by parsing the detector's `z-score: X.YZ` string in the insight description. If that format changes, the filter silently degrades to pass-through (every insight shown). Keep the substring stable, or migrate to a typed column.

## Graceful Degradation

All AI features degrade gracefully based on available infrastructure:

| Feature | LLM down | Insufficient data |
|---------|----------|-------------------|
| Statistical detection | Works (no LLM needed) | Falls back to fewer methods / flat baseline |
| Isolation Forest | Works (no LLM needed) | Skipped (< 50 samples) |
| Trace anomaly detection | Works (no LLM needed) | Skipped (< `TRACES_ANOMALY_MIN_SAMPLES`) |
| Predictive alerting | Works (no LLM needed) | Skipped (low confidence) |
| Anomaly explanations | Skipped | N/A |
| NLP log analysis | Skipped entirely | Skipped (empty logs) |
| Root cause investigation | Skipped | N/A |
| Smart alert grouping | Text similarity still works | N/A |
| Incident summaries | Rule-based fallback | N/A |
| Anomaly feedback / sensitivity | Works (no LLM needed) | N/A |
