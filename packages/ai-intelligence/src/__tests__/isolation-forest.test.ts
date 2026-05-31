import { describe, it, expect } from 'vitest';
import { IsolationForest, averagePathLength } from '../services/isolation-forest.js';

describe('averagePathLength', () => {
  it('returns 0 for n <= 1', () => {
    expect(averagePathLength(0)).toBe(0);
    expect(averagePathLength(1)).toBe(0);
  });

  it('returns 1 for n = 2', () => {
    expect(averagePathLength(2)).toBe(1);
  });

  it('returns positive values for larger n', () => {
    expect(averagePathLength(100)).toBeGreaterThan(0);
    expect(averagePathLength(256)).toBeGreaterThan(0);
  });
});

describe('IsolationForest', () => {
  it('returns anomaly scores between 0 and 1', () => {
    const data: number[][] = [];
    for (let i = 0; i < 200; i++) {
      data.push([Math.random() * 10, Math.random() * 10]);
    }

    const forest = new IsolationForest(50, 128, 0.1);
    forest.fit(data);

    for (const point of data.slice(0, 10)) {
      const score = forest.anomalyScore(point);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it('classifies clear outliers as anomalous', () => {
    // Normal cluster around (50, 50)
    const data: number[][] = [];
    for (let i = 0; i < 300; i++) {
      data.push([50 + (Math.random() - 0.5) * 5, 50 + (Math.random() - 0.5) * 5]);
    }

    const forest = new IsolationForest(100, 256, 0.1);
    forest.fit(data);

    // An extreme outlier should have a high score
    const outlierScore = forest.anomalyScore([200, 200]);
    const normalScore = forest.anomalyScore([50, 50]);

    expect(outlierScore).toBeGreaterThan(normalScore);
  });

  it('predict() returns boolean', () => {
    const data: number[][] = [];
    for (let i = 0; i < 200; i++) {
      data.push([Math.random() * 10, Math.random() * 10]);
    }

    const forest = new IsolationForest(50, 128, 0.1);
    forest.fit(data);

    const result = forest.predict([5, 5]);
    expect(typeof result).toBe('boolean');
  });

  it('handles single-dimension data', () => {
    const data = Array.from({ length: 100 }, () => [Math.random() * 10]);
    const forest = new IsolationForest(30, 64, 0.1);
    forest.fit(data);

    const score = forest.anomalyScore([5]);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('handles small datasets gracefully', () => {
    const data = [[1, 2], [3, 4], [5, 6]];
    const forest = new IsolationForest(10, 256, 0.1);
    forest.fit(data);

    const score = forest.anomalyScore([3, 4]);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('training with identical points does not crash', () => {
    const data = Array.from({ length: 100 }, () => [50, 50]);
    const forest = new IsolationForest(50, 128, 0.1);
    expect(() => forest.fit(data)).not.toThrow();

    const score = forest.anomalyScore([50, 50]);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('returns 0 for anomalyScore when no trees fitted', () => {
    const forest = new IsolationForest(50, 128, 0.1);
    expect(forest.anomalyScore([1, 2])).toBe(0);
  });

  it('handles empty training data', () => {
    const forest = new IsolationForest(50, 128, 0.1);
    expect(() => forest.fit([])).not.toThrow();
  });
});

/** Deterministic Mulberry32 — two streams seeded alike yield identical output. */
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

describe('IsolationForest determinism (injected RNG)', () => {
  // Fixed data drawn from a SEPARATE deterministic stream so the only source of
  // variation between the two forests is their own internal RNG.
  function fixedData(): number[][] {
    const gen = mulberry32(123);
    const data: number[][] = [];
    for (let i = 0; i < 200; i++) data.push([gen() * 10, gen() * 10]);
    return data;
  }

  it('produces identical scores for two forests fit with the same seed and data', () => {
    const data = fixedData();
    const a = new IsolationForest(50, 128, 0.1, mulberry32(42));
    const b = new IsolationForest(50, 128, 0.1, mulberry32(42));
    a.fit(data);
    b.fit(data);

    const point = [5, 5];
    expect(a.anomalyScore(point)).toBe(b.anomalyScore(point));
    expect(a.predict(point)).toBe(b.predict(point));
  });

  it('produces different models for different seeds (RNG is actually used)', () => {
    const data = fixedData();
    const a = new IsolationForest(50, 128, 0.1, mulberry32(1));
    const b = new IsolationForest(50, 128, 0.1, mulberry32(999));
    a.fit(data);
    b.fit(data);

    // Two distinct seeds should partition differently → scores should differ
    // for at least one of a set of probe points.
    const probes = [[5, 5], [1, 9], [8, 2], [3, 7]];
    const anyDifferent = probes.some((p) => a.anomalyScore(p) !== b.anomalyScore(p));
    expect(anyDifferent).toBe(true);
  });
});
