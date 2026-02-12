import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSockets } from '@/providers/socket-provider';

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
    // Poll faster while empty so first data appears sooner; back off once data is flowing.
    refetchInterval: (query) => {
      const points = query.state.data?.data?.length ?? 0;
      return points === 0 ? 15_000 : 60_000;
    },
  });
}

export function useAnomalies() {
  return useQuery<Anomaly[]>({
    queryKey: ['metrics', 'anomalies'],
    queryFn: () => api.get<Anomaly[]>('/api/metrics/anomalies'),
  });
}

export interface AnomalyExplanation {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  category: string;
  title: string;
  description: string;
  aiExplanation: string | null;
  suggestedAction: string | null;
  timestamp: string;
}

export function useAnomalyExplanations(
  containerId: string | undefined,
  timeRange?: string,
) {
  const { monitoringSocket } = useSockets();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!monitoringSocket) return;

    const handleCycleComplete = () => {
      queryClient.invalidateQueries({ queryKey: ['anomaly-explanations'] });
    };

    monitoringSocket.on('cycle:complete', handleCycleComplete);
    return () => {
      monitoringSocket.off('cycle:complete', handleCycleComplete);
    };
  }, [monitoringSocket, queryClient]);

  return useQuery<{ explanations: AnomalyExplanation[] }>({
    queryKey: ['anomaly-explanations', containerId, timeRange],
    queryFn: () =>
      api.get(`/api/monitoring/insights/container/${containerId}`, {
        params: { timeRange },
      }),
    enabled: Boolean(containerId),
    staleTime: 60 * 1000, // Cache for 1 minute
    refetchInterval: 5 * 60 * 1000, // Refresh every 5 minutes (fallback for users without Socket.IO)
  });
}

export interface NetworkRate {
  rxBytesPerSec: number;
  txBytesPerSec: number;
}

export function useNetworkRates(endpointId?: number) {
  return useQuery<{ rates: Record<string, NetworkRate> }>({
    queryKey: ['metrics', 'network-rates', endpointId],
    queryFn: () => api.get(`/api/metrics/network-rates/${endpointId}`),
    enabled: Boolean(endpointId),
    refetchInterval: 60_000,
  });
}
