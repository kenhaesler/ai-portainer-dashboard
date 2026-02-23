import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

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
  pattern: string | null;
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
    staleTime: 60 * 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
