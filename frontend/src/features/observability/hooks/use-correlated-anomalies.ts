import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';
import { STALE_TIMES } from '@/shared/lib/query-constants';

/** Stable ids for the deterministic deviation rules the backend evaluates. */
export type MetricPatternId =
  | 'cpu-and-memory-deviation'
  | 'memory-only-deviation'
  | 'cpu-only-deviation';

export interface PatternMetricObservation {
  type: string;
  zScore: number;
}

/**
 * Which deviation rule fired, on which metrics, at what threshold.
 *
 * The backend used to send a single hardcoded English sentence per rule branch
 * ("…suggesting gradual memory accumulation"), which read as a diagnosis
 * nothing had actually made and rendered byte-identically on every card that
 * hit the same branch. The classification is real; the prose was not. Render
 * the rule and its numbers.
 */
export interface MetricPatternMatch {
  id: MetricPatternId;
  /** Names what was observed, not what caused it. */
  label: string;
  /** The z-score each `triggeredBy` metric had to exceed. */
  zScoreThreshold: number;
  /** Metrics that crossed the threshold. */
  triggeredBy: PatternMetricObservation[];
  /** Metrics the rule inspected that stayed within the threshold. */
  withinThreshold: PatternMetricObservation[];
  /** Restatement of the rule and the numbers it fired on. Not an inference. */
  summary: string;
}

export interface CorrelatedAnomaly {
  containerId: string;
  containerName: string;
  metrics: Array<{
    type: string;
    currentValue: number;
    mean: number;
    zScore: number;
  }>;
  compositeScore: number;
  /** `patternMatch.summary`, or null when no rule fired. Prefer `patternMatch`. */
  pattern: string | null;
  patternMatch: MetricPatternMatch | null;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: string;
}

export function useCorrelatedAnomalies(windowSize: number = 30, minScore: number = 2) {
  return useQuery<CorrelatedAnomaly[]>({
    queryKey: ['correlated-anomalies', windowSize, minScore],
    queryFn: () =>
      api.get<CorrelatedAnomaly[]>(
        `/api/anomalies/correlated?windowSize=${windowSize}&minScore=${minScore}`,
      ),
    staleTime: STALE_TIMES.SHORT,
    retry: 1,
  });
}
