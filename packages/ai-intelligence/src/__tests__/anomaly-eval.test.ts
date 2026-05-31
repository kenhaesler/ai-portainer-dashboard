import { describe, it, expect } from 'vitest';
import { precisionRecallF1, prAuc } from '../services/anomaly-eval.js';

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
