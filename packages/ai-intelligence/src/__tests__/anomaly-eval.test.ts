import { describe, it, expect } from 'vitest';
import {
  precisionRecallF1,
  prAuc,
  scoreSeriesRobust,
  scoreSeriesZScore,
  scoreSeriesSeasonalRobust,
} from '../services/anomaly-eval.js';

describe('precisionRecallF1', () => {
  it('computes precision/recall/F1 at a score threshold', () => {
    // predict anomalous when score >= 0.5
    const r = precisionRecallF1([0.9, 0.6, 0.4, 0.1], [true, false, true, false], 0.5);
    // >=0.5: 0.9(T)→tp, 0.6(F)→fp; <0.5: 0.4(T)→fn, 0.1(F)→tn
    expect(r.precision).toBeCloseTo(0.5, 6);
    expect(r.recall).toBeCloseTo(0.5, 6);
    expect(r.f1).toBeCloseTo(0.5, 6);
  });

  it('is perfect when the threshold separates the classes', () => {
    const r = precisionRecallF1([0.9, 0.8, 0.2, 0.1], [true, true, false, false], 0.5);
    expect(r.precision).toBe(1);
    expect(r.recall).toBe(1);
    expect(r.f1).toBe(1);
  });

  it('precision is 1 (vacuous) when nothing is predicted positive', () => {
    const r = precisionRecallF1([0.1, 0.2], [true, false], 0.9);
    expect(r.precision).toBe(1);
    expect(r.recall).toBe(0);
    expect(r.f1).toBe(0);
  });
});

describe('prAuc (average precision — area under the PR curve)', () => {
  it('is 1.0 for perfect separation', () => {
    expect(prAuc([0.9, 0.8, 0.3, 0.1], [true, true, false, false])).toBeCloseTo(1, 6);
  });

  it('matches the hand-computed average precision for interleaved scores', () => {
    // desc: 0.9(T) p=1 r=0.5 → +0.5; 0.8(F); 0.7(T) p=2/3 r=1 → +0.333; 0.6(F)
    expect(prAuc([0.9, 0.8, 0.7, 0.6], [true, false, true, false])).toBeCloseTo(0.8333, 3);
  });

  it('is 0 when there are no positives', () => {
    expect(prAuc([0.5, 0.3], [false, false])).toBe(0);
  });

  it('is order-invariant in the inputs', () => {
    const a = prAuc([0.9, 0.8, 0.7, 0.6], [true, false, true, false]);
    const b = prAuc([0.6, 0.7, 0.8, 0.9], [false, true, false, true]);
    expect(a).toBeCloseTo(b, 9);
  });
});

describe('scoreSeriesRobust', () => {
  it('emits null during warm-up, then scores a spike high and a within-band value low', () => {
    const values = [50, 50, 50, 51, 49, 50, 50, 49, 51, 50, 80, 50.5];
    const scores = scoreSeriesRobust(values, 10);
    expect(scores.slice(0, 10).every((s) => s === null)).toBe(true);
    expect(scores[10]!).toBeGreaterThan(scores[11]!); // 80 ≫ 50.5
    expect(scores[11]!).toBeLessThan(3);
  });

  it('is one-sided: a drop scores 0', () => {
    const values = [...Array(10).fill(50), 20];
    expect(scoreSeriesRobust(values, 10)[10]).toBe(0);
  });
});

describe('PR-AUC regression guard — robust one-sided beats two-sided z-score (#1364)', () => {
  // Deterministic series: stable 50, periodic benign idle DIPS to 5 (label
  // false), and a few real upward spikes to 70 (label true). The dips deviate
  // MORE than the spikes, so two-sided |z| ranks the benign dips above the real
  // spikes (false positives at the top → poor PR-AUC); one-sided robust scores
  // dips at 0 and keeps the spikes on top.
  function dropsScenario() {
    const N = 600;
    const values: number[] = [];
    const labels: boolean[] = [];
    const spikeAt = new Set([200, 201, 400, 401, 402]);
    let seed = 0x1234_5678;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < N; i++) {
      if (spikeAt.has(i)) { values.push(70 + (rng() - 0.5)); labels.push(true); continue; }
      const inDip = i > 60 && i % 90 < 4; // benign idle dips, label false
      if (inDip) { values.push(5 + (rng() - 0.5)); labels.push(false); continue; }
      values.push(50 + (rng() - 0.5) * 2);
      labels.push(false);
    }
    return { values, labels };
  }

  function evaluable(scores: Array<number | null>, labels: boolean[]) {
    const s: number[] = [];
    const l: boolean[] = [];
    for (let i = 0; i < scores.length; i++) {
      if (scores[i] !== null) { s.push(scores[i]!); l.push(labels[i]); }
    }
    return { s, l };
  }

  it('robust one-sided PR-AUC exceeds two-sided z-score and clears a floor', () => {
    const { values, labels } = dropsScenario();
    const robust = evaluable(scoreSeriesRobust(values, 60), labels);
    const zscore = evaluable(scoreSeriesZScore(values, 60), labels);

    const robustAuc = prAuc(robust.s, robust.l);
    const zscoreAuc = prAuc(zscore.s, zscore.l);

    expect(robustAuc).toBeGreaterThan(zscoreAuc); // one-sided robustness win
    expect(robustAuc).toBeGreaterThan(0.5); // CI regression floor
  });
});

describe('PR-AUC regression guard — seasonal (day-of-week) beats flat-trailing (#1307)', () => {
  const HOURS_PER_WEEK = 24 * 7; // seasonal period (hourly samples)

  // Strong weekly seasonality: weekday baseline 50, weekend baseline 15. A flat
  // trailing window mistakes the regular weekday↔weekend steps for anomalies; a
  // same-phase (same hour-of-week) baseline sees them as normal. Real spikes
  // (+40 on weekday hours) are the only true anomalies.
  function weeklySeasonalScenario() {
    const WEEKS = 6;
    const N = WEEKS * HOURS_PER_WEEK;
    const values: number[] = [];
    const labels: boolean[] = [];
    const spikeAt = new Set([
      4 * HOURS_PER_WEEK + 50, 4 * HOURS_PER_WEEK + 51,
      5 * HOURS_PER_WEEK + 80, 5 * HOURS_PER_WEEK + 81, 5 * HOURS_PER_WEEK + 130,
    ]);
    let seed = 0x2bad_c0de;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < N; i++) {
      const dayOfWeek = Math.floor(i / 24) % 7; // 0..6, 0/6 = weekend
      const weekend = dayOfWeek === 0 || dayOfWeek === 6;
      const baseline = weekend ? 15 : 50;
      if (spikeAt.has(i)) { values.push(baseline + 40 + (rng() - 0.5)); labels.push(true); continue; }
      values.push(baseline + (rng() - 0.5) * 2);
      labels.push(false);
    }
    return { values, labels };
  }

  // Align two score arrays to the indices where BOTH produced a score.
  function alignedEvaluable(a: Array<number | null>, b: Array<number | null>, labels: boolean[]) {
    const sa: number[] = [];
    const sb: number[] = [];
    const l: boolean[] = [];
    for (let i = 0; i < labels.length; i++) {
      if (a[i] !== null && b[i] !== null) { sa.push(a[i]!); sb.push(b[i]!); l.push(labels[i]); }
    }
    return { sa, sb, l };
  }

  it('seasonal same-phase PR-AUC exceeds the flat trailing window and clears a floor', () => {
    const { values, labels } = weeklySeasonalScenario();
    // Flat trailing window of one day vs same-hour-of-week baseline.
    const flat = scoreSeriesRobust(values, 24);
    const seasonal = scoreSeriesSeasonalRobust(values, HOURS_PER_WEEK, 3);

    const { sa: seasonalS, sb: flatS, l } = alignedEvaluable(seasonal, flat, labels);
    const seasonalAuc = prAuc(seasonalS, l);
    const flatAuc = prAuc(flatS, l);

    expect(seasonalAuc).toBeGreaterThan(flatAuc); // weekly seasonality win
    expect(seasonalAuc).toBeGreaterThan(0.5); // CI regression floor
  });
});
