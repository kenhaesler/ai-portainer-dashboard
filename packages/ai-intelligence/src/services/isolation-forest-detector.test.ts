import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stub getConfig() before the SUT imports it — the detector reads
// ISOLATION_FOREST_* keys from the validated env config, but the test env
// does not satisfy the full production schema (JWT_SECRET, etc.).
//
// Fix 5 / #1294 / epic #1291: the regression below pins the lowered
// contamination default (0.05). If you change this value, also update the
// schema default in packages/core/src/config/env.schema.ts and the design
// note in docs/superpowers/specs/.
vi.mock('@dashboard/core/config/index.js', () => ({
  getConfig: () => ({
    ISOLATION_FOREST_TREES: 100,
    ISOLATION_FOREST_SAMPLE_SIZE: 256,
    ISOLATION_FOREST_CONTAMINATION: 0.05,
    ISOLATION_FOREST_RETRAIN_HOURS: 6,
  }),
}));

import {
  clearModelCache,
  detectAnomalyIsolationForest,
} from './isolation-forest-detector.js';

/**
 * Deterministic Mulberry32 RNG.
 *
 * @see https://github.com/bryc/code/blob/master/jshash/PRNGs.md#mulberry32
 *
 * Single-state 32-bit PRNG with full 2^32 period. Chosen here because:
 *   1. It is short enough to embed inline (no dependency).
 *   2. It is widely cited in the JS PRNG literature so a reviewer can verify
 *      the algorithm by name without reading the bits.
 *   3. Its output passes BigCrush — adequate quality for a 1000-sample
 *      Gaussian sanity check.
 *
 * Seed used by this regression: 0x9E3779B9 (the golden ratio constant; chosen
 * for visibility — any fixed 32-bit seed is fine because Mulberry32 has full
 * period).
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller transform — uses two uniform samples to yield one N(0,1). */
function gaussian(rng: () => number): number {
  const u1 = Math.max(rng(), Number.EPSILON);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

describe('detectAnomalyIsolationForest — contamination default', () => {
  let restoreRandom: () => void;

  beforeEach(() => {
    clearModelCache();
    // Replace Math.random with a deterministic Mulberry32 stream so both the
    // synthetic data generation AND the IsolationForest's internal sampling
    // and split selection produce reproducible results. Seed is documented
    // above. Without this, the forest's tree-building is non-deterministic
    // and the test would be flaky.
    const rng = mulberry32(0x9e3779b9);
    const original = Math.random;
    Math.random = rng;
    restoreRandom = () => {
      Math.random = original;
    };
  });

  afterEach(() => {
    restoreRandom();
    clearModelCache();
    vi.restoreAllMocks();
  });

  it('produces ≤ 1% anomaly rate on deterministic Gaussian noise (σ=0.1) around a constant mean', async () => {
    // ── Fixture shape — pinned for reproducibility ────────────────────────
    // The Isolation Forest calibrates its anomaly threshold to flag the top
    // `contamination` fraction of *training* scores; if both training and
    // evaluation are drawn from the same noise-only distribution the rate
    // floors at ≈ contamination % by construction. To exercise the
    // real-world false-positive behaviour the AC in #1294 cares about
    // ("stable workload should not be flagged") we therefore:
    //
    //   1. TRAIN on a mixed set: 950 quiet Gaussian samples (σ=0.1 around
    //      cpu_mean=50, memory_mean=60) + 50 clear outliers (cpu=80,
    //      memory=90). The 50 outliers pull the contamination=0.05
    //      threshold up to where it correctly separates noise from spikes
    //      — the same dynamic that happens in production when real
    //      anomalies exist.
    //   2. EVALUATE 1000 FRESH quiet samples from the same Gaussian noise
    //      distribution (no outliers). With the threshold properly seated
    //      above the noise floor, ≤ 1% of the fresh-clean samples should
    //      cross it.
    //
    // Pre-fix (contamination=0.15): the threshold would sit much lower in
    // the score distribution and well over 1% of clean samples would trip
    // it, demonstrating the regression value of the lowered default.
    const N_CLEAN = 950;
    const N_OUTLIERS = 50;
    const N_EVAL = 1000;
    const cpuMean = 50;
    const memoryMean = 60;
    const sigma = 0.1;
    const outlierCpu = 80;
    const outlierMemory = 90;

    // Mulberry32 (installed as Math.random above) provides deterministic
    // RNG for both Gaussian data and the forest's internal sampling.
    const training: { cpu: number; memory: number }[] = [];
    for (let i = 0; i < N_CLEAN; i++) {
      training.push({
        cpu: cpuMean + sigma * gaussian(Math.random as () => number),
        memory: memoryMean + sigma * gaussian(Math.random as () => number),
      });
    }
    for (let i = 0; i < N_OUTLIERS; i++) {
      training.push({ cpu: outlierCpu, memory: outlierMemory });
    }

    // Detector pairs cpu+memory by index, matching its production behaviour.
    const getMetrics = async (
      _containerId: string,
      metricType: string,
      _from: string,
      _to: string,
    ) => {
      return training.map((s, i) => ({
        timestamp: new Date(2026, 0, 1, 0, i).toISOString(),
        container_id: 'c1',
        metric_type: metricType,
        value: metricType === 'cpu' ? s.cpu : s.memory,
      })) as never;
    };

    // ── Evaluate N_EVAL fresh clean samples through the trained forest ───
    // The first call triggers training (and caches the model); subsequent
    // calls reuse the cached forest, so the threshold is fixed across the
    // batch — exactly the production hot-path.
    let anomalies = 0;
    for (let i = 0; i < N_EVAL; i++) {
      const cpu = cpuMean + sigma * gaussian(Math.random as () => number);
      const memory = memoryMean + sigma * gaussian(Math.random as () => number);
      const result = await detectAnomalyIsolationForest(
        'c1',
        'container-1',
        'cpu',
        cpu,
        cpu,
        memory,
        getMetrics,
      );
      if (result?.is_anomalous) anomalies++;
    }

    const rate = anomalies / N_EVAL;
    // Strict bound — see fixture comment above for derivation.
    expect(rate).toBeLessThanOrEqual(0.01);
  });
});
