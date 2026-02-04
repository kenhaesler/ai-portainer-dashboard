import { useQuery } from '@tanstack/react-query';
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

interface Anomaly {
  id: string;
  containerId: string;
  endpointId: number;
  metricType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  value: number;
  threshold: number;
  detectedAt: string;
  description: string;
}

export function useContainerMetrics(
  endpointId: number | undefined,
  containerId: string | undefined,
  metricType?: string,
  timeRange?: string
) {
  return useQuery<ContainerMetrics>({
    queryKey: ['metrics', endpointId, containerId, metricType, timeRange],
    queryFn: () => {
      const params: Record<string, string | undefined> = { metricType, timeRange };
      return api.get<ContainerMetrics>(
        `/api/metrics/${endpointId}/${containerId}`,
        { params }
      );
    },
    enabled: Boolean(endpointId) && Boolean(containerId),
  });
}

export function useAnomalies() {
  return useQuery<Anomaly[]>({
    queryKey: ['metrics', 'anomalies'],
    queryFn: () => api.get<Anomaly[]>('/api/metrics/anomalies'),
  });
}
