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
  service_type: 'application' | 'infrastructure';
  cpu: MetricStats | null;
  memory: MetricStats | null;
  memory_bytes: MetricStats | null;
}

export interface Recommendation {
  container_id: string;
  container_name: string;
  service_type: 'application' | 'infrastructure';
  issues: string[];
}

export interface UtilizationReport {
  timeRange: string;
  includeInfrastructure: boolean;
  excludeInfrastructure: boolean;
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
  includeInfrastructure: boolean;
  excludeInfrastructure: boolean;
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
  excludeInfrastructure = true,
) {
  return useQuery<UtilizationReport>({
    queryKey: ['reports', 'utilization', timeRange, endpointId, containerId, excludeInfrastructure],
    queryFn: () => {
      const params: Record<string, string | number | boolean | undefined> = {
        timeRange,
        endpointId,
        containerId,
        excludeInfrastructure,
      };
      return api.get<UtilizationReport>('/api/reports/utilization', { params });
    },
  });
}

export function useTrendsReport(
  timeRange: string,
  endpointId?: number,
  containerId?: string,
  excludeInfrastructure = true,
) {
  return useQuery<TrendsReport>({
    queryKey: ['reports', 'trends', timeRange, endpointId, containerId, excludeInfrastructure],
    queryFn: () => {
      const params: Record<string, string | number | boolean | undefined> = {
        timeRange,
        endpointId,
        containerId,
        excludeInfrastructure,
      };
      return api.get<TrendsReport>('/api/reports/trends', { params });
    },
  });
}
