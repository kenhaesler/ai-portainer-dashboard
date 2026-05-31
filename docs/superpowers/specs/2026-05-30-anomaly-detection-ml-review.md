# Anomaly Detection — ML implementation review, defects, and a path to a proper pipeline

**Status:** Analysis / research (no code changed). Input for a follow-up redesign epic.
**Author:** Claude (paired with Simon)
**Date:** 2026-05-30
**Branch:** `worktree-feature+anomaly-detection-ml-review`
**Context:** Follow-up to epic #1291 (closed). #1291 tuned defaults and added per-user/feedback UX, but the underlying detection method was not re-architected. This document audits *how the ML detection is actually built*, catalogues concrete defects with `file:line` evidence, and synthesises external research on what a "proper" anomaly-detection pipeline looks like.

---

## 1. Executive summary

The Health & Monitoring "ML-Detected Anomalies" are produced by **five overlapping detectors** writing into one shared `insights` table:

| Detector | File | Method |
|---|---|---|
| Metric z-score / bollinger / "adaptive" | `anomaly-detector.ts`, `adaptive-anomaly-detector.ts` | Gaussian z-score over a 60-sample rolling window, CV-scaled threshold, Bollinger fallback |
| Hard threshold | `monitoring-service.ts:381` | Static `value > ANOMALY_THRESHOLD_PCT` |
| Isolation Forest | `isolation-forest.ts`, `isolation-forest-detector.ts` | Pure-JS tree ensemble on `[cpu, memory]` pairs |
| Trace p95 / error-rate | `trace-anomaly.ts` | Gaussian z-score + hard 5% floor, hour-of-day baseline, correlated suppression |
| Predictive | `monitoring-service.ts:489` | Linear-regression forecast to threshold |

The epic #1291 work (raise σ 2.5→3.0, window 20→60, contamination 0.15→0.05, CV scaling, hour-of-day baseline, per-service rate limit) **tuned the knobs but left the method naive.** The remaining false positives are now dominated by *structural* problems, not threshold values. The headline issues:

1. **The Isolation Forest is non-deterministic** (unseeded `Math.random()`), so it builds a different model on every 6-hour retrain — the same point flips anomalous/normal between retrains. This is a primary cause of the "alternates between anomalous and fine" complaint.
2. **The baseline includes the point under test** (`SELECT AVG/STDDEV … LIMIT 60` with no exclusion), causing self-masking and baseline poisoning.
3. **Statistics are non-robust** (mean/STDDEV), so the very outliers we want to catch corrupt the baseline that defines "normal".
4. **Detection is two-sided** on resource metrics — benign *drops* in CPU/memory are flagged as anomalies, ~doubling the false-positive rate.
5. **State (cooldowns, IF models, rate-limits) is in-memory** — wiped on restart (alert storms) and not shared across replicas (N× duplicate alerts).
6. **The per-user "sensitivity" feature post-filters by regex-parsing the human-readable description string**, and silently does nothing for Isolation Forest anomalies — so its contamination knob is dead code.
7. **There is no evaluation harness** — no precision/recall, no labelled set; the #1294 audit had to *proxy* the FP rate. We literally cannot measure whether a change helps.

None of these are fixed by changing a threshold. Sections 3–4 detail each with evidence; Section 5 lays out the target architecture and a prioritized roadmap.

---

## 2. How it is wired today (data flow)

```
scheduler → monitoring-service.runCycle()
  ├─ detectAnomaliesBatch (adaptive z-score, per container × {cpu,mem})        [§ metric path]
  │     └─ getMovingAverage / getMovingAverageByHourOfDay  (observability SQL)
  ├─ hard-threshold pass (value > ANOMALY_THRESHOLD_PCT)
  ├─ Isolation Forest pass (getOrTrainModel cache → predict)                    [§ IF path]
  ├─ predictive pass (capacity forecasts)
  └─ runTraceAnomalyCycle (computeRed → p95/error z-score)                       [§ trace path]
        ↓ all five write InsightInsert[] → insights table
read path: /api/monitoring/insights → shouldIncludeAnomaly() per-user filter → UI
```

Cooldown/suppression state lives in module-level `Map`s in each path; IF models live in a module-level `modelCache`.

---

## 3. Defects (correctness / structural — these cause the flapping)

### A1 — Isolation Forest is non-deterministic (unseeded RNG) 🔴
`isolation-forest.ts:40` (`splitFeature = Math.floor(Math.random()*nFeatures)`), `:56` (`splitValue = min + Math.random()*(max-min)`), `:112` (subsample index). Every retrain (`ISOLATION_FOREST_RETRAIN_HOURS=6`) builds a structurally different forest and re-derives `this.threshold` from a different random sample, so an unchanged `[cpu, memory]` point can be **anomalous in one model generation and normal in the next**. scikit-learn deliberately exposes `random_state` and its own example pins `random_state=0` for exactly this reason ([scikit-learn IsolationForest example]). The repo's *test* already uses a seeded Mulberry32 PRNG (`isolation-forest-detector.test.ts`) — production just needs the same seeding.
**Fix:** inject a seeded PRNG; derive the seed deterministically per `(containerId, retrain-window)` so a given window is reproducible.

### A2 — Baseline includes the sample under test (leakage) 🔴
`metrics-store.ts:83-101` `getMovingAverage` = `AVG(value), STDDEV_POP(value) … ORDER BY timestamp DESC LIMIT $3`. The current sample is part of the 60-row window it is then compared against (`monitoring-service.ts:333-344`). Two failure modes: **self-masking** (a spike inflates the std it is tested against, deflating its own z-score) and **baseline poisoning** (a sustained regression becomes "normal" within ~60 samples ≈ 1h). Same applies to the trace baseline (`trace-anomaly.ts` pulls a window up to `now`).
**Fix:** compute the baseline over a trailing window that *ends before* the evaluation point (exclude the current sample, ideally a short lag gap).

### A3 — "Sensitivity" filters by parsing description strings; dead for Isolation Forest 🔴
`sensitivity-preset.ts:98-105` recovers the z-score via `description.match(/z-score:\s*(…)/)`. But IF insights are written as `"Isolation Forest anomaly score: 0.55 …"` with **no `z-score:` token** (`monitoring-service.ts:473`), so `extractZScore` returns `null` and `shouldIncludeAnomaly` returns `true` unconditionally → **the contamination multiplier in `PRESET_MULTIPLIERS` (`sensitivity-preset.ts:43-47`) never affects anything.** Even if it were parsed, an IF score ∈ [0,1] can never exceed a 3.5 z-threshold, so threshold-filtering IF would suppress *all* IF anomalies. The code itself flags the regex as "LOAD-BEARING" (follow-up #1308).
**Fix:** persist `score` / `confidence` / `direction` as typed columns on `insights`; filter on data, not prose. (Unblocks evaluation too — see D1.)

### A4 — In-memory cooldown / model / rate-limit state (not restart- or replica-safe) 🟠
Module-level `Map`s: `trace-anomaly.ts:76,93,99`; `isolation-forest-detector.ts:15` (`modelCache`); `monitoring-service.ts` (`anomalyCooldowns`). On **restart** all cooldowns reset → first cycle re-fires every active anomaly (alert storm), and every IF model is gone → cold-start retrain of every container (and a detection gap while null). Across **replicas**, each process has its own cooldown/model, so dedup, cooldown, and the per-service rate limit are per-replica → up to N× duplicate alerts.
**Fix:** persist suppression/cooldown state and model snapshots in Postgres/Redis (shared).

### A5 — Isolation Forest pairs CPU & memory by array index, not timestamp 🟠
`isolation-forest-detector.ts:60-64` zips `cpuMetrics[i]` with `memoryMetrics[i]` ("metrics are collected together") and truncates to `min(len)`. Any dropped/missing sample or count mismatch misaligns the pair, so `cpu@t` trains against `mem@t+k` → fabricated multivariate outliers → false positives.
**Fix:** join CPU and memory by timestamp bucket before forming feature vectors.

---

## 4. Statistical-method weaknesses (the "naive" core)

### B1 — Non-robust mean/STDDEV everywhere 🟠
`anomaly-stats.ts:meanAndStd` and the SQL `AVG/STDDEV_POP`. Mean and standard deviation have a breakdown point of 0 — a single outlier corrupts the baseline meant to detect outliers. The production-standard alternative for spiky infra metrics is **median + MAD** (modified z-score `0.6745·(x−median)/MAD`) or a **Hampel filter**. VictoriaMetrics ships a production `MADModel` (`threshold` multiplier default 2.5, configurable direction) as a direct reference ([VictoriaMetrics MAD model]).

### B2 — Gaussian assumption on non-Gaussian metrics 🟠
z-score thresholds assume normality, but CPU/memory/latency are right-skewed, heavy-tailed, and often bimodal (idle vs active). A fixed σ over-fires on the fat tail. Prefer robust/quantile baselines (e.g. historical p99) or distribution-aware methods.

### B3 — Two-sided test flags benign drops 🟠
Metric path: `anomaly-detector.ts:131`, `adaptive-anomaly-detector.ts:121`, severity `Math.abs(z)>4` (`monitoring-service.ts:365`) all use `Math.abs`. A CPU/memory *drop* (z = −5) is surfaced as "Anomalous … usage", roughly doubling FP volume. The trace p95 path is correctly **one-sided** (`trace-anomaly.ts:385` `zScore > threshold`), so the codebase is internally inconsistent. VictoriaMetrics exposes `detection_direction: spike|drop|both` for precisely this.
**Fix:** default resource/latency detection to one-sided (spike).

### B4 — Isolation Forest threshold is fit in-sample; contamination forces flags 🟠
`isolation-forest.ts:119-123` derives the cutoff percentile from the *same* data used to build the trees (no holdout). By the definition of `contamination`, the threshold is the top-`contamination` fraction of training scores — so ~`contamination`% of *any* workload is flagged, even a perfectly healthy one ([towardsdatascience IF breakdown]; [scikit-learn outlier docs]). #1294 lowering 0.15→0.05 reduces the forced fraction but not the structural behaviour.
**Fix:** validate the threshold on a clean holdout, or for low-dimensional correlated metrics prefer **robust Mahalanobis distance**; reserve IF for genuinely higher-dimensional/independent features.

### B5 — Small, noisy seasonality baselines; no day-of-week 🟡
Hour-of-day buckets come from 1h buckets over 14 days → ≤14 samples per `(service, hour)` cell, with `minHourSamples` as low as 3 — `meanAndStd` over 3–14 points is itself unstable. Day-of-week seasonality is unmodeled. Production seasonality uses **STL decomposition** (Datadog) or week-over-week (`t` vs `t−7d`) baselines.

### B6 — Overloaded "adaptive" and duplicate CV schemes 🟡
`adaptive-anomaly-detector.ts:selectMethod` (cv<0.1→bollinger, cv>0.3→adaptive) is a *different* partition than `anomaly-stats.classifyCv` (0.1/0.3 → 1.0/1.2/1.5×). "adaptive" denotes three different things. Worse, **Bollinger at 2σ on low-CV services is *more* sensitive (~4.5% FP) than the 3.5σ baseline** — the "low variance" branch *increases* FPs on stable services, opposite to the goal.

---

## 5. Architecture, operational & evaluation gaps

- **C1 — No real feedback loop.** #1298 stores "false positive" labels but nothing consumes them — no threshold tuning, no retraining, no suppression of similar future anomalies. It's a display badge.
- **C2 — Sensitivity is a read-time post-filter, not detection-time.** Detectors write *all* anomalies; the incident correlator, notifications, and LLM context still see the full FP volume. Noise is hidden per-user, not reduced system-wide.
- **C3 — Five detectors, ad-hoc dedup.** Cross-detector dedup is a title-substring check (`monitoring-service.ts:396,444`) within one in-memory cycle; the trace path is separate. One root cause → multiple records.
- **C4 — Global thresholds; no per-entity learning.** One global config scaled by one global per-user multiplier; no per-service learned "normal".
- **C5 — No model persistence / cold-start strategy.** (see A4.)
- **D1 — No evaluation harness.** No precision/recall/PR-AUC, no labelled validation set; accuracy is meaningless at this class imbalance. Without measurement, tuning is guesswork.
- **D2 — No false-alarm budgeting.** Thresholds aren't derived from a target FP rate. At 1 sample/min, 3σ ≈ 0.27% ≈ ~4 FP/day/series — multiplied across services this *is* the observed fatigue.

---

## 6. Empirical A/B benchmark (this branch)

The dev TimescaleDB `metrics` hypertable is **empty (0 rows)**, so a replay on real history is impossible. Instead `scripts/anomaly-mad-ab-benchmark.mjs` (dependency-free, deterministic, seed `0x9E3779B9`) generates **labelled** synthetic series reproducing the failure modes above, so we can compute real precision/recall/F1 — the evaluation rig the system lacks (gap D1). Four detectors are compared on identical evaluation points (window 60, z-threshold 3.5, MAD-threshold 3.5):

- `current-zscore` — two-sided z over a window **including** the point under test (faithful to `getMovingAverage`).
- `current-adaptive` — approximates the production adaptive default (CV-scaled threshold; omits the Bollinger sub-path / `selectMethod` switching, so it is conservative — favourable to the current system).
- `robust-mad` — one-sided modified z (median+MAD) over a trailing window **excluding** the point.
- `robust-mad+3of5` — the above plus M-of-N persistence (≥3 of last 5).

| Scenario (what it probes) | current-zscore | current-adaptive | robust-mad | **robust-mad+3of5** |
|---|---|---|---|---|
| `clean_stable` — FP on quiet noise | 0 FP | 0 FP | 1 FP | **0 FP** |
| `benign_drops` — two-sided flaw (idle dips) | **30 FP** | 24 FP | 0 FP | **0 FP** |
| `true_spikes` — recall sanity | R=100% | R=88.9% | R=100% | R=33.3%¹ |
| `outlier_masking` — self-masking/leakage | **R=10%** | R=10% | R=52.5% | R=52.5%, P=100% |
| `heavy_tailed` — Gaussian mis-calibration | 42 FP | 39 FP | **129 FP²** | 10 FP |
| **OVERALL (pooled)** | FP=77, F1=24.2% | FP=68, F1=24.5% | FP=136, F1=31.1% | **FP=14, F1=53.8%, P=64.1%** |

**Headline:** the full combination cuts false alarms **~82% (77→14)** and **more than doubles F1 (24%→54%)**.

Three findings that shape the design — note these are honest, not cherry-picked:

1. **The production "adaptive" CV-scaling is marginal.** `current-adaptive` is within ~1 point of plain z-score on every scenario — empirical evidence that #1291's tuning was not a structural fix.
2. **Robust statistics alone are NOT a silver bullet (²).** On a bursty, right-tailed *benign* workload, one-sided MAD over-fires badly (129 FP) — because the robust spread is tight and treats every benign burst as a spike, whereas z-score's outlier-inflated σ accidentally absorbs them. Swapping the statistic without temporal filtering would *regress*.
3. **M-of-N persistence is what makes robust stats safe, but it trades away fast detection (¹).** Adding 3-of-5 collapses heavy_tailed 129→10 FP and makes outlier_masking precision 100%, but it misses 1–2-sample spikes (`true_spikes` recall 100%→33%). **This is exactly why a long persistence window must be paired with a short high-burn-rate window (Google SRE multi-window).** The benchmark motivates that pairing rather than assuming it.

Reproduce: `node scripts/anomaly-mad-ab-benchmark.mjs`. The harness is the seed of the P3 evaluation rig — swap synthetic scenarios for replayed real series once metric retention is in place.

> **Scoring caveat:** these are *point-wise* precision/recall/F1. The literature cited above (point-adjusted-F1 critique; affiliation metrics, arXiv:2206.13119) warns that point-wise scoring is a flawed proxy for time-series anomaly detection — so treat the numbers as **directional** (relative detector comparison), not rigorous quality scores. On zero-anomaly scenarios F1 is degenerate, so the raw FP count is the meaningful metric there. P3 (#1364) should adopt range/affiliation scoring on real labelled data.

## 7. What "proper" looks like — target architecture (research synthesis)

Ordered by leverage (impact ÷ effort), grounded in the cited sources:

1. **Robust univariate baselines** — median + MAD / modified z-score, per entity, **one-sided by default**, distribution-aware. Replaces mean/σ. Cheap, large FP reduction. (JS: implement directly or `simple-statistics`/`augurs`; reference: VictoriaMetrics MADModel.)
2. **Seasonality** — week-over-week + hour-of-day, or STL decomposition; compare the *residual* to a robust band. (Datadog uses STL/SARIMA.)
3. **Temporal filtering / persistence** — **M-of-N** (e.g. 3-of-5) plus **multi-window multi-burn-rate** (a short *and* a long window must both breach). Per Google SRE this is the single biggest alert-fatigue reducer; it replaces the blunt 10-min cooldown.
4. **Severity × confidence routing** — emit a continuous score + confidence; suppress low-confidence to a log tier; only high-severity + high-confidence surface prominently. (Elastic ML.)
5. **Determinism + shared state** — seed all RNG; move cooldown/suppression and model snapshots to Postgres/Redis (restart- and replica-safe).
6. **Multivariate done right** — robust Mahalanobis / robust covariance for correlated pairs (cpu/mem on DB nodes); reserve IF for higher-dimensional independent features with a clean-holdout-validated threshold; consider streaming **Half-Space Trees** (River) for online use.
7. **Evaluation harness + feedback loop** — persist labels (extend #1298), compute **PR-AUC / affiliation metrics** on a labelled window, tune thresholds to a false-alarm budget; re-run the #1294 audit script against prod for the real before/after. (NAB; affiliation-metrics; VUS.)
8. **Stop parsing presentation strings** — persist `score`/`confidence`/`direction` as typed columns on `insights` (planned #1308) so filtering and evaluation operate on data.
9. **Heavy ML (LSTM/VAE autoencoders)** — only behind a Python sidecar (PyOD/ADTK) and only if explainability is preserved; likely *not* worth it before 1–8 land.

### Prioritized roadmap

| Tier | Theme | Items | Effort | Impact |
|---|---|---|---|---|
| **P0** | Correctness quick wins | A1 seed IF RNG · A2 exclude current point · B3 one-sided · A4 persist cooldowns | S | Very high |
| **P1** | Statistical core | B1/B2 robust median+MAD baselines · A5 timestamp-join IF features · A3/#1308 typed score column | M | High |
| **P2** | Alerting discipline | M-of-N + multi-window · severity×confidence · move suppression system-wide (C2/C3) | M | High |
| **P3** | Rigor | Evaluation harness PR-AUC + labelled set (D1/D2) · feedback into thresholds (C1) · seasonality upgrade STL/WoW (B5) | L | High (compounding) |
| **P4** | Optional | robust Mahalanobis / streaming HST · Python sidecar for deep models | L | Situational |

A useful framing: **P0 stops the flapping, P1 stops the over-firing, P2 stops the spam, P3 lets us prove it.**

---

## 8. Sources

Code (this repo, branch `worktree-feature+anomaly-detection-ml-review`):
- `packages/ai-intelligence/src/services/{anomaly-detector,adaptive-anomaly-detector,isolation-forest,isolation-forest-detector,trace-anomaly,anomaly-stats,sensitivity-preset,monitoring-service}.ts`
- `packages/observability/src/services/metrics-store.ts` (`getMovingAverage`, `getMovingAverageByHourOfDay`)
- `packages/core/src/config/env.schema.ts` (anomaly/IF/trace defaults)
- `docs/superpowers/specs/2026-05-27-anomaly-detector-audit.md` (#1294 audit)

External (via Ref docs + Gemini research):
- scikit-learn — IsolationForest example (pins `random_state=0`): https://scikit-learn.org/1.4/auto_examples/ensemble/plot_isolation_forest.html
- scikit-learn — outlier/novelty detection (contamination semantics): https://scikit-learn.org/1.4/modules/outlier_detection.html
- VictoriaMetrics — MAD (Median Absolute Deviation) model + `detection_direction`: https://docs.victoriametrics.com/anomaly-detection/components/models/
- River (online ML) — ADWIN drift detection / streaming anomaly (Half-Space Trees): https://riverml.xyz/latest/api/drift/ADWIN/
- Google SRE Workbook — Alerting on SLOs (multi-window, multi-burn-rate): https://sre.google/workbook/alerting-on-slos/
- Datadog — Anomaly monitors (STL/SARIMA seasonality): https://docs.datadoghq.com/monitors/types/anomaly/
- Netflix — Surus / Robust PCA: https://netflixtechblog.com/introducing-surus-and-the-robust-pca-algorithm-8b297669623
- PyOD — anomaly-detection algorithms / multivariate: https://pyod.readthedocs.io/
- Numenta Anomaly Benchmark (NAB) methodology: https://numenta.com/assets/pdf/numenta-anomaly-benchmark/NAB-paper.pdf
- "Local Evaluation of Time Series Anomaly Detection Algorithms" (affiliation metrics; critique of point-adjusted F1): https://arxiv.org/abs/2206.13119
- VUS — Volume Under the Surface (threshold-independent evaluation): https://www.vldb.org/pvldb/vol15/p1256-paparrizos.pdf
- Hampel filter / MAD robustness for spiky signals: https://pubmed.ncbi.nlm.nih.gov/24715406/

> **Provenance note:** External research was performed via the local Gemini CLI (two passes: ML methods; evaluation + alerting) and Ref documentation lookups, per the requested workflow. Code findings were verified directly against the files at the `file:line` anchors above.

---

## 9. Outcome (as shipped — 2026-05-31)

The redesign shipped as epic **#1360** with four children plus a seasonality follow-up, all merged to `dev`:

| Phase | Issue | Delivered |
|---|---|---|
| P0 — determinism | #1361 | Seeded Isolation Forest RNG (FNV-1a → Mulberry32), baseline-leakage fix (exclude point-under-test), one-sided detection (`ANOMALY_DETECTION_DIRECTION`), Redis-backed cooldown + persistence stores. |
| P1 — robust statistics | #1362 | Median + MAD modified z-score (default `robust-mad`), one-sided, timestamp-joined IF features; hour-of-day seasonality preserved. |
| P2 — alerting discipline | #1363 | M-of-N (3-of-5) + multi-window fast-burn, cross-detector dedup, severity × confidence routing, system-wide suppression floor. |
| P3 — eval + feedback | #1364 | PR-AUC eval rig + CI regression guard; #1298 labels → measured FP rate → gated auto-tune (`ANOMALY_AUTOTUNE_ENABLED`, default off, audited). |
| Seasonality | #1307 | day-of-week × hour-of-day baseline; mean/std path moved onto the `metrics_1hour` continuous aggregate (exact pop-stats via the law of total variance), robust path adds a day-of-week filter on its raw query. |

**Measured (synthetic labelled benchmark, `scripts/anomaly-mad-ab-benchmark.mjs`, seed `0x9E3779B9`):**

- Full pipeline (`robust-mad + 3-of-5`) vs the original `current-zscore`, pooled across 5 failure-mode scenarios: **false positives 77 → 14 (−82%)**, **F1 24.2% → 53.8%** (≈2.2×) — matching the projection that justified the epic.
- Seasonality A/B (weekly-pattern series, baseline varied in isolation): a day-of-week × hour baseline cuts false alarms **183 → 41 (−78%)** vs a flat trailing window while preserving 100% spike recall. Production stacks persistence (P2) on top of this.

The benchmark remains synthetic: the dev TimescaleDB `metrics` hypertable is empty, so the **production before/after audit** (`scripts/audit-anomaly-detectors.ts`) against real history is the **one open item** on epic #1360 — it needs a prod data export or a live deploy. The CI eval-rig guards (`packages/ai-intelligence/src/services/anomaly-eval.ts`) assert both the robust-vs-z-score and the seasonal-vs-flat improvements on every PR.
