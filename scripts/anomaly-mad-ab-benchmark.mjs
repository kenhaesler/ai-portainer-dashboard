#!/usr/bin/env node
/**
 * Anomaly detection A/B benchmark — current z-score vs robust median+MAD.
 *
 * WHY THIS EXISTS
 * ---------------
 * The dev TimescaleDB `metrics` hypertable is empty, so we cannot A/B on real
 * history. Instead this generates LABELLED synthetic series that reproduce the
 * failure modes documented in
 *   docs/superpowers/specs/2026-05-30-anomaly-detection-ml-review.md
 * Because we control which points are true anomalies, we can compute real
 * precision / recall / F1 — the evaluation rig the system lacks today (gap D1).
 *
 * Self-contained: zero dependencies, zero repo imports, deterministic
 * (seeded Mulberry32). Run with:  node scripts/anomaly-mad-ab-benchmark.mjs
 *
 * DETECTORS (faithful to the production code as of this branch)
 *   current-zscore   : two-sided z over a 60-sample window that INCLUDES the
 *                      point under test (mirrors getMovingAverage ORDER BY ts
 *                      DESC LIMIT 60 — anomaly-detector.ts). threshold 3.5.
 *   current-adaptive : an APPROXIMATION of the production adaptive default
 *                      (adaptive-anomaly-detector.ts) — it models the CV-scaled
 *                      threshold (1.0/1.2/1.5x) but NOT the Bollinger sub-path
 *                      or selectMethod() switching. Bollinger at 2σ on low-CV
 *                      series would add more false positives, so this is a
 *                      conservative (favourable-to-current) stand-in.
 *   robust-mad       : one-sided modified z = 0.6745*(x-median)/MAD over a
 *                      60-sample trailing window that EXCLUDES the point under
 *                      test (no leakage). threshold 3.5 (Iglewicz-Hoaglin).
 *
 * SCORING CAVEAT — point-wise, not range-aware
 * --------------------------------------------
 * This harness scores each sample independently (point-wise precision/recall/
 * F1). The time-series anomaly-detection literature this work cites warns that
 * point-wise scoring is a flawed proxy (see point-adjusted-F1 critique and
 * affiliation metrics, arXiv:2206.13119). The numbers here are DIRECTIONAL —
 * useful for relative comparison of detectors, not as rigorous quality scores.
 * On zero-anomaly scenarios (clean_stable, benign_drops) F1 is degenerate
 * (precision=recall=1 by convention with no positives), so the raw FP count is
 * the meaningful metric there. The P3 evaluation rig (#1364) should adopt
 * range/affiliation-based scoring on real labelled data.
 */

const WINDOW = 60;          // ANOMALY_MOVING_AVERAGE_WINDOW default
const Z_THRESHOLD = 3.5;    // ANOMALY_ZSCORE_THRESHOLD default
const MAD_THRESHOLD = 3.5;  // modified z-score cutoff (Iglewicz & Hoaglin)
const START = WINDOW;       // first index both detectors evaluate (full window)

// ── deterministic RNG (Mulberry32, same family the IF test uses) ────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rng, mean, sd) {
  // Box-Muller
  const u = Math.max(rng(), 1e-12), v = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ── statistics ──────────────────────────────────────────────────────────────
function meanStd(xs) {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n; // population (STDDEV_POP)
  return { mean, std: Math.sqrt(variance) };
}
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function cvRegimeMult(mean, std) {
  if (!(mean > 0)) return 1.0;
  const cv = std / mean;
  if (cv < 0.1) return 1.0;
  if (cv < 0.3) return 1.2;
  return 1.5;
}

// ── detectors: return boolean[] aligned to values (null before START) ───────
function detectCurrentZ(values, { adaptive }) {
  const out = new Array(values.length).fill(null);
  for (let i = START; i < values.length; i++) {
    const win = values.slice(i - WINDOW + 1, i + 1); // INCLUDES current point i
    const { mean, std } = meanStd(win);
    const thr = adaptive ? Z_THRESHOLD * cvRegimeMult(mean, std) : Z_THRESHOLD;
    if (std === 0) {
      const tol = Math.max(Math.abs(mean) * 0.1, 0.01);
      out[i] = Math.abs(values[i] - mean) > tol; // two-sided
    } else {
      out[i] = Math.abs((values[i] - mean) / std) > thr; // TWO-SIDED
    }
  }
  return out;
}
function detectRobustMad(values) {
  const out = new Array(values.length).fill(null);
  for (let i = START; i < values.length; i++) {
    const win = values.slice(i - WINDOW, i); // EXCLUDES current point (ends at i-1)
    const med = median(win);
    const mad = median(win.map((x) => Math.abs(x - med)));
    if (mad === 0) {
      const tol = Math.max(Math.abs(med) * 0.1, 0.01);
      out[i] = values[i] - med > tol; // ONE-SIDED (spike only)
    } else {
      const mz = (0.6745 * (values[i] - med)) / mad;
      out[i] = mz > MAD_THRESHOLD; // ONE-SIDED
    }
  }
  return out;
}

/**
 * Seasonal robust median+MAD (#1307): instead of a flat trailing window, compare
 * each point against the RAW prior samples in its (day-of-week × hour-of-day)
 * bucket — faithful to the production robust path, which narrows its raw query by
 * day-of-week rather than pooling hourly averages. The point under test is
 * excluded (added to its bucket only after scoring). Points whose bucket has
 * < minHistory prior samples are warm-up (null). One-sided, like the flat robust
 * detector. (One sample per weekly phase would give an unstable MAD — the very
 * "buckets too small" problem #1307 fixes with a wider lookback + raw samples.)
 */
function detectSeasonalBucketMad(values, dow, hod, minHistory = 8) {
  const out = new Array(values.length).fill(null);
  const buckets = new Map(); // (dow*24+hod) → prior raw samples
  for (let i = 0; i < values.length; i++) {
    const key = dow[i] * 24 + hod[i];
    const hist = buckets.get(key);
    if (hist && hist.length >= minHistory) {
      const med = median(hist);
      const mad = median(hist.map((x) => Math.abs(x - med)));
      if (mad === 0) {
        const tol = Math.max(Math.abs(med) * 0.1, 0.01);
        out[i] = values[i] - med > tol;
      } else {
        out[i] = (0.6745 * (values[i] - med)) / mad > MAD_THRESHOLD;
      }
    }
    if (hist) hist.push(values[i]);
    else buckets.set(key, [values[i]]);
  }
  return out;
}

// ── scenarios: { name, why, values[], labels[] } (label=true → real anomaly) ─
function buildScenarios() {
  const rng = mulberry32(0x9e3779b9);
  const S = [];

  // S1 clean_stable — gaussian, NO anomalies. Measures baseline false alarms.
  {
    const N = 2000, values = [], labels = [];
    for (let i = 0; i < N; i++) { values.push(gauss(rng, 50, 1.5)); labels.push(false); }
    S.push({ name: 'clean_stable', why: 'stable CPU, no incidents → any flag is a false alarm', values, labels });
  }

  // S2 benign_drops — periodic low-usage lulls (NORMAL). Targets the two-sided flaw.
  {
    const N = 2000, values = [], labels = [];
    for (let i = 0; i < N; i++) {
      let v = gauss(rng, 50, 1.5);
      const inDip = i > 0 && i % 240 < 6; // 6-sample lull every 4h
      if (inDip) v = gauss(rng, 30, 1.5); // idle period — not an incident
      values.push(v); labels.push(false); // dips are NORMAL
    }
    S.push({ name: 'benign_drops', why: 'idle-period CPU dips are normal; two-sided z flags them', values, labels });
  }

  // S3 true_spikes — clear upward incidents (ANOMALY). Sanity: both should catch.
  {
    const N = 2000, values = [], labels = [];
    const spikeAt = new Set([400, 401, 402, 900, 901, 1500, 1501, 1502, 1503]);
    for (let i = 0; i < N; i++) {
      if (spikeAt.has(i)) { values.push(gauss(rng, 92, 2)); labels.push(true); }
      else { values.push(gauss(rng, 50, 1.5)); labels.push(false); }
    }
    S.push({ name: 'true_spikes', why: 'unambiguous upward incidents → recall sanity check', values, labels });
  }

  // S4 outlier_masking — sparse benign micro-blips inflate the rolling std, then a
  //    genuine sustained regression. Targets self-masking (leakage) → current misses it.
  {
    const N = 2000, values = [], labels = [];
    const blip = new Set([150, 350, 550, 750]); // single-sample benign transients (NORMAL)
    for (let i = 0; i < N; i++) {
      if (blip.has(i)) { values.push(gauss(rng, 95, 2)); labels.push(false); continue; }
      if (i >= 1000 && i < 1040) { values.push(gauss(rng, 66, 1.5)); labels.push(true); continue; } // real regression
      values.push(gauss(rng, 50, 1.5)); labels.push(false);
    }
    S.push({ name: 'outlier_masking', why: 'prior benign blips inflate σ; current masks a real +16 regression', values, labels });
  }

  // S5 heavy_tailed — right-skewed bursty noise (NORMAL bursts) + a few real spikes.
  //    Targets the Gaussian assumption: σ over-fires / mis-calibrates on skew.
  {
    const N = 2000, values = [], labels = [];
    const realSpike = new Set([700, 701, 1300, 1301, 1302]);
    for (let i = 0; i < N; i++) {
      if (realSpike.has(i)) { values.push(gauss(rng, 99, 1)); labels.push(true); continue; }
      // base 40 with a one-sided exponential-ish tail (benign bursts up to ~75)
      const burst = rng() < 0.12 ? -Math.log(Math.max(rng(), 1e-9)) * 9 : 0;
      values.push(40 + Math.abs(gauss(rng, 0, 2)) + burst); labels.push(false);
    }
    S.push({ name: 'heavy_tailed', why: 'skewed bursty workload; Gaussian σ mis-calibrates, robust MAD holds', values, labels });
  }

  return S;
}

/**
 * M-of-N persistence filter (the P2 recommendation): only confirm a flag when
 * at least `m` of the last `n` per-point decisions fired. Suppresses isolated
 * single-sample benign bursts while preserving sustained regressions.
 */
function persistMofN(flags, m = 3, n = 5) {
  const out = new Array(flags.length).fill(null);
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === null) continue;
    let seen = 0, hits = 0;
    for (let j = i; j > i - n && j >= 0; j--) {
      if (flags[j] === null) break;
      seen++;
      if (flags[j]) hits++;
    }
    out[i] = seen === n ? hits >= m : false;
  }
  return out;
}

// ── scoring ─────────────────────────────────────────────────────────────────
function score(flags, labels) {
  let tp = 0, fp = 0, fn = 0, tn = 0, evaluated = 0;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === null) continue;
    evaluated++;
    if (flags[i] && labels[i]) tp++;
    else if (flags[i] && !labels[i]) fp++;
    else if (!flags[i] && labels[i]) fn++;
    else tn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : 1;
  const recall = tp + fn ? tp / (tp + fn) : 1;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { tp, fp, fn, tn, evaluated, precision, recall, f1 };
}

const pct = (x) => (x * 100).toFixed(1).padStart(5);
function row(label, m) {
  return `  ${label.padEnd(18)} FP=${String(m.fp).padStart(4)}  FN=${String(m.fn).padStart(3)}  ` +
    `P=${pct(m.precision)}%  R=${pct(m.recall)}%  F1=${pct(m.f1)}%`;
}

// ── run ─────────────────────────────────────────────────────────────────────
const scenarios = buildScenarios();
const detectors = [
  ['current-zscore', (v) => detectCurrentZ(v, { adaptive: false })],
  ['current-adaptive', (v) => detectCurrentZ(v, { adaptive: true })],
  ['robust-mad', (v) => detectRobustMad(v)],
  ['robust-mad+3of5', (v) => persistMofN(detectRobustMad(v), 3, 5)],
];

const totals = new Map(detectors.map(([n]) => [n, { tp: 0, fp: 0, fn: 0, tn: 0 }]));

console.log('\n=== Anomaly detection A/B: current z-score vs robust median+MAD ===');
console.log(`window=${WINDOW}  z-threshold=${Z_THRESHOLD}  mad-threshold=${MAD_THRESHOLD}  (seed=0x9E3779B9)\n`);

for (const sc of scenarios) {
  const anomalies = sc.labels.filter(Boolean).length;
  console.log(`▶ ${sc.name}  (${sc.values.length} pts, ${anomalies} true-anomaly pts)`);
  console.log(`    ${sc.why}`);
  for (const [name, fn] of detectors) {
    const m = score(fn(sc.values), sc.labels);
    console.log(row(name, m));
    const t = totals.get(name);
    t.tp += m.tp; t.fp += m.fp; t.fn += m.fn; t.tn += m.tn;
  }
  console.log('');
}

console.log('=== OVERALL (all scenarios pooled) ===');
for (const [name] of detectors) {
  const t = totals.get(name);
  const m = score(
    [...Array(t.tp).fill(true), ...Array(t.fp).fill(true), ...Array(t.fn).fill(false), ...Array(t.tn).fill(false)],
    [...Array(t.tp).fill(true), ...Array(t.fp).fill(false), ...Array(t.fn).fill(true), ...Array(t.tn).fill(false)],
  );
  console.log(row(name, m));
}
console.log('');

// ── Seasonality A/B (#1307): flat window vs same-phase weekly baseline ────────
// A strongly weekly-seasonal series (weekday high, weekend low). The flat
// trailing window mistakes the regular weekday↔weekend steps for anomalies; the
// same-phase (day-of-week × hour) baseline sees them as normal. Only the injected
// weekday spikes are real. Both detectors scored on the indices where BOTH
// produced a decision, for a fair comparison.
function buildWeeklySeasonalScenario() {
  const rng = mulberry32(0x51ed_5eed);
  const PER_HOUR = 4;            // 15-minute samples → multiple raw points per (dow,hour) bucket
  const PER_DAY = 24 * PER_HOUR; // 96
  const PER_WEEK = 7 * PER_DAY;  // 672
  const WEEKS = 8;
  const N = WEEKS * PER_WEEK;
  const values = [], labels = [], dow = [], hod = [];
  // Real weekday spikes in later weeks (after the bucket warm-up).
  const spikeAt = new Set([
    6 * PER_WEEK + PER_DAY * 1 + 40, 6 * PER_WEEK + PER_DAY * 1 + 41, // Mon
    6 * PER_WEEK + PER_DAY * 3 + 52,                                  // Wed
    7 * PER_WEEK + PER_DAY * 2 + 36, 7 * PER_WEEK + PER_DAY * 2 + 37, // Tue
  ]);
  for (let i = 0; i < N; i++) {
    const d = Math.floor(i / PER_DAY) % 7;       // 0=Sun … 6=Sat
    const h = Math.floor((i % PER_DAY) / PER_HOUR);
    dow.push(d); hod.push(h);
    const weekend = d === 0 || d === 6;
    const base = weekend ? 15 : 50;              // strong weekly pattern
    if (spikeAt.has(i)) { values.push(base + 40 + gauss(rng, 0, 1)); labels.push(true); continue; }
    values.push(base + gauss(rng, 0, 1.2)); labels.push(false);
  }
  return { values, labels, dow, hod };
}

{
  const { values, labels, dow, hod } = buildWeeklySeasonalScenario();
  // Vary ONLY the baseline (flat trailing window vs day-of-week × hour bucket) so
  // the difference is purely the #1307 seasonality contribution. No persistence
  // here — M-of-N would suppress the isolated spikes for BOTH and obscure it.
  const flat = detectRobustMad(values);
  const seasonal = detectSeasonalBucketMad(values, dow, hod);
  // Score on indices where BOTH detectors produced a decision (fair denominator).
  const mask = (a, b) => a.map((v, i) => (a[i] === null || b[i] === null ? null : v));
  const anomalies = labels.filter(Boolean).length;
  console.log(`▶ weekly_seasonal  (${values.length} pts @ 15-min, ${anomalies} true-anomaly pts) — #1307 day-of-week`);
  console.log('    weekday/weekend steps look anomalous to a flat window; a day-of-week × hour baseline sees them as normal');
  console.log(row('robust-mad (flat window)', score(mask(flat, seasonal), labels)));
  console.log(row('robust-mad (seasonal dow×hr)', score(mask(seasonal, flat), labels)));
  console.log('');
}
