import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSockets } from '@/providers/socket-provider';
import { useUiStore } from '@/stores/ui-store';
import { usePageVisibility } from '@/hooks/use-page-visibility';

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

const POTATO_MODE_HEAVY_POLL_MS = 5 * 60 * 1000;
const METRICS_EMPTY_POLL_MS = 15_000;
const METRICS_STEADY_POLL_MS = 60_000;

export function getContainerMetricsRefetchInterval(params: {
  points: number;
  potatoMode: boolean;
  isPageVisible: boolean;
}) {
  const { points, potatoMode, isPageVisible } = params;
  if (!isPageVisible) return false;
  if (potatoMode) return POTATO_MODE_HEAVY_POLL_MS;
  return points === 0 ? METRICS_EMPTY_POLL_MS : METRICS_STEADY_POLL_MS;
}

export function getHeavyRefetchInterval(params: {
  defaultIntervalMs: number;
  potatoMode: boolean;
  isPageVisible: boolean;
}) {
  const { defaultIntervalMs, potatoMode, isPageVisible } = params;
  if (!isPageVisible) return false;
  return potatoMode ? POTATO_MODE_HEAVY_POLL_MS : defaultIntervalMs;
}

export function useContainerMetrics(
  endpointId: number | undefined,
  containerId: string | undefined,
  metricType?: string,
  timeRange?: string
) {
  const potatoMode = useUiStore((state) => state.potatoMode);
  const isPageVisible = usePageVisibility();

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
      return getContainerMetricsRefetchInterval({
        points,
        potatoMode,
        isPageVisible,
      });
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
  const potatoMode = useUiStore((state) => state.potatoMode);
  const isPageVisible = usePageVisibility();

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
    refetchInterval: getHeavyRefetchInterval({
      defaultIntervalMs: 5 * 60 * 1000,
      potatoMode,
      isPageVisible,
    }), // Refresh every 5 minutes (fallback for users without Socket.IO)
  });
}

export interface NetworkRate {
  rxBytesPerSec: number;
  txBytesPerSec: number;
}

export function useNetworkRates(endpointId?: number) {
  const potatoMode = useUiStore((state) => state.potatoMode);
  const isPageVisible = usePageVisibility();

  return useQuery<{ rates: Record<string, NetworkRate> }>({
    queryKey: ['metrics', 'network-rates', endpointId ?? 'all'],
    queryFn: () =>
      endpointId
        ? api.get(`/api/metrics/network-rates/${endpointId}`)
        : api.get('/api/metrics/network-rates'),
    refetchInterval: getHeavyRefetchInterval({
      defaultIntervalMs: 60_000,
      potatoMode,
      isPageVisible,
    }),
  });
}
