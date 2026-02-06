import { useQueries } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface MetricDataPoint {
  timestamp: string;
  value: number;
}

interface ContainerMetrics {
  containerId: string;
  endpointId: number;
  metricType: string;
  timeRange: string;
  data: MetricDataPoint[];
}

export interface ComparisonTarget {
  containerId: string;
  endpointId: number;
  name: string;
}

export function useComparisonMetrics(
  targets: ComparisonTarget[],
  metricType: string,
  timeRange: string,
) {
  const queries = useQueries({
    queries: targets.map((target) => ({
      queryKey: ['metrics', target.endpointId, target.containerId, metricType, timeRange],
      queryFn: () =>
        api.get<ContainerMetrics>(
          `/api/metrics/${target.endpointId}/${target.containerId}`,
          { params: { metricType, timeRange } },
        ),
      enabled: targets.length >= 2,
    })),
  });

  const isLoading = queries.some((q) => q.isLoading);
  const isError = queries.some((q) => q.isError);
  const data = queries.map((q, i) => ({
    target: targets[i],
    metrics: q.data,
    isLoading: q.isLoading,
    isError: q.isError,
  }));

  return { data, isLoading, isError, queries };
}
