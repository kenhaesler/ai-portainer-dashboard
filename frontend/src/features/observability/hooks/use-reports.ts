import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/lib/api';

interface MetricStats {
  avg: number;
  min: number;
  max: number;
  /**
   * Null when the percentile could not be computed over the same rows as
   * avg/min/max — see `UtilizationReport['aggregateSource']`. Rendering a null
   * as `0` is what produced rows reading `p95 0.00%` for containers that
   * reported nothing, and mixing the two sources produced `p95` above `max`.
   */
  p50: number | null;
  p95: number | null;
  p99: number | null;
  /** Raw samples backing the percentiles above. 0 whenever they are null. */
  percentileSamples: number;
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

/**
 * One right-sizing rule, as the backend states it. Shared by the per-rule
 * rollup (`recommendationSummary`) and by the rules a range could not evaluate
 * (`rightSizingCoverage.skippedRules`), so both render in the same words.
 */
export interface RightSizingRuleDescriptor {
  id: string;
  metric: string;
  statistic: string;
  comparison: string;
  threshold: number;
  unit: string;
  recommendation: string;
}

export interface RightSizingRuleSummary extends RightSizingRuleDescriptor {
  /** Every container the rule fired on. Uncapped — count with this. */
  container_count: number;
  /** A sample of the names, capped server-side; may be shorter than the count. */
  container_names: string[];
  names_truncated?: boolean;
}

export interface UtilizationReport {
  timeRange: string;
  includeInfrastructure: boolean;
  excludeInfrastructure: boolean;
  containers: ContainerReport[];
  fleetSummary: {
    /** Running containers only — the population the KPI row averages over. */
    totalContainers: number;
    /** Every container in `containers`, running or not. */
    totalObserved: number;
    avgCpu: number;
    maxCpu: number;
    avgMemory: number;
    maxMemory: number;
  };
  recommendations: Recommendation[];
  /**
   * Per-rule rollup, so the page states a rule once instead of repeating
   * byte-identical advice per container.
   */
  recommendationSummary?: RightSizingRuleSummary[];
  /**
   * Which table avg/min/max came from, and whether percentiles could be
   * computed over the same rows. Optional so a client running against an older
   * server degrades to hiding the note rather than crashing.
   */
  aggregateSource?: {
    table: string;
    isRollup: boolean;
    percentilesAvailable: boolean;
    percentileNote: string | null;
  };
  /**
   * The rules this range could not evaluate, and how many rules exist. Rules
   * keyed on a percentile have nothing to test on a rollup range, so they go
   * quiet for every container. Optional for the same reason as
   * `aggregateSource`: an older server simply hides the note.
   */
  rightSizingCoverage?: {
    totalRules: number;
    skippedRules: RightSizingRuleDescriptor[];
    skippedReason: string | null;
  };
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
