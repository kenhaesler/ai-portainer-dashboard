import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';

export interface CorrelationPair {
  containerA: { id: string; name: string };
  containerB: { id: string; name: string };
  metricType: string;
  correlation: number;
  strength: 'very_strong' | 'strong';
  direction: 'positive' | 'negative';
  sampleCount: number;
}

export interface CorrelationInsight {
  /**
   * Stable key for the (containerA, containerB, metric) triple this narrative
   * belongs to. Join on this, never on array position: the server slices its
   * own top-10 from the unfiltered pair list while this page slices a top-10
   * from a list that may be filtered to one container, so the two lists are
   * routinely different sets. Format: `containerA|containerB|metricType`.
   */
  pairKey: string;
  containerA: string;
  containerB: string;
  metricType: string;
  correlation: number;
  narrative: string | null;
}

/**
 * Why narratives are missing, when they are.
 * - `ok`          — every pair got one.
 * - `partial`     — some did; the rest are null.
 * - `unparsed`    — the model answered but nothing matched a pair.
 * - `unavailable` — the model call failed.
 */
export type NarrativeStatus = 'ok' | 'partial' | 'unparsed' | 'unavailable';

export interface CorrelationsResponse {
  pairs: CorrelationPair[];
}

export interface CorrelationInsightsResponse {
  insights: CorrelationInsight[];
  summary: string | null;
  narrativeStatus: NarrativeStatus;
  /** One operator-facing sentence for a non-`ok` status. Render it once. */
  narrativeUnavailableReason: string | null;
  /** Total correlated pairs found, before the server's top-10 slice. */
  pairsTotal: number;
}

/** Mirrors the server's join-key format. Container names cannot contain `|`. */
export function correlationPairKey(
  containerA: string,
  containerB: string,
  metricType: string,
): string {
  return `${containerA}|${containerB}|${metricType}`;
}

export function useCorrelations(hours: number = 24, enabled: boolean = true) {
  return useQuery<CorrelationsResponse>({
    queryKey: ['correlations', hours],
    queryFn: () => api.get<CorrelationsResponse>(`/api/metrics/correlations?hours=${hours}`),
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

export function useCorrelationInsights(hours: number = 24, enabled: boolean = true) {
  return useQuery<CorrelationInsightsResponse>({
    queryKey: ['correlation-insights', hours],
    queryFn: () => api.get<CorrelationInsightsResponse>(`/api/metrics/correlations/insights?hours=${hours}`),
    staleTime: 15 * 60 * 1000,
    retry: 1,
    enabled,
  });
}
