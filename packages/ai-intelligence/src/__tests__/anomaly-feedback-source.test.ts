import { describe, it, expect, vi } from 'vitest';
import {
  createFeedbackFetcher,
  measureFpRateFromDb,
} from '../services/anomaly-feedback-source.js';
import type { FeedbackRow } from '../services/anomaly-labels.js';

/** Minimal AppDb-shaped stub — only `query` is exercised. */
function fakeDb(rows: FeedbackRow[]) {
  const query = vi.fn(async () => rows as unknown[]);
  return { db: { query, queryOne: vi.fn(), execute: vi.fn() }, query };
}

describe('createFeedbackFetcher — reads anomaly_feedback rows (#1364)', () => {
  it('selects the feedback columns from the anomaly_feedback table', async () => {
    const { db, query } = fakeDb([]);
    await createFeedbackFetcher(db as any)({ detector: 'ml-anomaly' });

    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/from\s+anomaly_feedback/i);
    expect(sql).toMatch(/anomaly_id/i);
    expect(sql).toMatch(/disposition/i);
  });

  it('bounds the query to a lookback window and passes the detector filter', async () => {
    const { db, query } = fakeDb([]);
    await createFeedbackFetcher(db as any, { lookbackDays: 14 })({ detector: 'ml-anomaly' });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/created_at\s*>/i); // time-bounded
    expect(params).toContain(14); // lookback days parameterised
    expect(params).toContain('ml-anomaly'); // detector filter parameterised
  });

  it('does not filter by detector when none is given', async () => {
    const { db, query } = fakeDb([]);
    await createFeedbackFetcher(db as any)({});

    const [, params] = query.mock.calls[0];
    expect(params).toContain(null); // null detector → no filter
  });

  it('type-casts the IS-NULL detector param so Postgres can infer its type', async () => {
    // A bare `$n IS NULL` on a param used nowhere else throws "could not determine
    // data type of parameter" on Postgres when the value is NULL. The cast fixes it.
    const { db, query } = fakeDb([]);
    await createFeedbackFetcher(db as any)({});
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/\?::text\s+IS\s+NULL/i);
  });
});

describe('measureFpRateFromDb — DB rows → measured FP rate + sample count', () => {
  it('aggregates dispositions into a rate and a conclusive sample count', async () => {
    const rows: FeedbackRow[] = [
      // anomaly a: 2 FP votes → false
      { anomaly_id: 'a', disposition: 'false-positive', detector: 'ml-anomaly' },
      { anomaly_id: 'a', disposition: 'false-positive', detector: 'ml-anomaly' },
      // anomaly b: TP → true
      { anomaly_id: 'b', disposition: 'true-positive', detector: 'ml-anomaly' },
      // anomaly c: FP → false
      { anomaly_id: 'c', disposition: 'false-positive', detector: 'ml-anomaly' },
      // anomaly d: tie → inconclusive, excluded from both rate and count
      { anomaly_id: 'd', disposition: 'false-positive', detector: 'ml-anomaly' },
      { anomaly_id: 'd', disposition: 'true-positive', detector: 'ml-anomaly' },
    ];
    const { db } = fakeDb(rows);

    const { rate, sampleCount } = await measureFpRateFromDb(db as any, 'ml-anomaly');
    expect(sampleCount).toBe(3); // a, b, c conclusive; d excluded
    expect(rate).toBeCloseTo(2 / 3, 6); // a, c false out of 3
  });

  it('is rate 0 / count 0 when there is no conclusive feedback', async () => {
    const { db } = fakeDb([]);
    const { rate, sampleCount } = await measureFpRateFromDb(db as any, 'ml-anomaly');
    expect(rate).toBe(0);
    expect(sampleCount).toBe(0);
  });
});
