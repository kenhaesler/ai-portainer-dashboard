/**
 * Labelled store (#1364): turns operator #1298 feedback into ground-truth
 * labels the eval rig and threshold tuning consume.
 *
 * The `anomaly_feedback` table (migration 037) records one disposition per
 * (anomaly, user) — `false-positive` / `true-positive` / `unsure` — so multiple
 * operators can disagree. This module aggregates those votes into a single
 * ground-truth label per anomaly and a measured per-detector false-positive
 * rate, retiring the `is_acknowledged` proxy the #1294 audit had to use.
 *
 * The aggregation is pure (DB-independent, unit-testable); the feedback rows are
 * supplied by an injected fetcher so production wires the SQL query while tests
 * pass plain arrays.
 */

export type Disposition = 'false-positive' | 'true-positive' | 'unsure';

export interface GroundTruth {
  /** true = real anomaly, false = false positive, null = inconclusive (tie / unsure-only). */
  label: boolean | null;
  fpVotes: number;
  tpVotes: number;
}

export interface FeedbackRow {
  anomaly_id: string;
  disposition: Disposition;
  detector: string | null;
}

export type FetchFeedbackFn = (opts: { detector?: string }) => Promise<FeedbackRow[]>;

/** Aggregate a set of operator dispositions for one anomaly into a label. */
export function aggregateLabel(dispositions: readonly Disposition[]): GroundTruth {
  let fpVotes = 0;
  let tpVotes = 0;
  for (const d of dispositions) {
    if (d === 'false-positive') fpVotes++;
    else if (d === 'true-positive') tpVotes++;
  }
  let label: boolean | null;
  if (tpVotes > fpVotes) label = true;
  else if (fpVotes > tpVotes) label = false;
  else label = null; // tie or unsure-only → inconclusive
  return { label, fpVotes, tpVotes };
}

/** Fetch feedback (optionally for one detector) and aggregate to per-anomaly ground truth. */
export async function getAnomalyLabels(
  fetch: FetchFeedbackFn,
  opts: { detector?: string } = {},
): Promise<Map<string, GroundTruth>> {
  const rows = await fetch(opts);
  const byAnomaly = new Map<string, Disposition[]>();
  for (const r of rows) {
    const arr = byAnomaly.get(r.anomaly_id);
    if (arr) arr.push(r.disposition);
    else byAnomaly.set(r.anomaly_id, [r.disposition]);
  }
  const labels = new Map<string, GroundTruth>();
  for (const [id, disps] of byAnomaly) labels.set(id, aggregateLabel(disps));
  return labels;
}

/**
 * Measured false-positive rate: the fraction of conclusively-labelled anomalies
 * that are false positives. Inconclusive (null) labels are excluded. This is the
 * real per-detector FP rate that replaces the #1294 audit's `is_acknowledged`
 * proxy once enough feedback has accumulated.
 */
export function measuredFpRate(labels: ReadonlyMap<string, GroundTruth>): number {
  let fp = 0;
  let conclusive = 0;
  for (const gt of labels.values()) {
    if (gt.label === null) continue;
    conclusive++;
    if (gt.label === false) fp++;
  }
  return conclusive > 0 ? fp / conclusive : 0;
}
