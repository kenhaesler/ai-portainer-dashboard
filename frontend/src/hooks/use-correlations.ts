import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

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
  containerA: string;
  containerB: string;
  metricType: string;
  correlation: number;
  narrative: string | null;
}

export interface CorrelationsResponse {
  pairs: CorrelationPair[];
}

export interface CorrelationInsightsResponse {
  insights: CorrelationInsight[];
  summary: string | null;
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
