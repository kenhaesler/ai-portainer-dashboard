import { describe, it, expect } from 'vitest';
import {
  aggregateLabel,
  getAnomalyLabels,
  measuredFpRate,
  type FeedbackRow,
} from '../services/anomaly-labels.js';

describe('aggregateLabel — feedback votes → ground truth (#1364)', () => {
  it('labels false (false positive) when FP votes win', () => {
    expect(aggregateLabel(['false-positive', 'false-positive', 'true-positive']).label).toBe(false);
  });

  it('labels true (real anomaly) when TP votes win', () => {
    expect(aggregateLabel(['true-positive', 'true-positive']).label).toBe(true);
  });

  it('is null (inconclusive) on a tie', () => {
    expect(aggregateLabel(['false-positive', 'true-positive']).label).toBeNull();
  });

  it('is null when only "unsure" votes', () => {
    expect(aggregateLabel(['unsure', 'unsure']).label).toBeNull();
  });

  it('counts the votes', () => {
    expect(aggregateLabel(['false-positive', 'false-positive', 'true-positive', 'unsure']))
      .toMatchObject({ label: false, fpVotes: 2, tpVotes: 1 });
  });
});

describe('getAnomalyLabels — group feedback by anomaly', () => {
  it('aggregates per anomaly via the injected fetcher', async () => {
    const rows: FeedbackRow[] = [
      { anomaly_id: 'a', disposition: 'false-positive', detector: 'ml-anomaly' },
      { anomaly_id: 'a', disposition: 'false-positive', detector: 'ml-anomaly' },
      { anomaly_id: 'b', disposition: 'true-positive', detector: 'ml-anomaly' },
    ];
    const labels = await getAnomalyLabels(async () => rows);
    expect(labels.get('a')!.label).toBe(false);
    expect(labels.get('b')!.label).toBe(true);
    expect(labels.size).toBe(2);
  });

  it('passes the detector filter through to the fetcher', async () => {
    let seen: string | undefined;
    await getAnomalyLabels(async (opts) => { seen = opts.detector; return []; }, { detector: 'ml-anomaly' });
    expect(seen).toBe('ml-anomaly');
  });
});

describe('measuredFpRate', () => {
  it('is the false-positive fraction of conclusively-labelled anomalies', () => {
    const labels = new Map([
      ['a', { label: false, fpVotes: 2, tpVotes: 0 }],
      ['b', { label: true, fpVotes: 0, tpVotes: 1 }],
      ['c', { label: false, fpVotes: 1, tpVotes: 0 }],
      ['d', { label: null, fpVotes: 1, tpVotes: 1 }], // inconclusive → excluded
    ]);
    expect(measuredFpRate(labels)).toBeCloseTo(2 / 3, 6);
  });

  it('is 0 when there are no conclusive labels', () => {
    expect(measuredFpRate(new Map())).toBe(0);
  });
});
