import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface MetricStats {
  avg: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
  samples: number;
}

export interface ContainerReport {
  container_id: string;
  container_name: string;
  endpoint_id: number;
  cpu: MetricStats | null;
  memory: MetricStats | null;
  memory_bytes: MetricStats | null;
}

export interface Recommendation {
  container_id: string;
  container_name: string;
  issues: string[];
}

export interface UtilizationReport {
  timeRange: string;
  containers: ContainerReport[];
  fleetSummary: {
    totalContainers: number;
    avgCpu: number;
    maxCpu: number;
    avgMemory: number;
    maxMemory: number;
  };
  recommendations: Recommendation[];
}

interface TrendPoint {
  hour: string;
  avg: number;
  max: number;
  min: number;
  samples: number;
}

export interface TrendsReport {
  timeRange: string;
  trends: {
    cpu: TrendPoint[];
    memory: TrendPoint[];
    memory_bytes: TrendPoint[];
  };
}

export function useUtilizationReport(
  timeRange: string,
  endpointId?: number,
  containerId?: string,
) {
  return useQuery<UtilizationReport>({
    queryKey: ['reports', 'utilization', timeRange, endpointId, containerId],
    queryFn: () => {
      const params: Record<string, string | number | undefined> = {
        timeRange,
        endpointId,
        containerId,
      };
      return api.get<UtilizationReport>('/api/reports/utilization', { params });
    },
  });
}

export function useTrendsReport(
  timeRange: string,
  endpointId?: number,
  containerId?: string,
) {
  return useQuery<TrendsReport>({
    queryKey: ['reports', 'trends', timeRange, endpointId, containerId],
    queryFn: () => {
      const params: Record<string, string | number | undefined> = {
        timeRange,
        endpointId,
        containerId,
      };
      return api.get<TrendsReport>('/api/reports/trends', { params });
    },
  });
}
