import type { Container } from '@/features/containers/hooks/use-containers';

/**
 * Aggregated fleet health stats used by the Overall Health Score tile. Lives
 * in `shared/lib` (not `features/`) so cross-feature consumers — including
 * shared presentational components like `HealthScoreCard` — can depend on it
 * without violating the `features/ → shared/` import direction.
 */
export interface HealthStats {
  total: number;
  running: number;
  stopped: number;
  paused: number;
  unhealthy: number;
  healthy: number;
  unknown: number;
  /**
   * Running containers without a Docker healthcheck configured. These are
   * excluded from the health-score denominator (score = healthy / (healthy +
   * unhealthy)) so the operator's choice not to configure a healthcheck
   * doesn't artificially deflate the fleet health number.
   */
  noHealthcheck: number;
}

export function calculateHealthStats(containers: Container[]): HealthStats {
  const stats: HealthStats = {
    total: containers.length,
    running: 0,
    stopped: 0,
    paused: 0,
    unhealthy: 0,
    healthy: 0,
    unknown: 0,
    noHealthcheck: 0,
  };

  containers.forEach((container) => {
    if (container.state === 'running') stats.running++;
    else if (container.state === 'exited') stats.stopped++;
    else if (container.state === 'paused') stats.paused++;

    if (container.healthStatus === 'unhealthy') stats.unhealthy++;
    else if (container.healthStatus === 'healthy') stats.healthy++;
    else {
      stats.unknown++;
      if (container.state === 'running') stats.noHealthcheck++;
    }
  });

  return stats;
}

/**
 * Score = healthy / (healthy + unhealthy). Containers without a healthcheck
 * are excluded so the operator's choice not to configure one doesn't drag
 * the score down. Returns null when no container reports a health signal.
 */
export function calculateHealthScore(stats: HealthStats): number | null {
  const reporting = stats.healthy + stats.unhealthy;
  if (reporting === 0) return null;
  return (stats.healthy / reporting) * 100;
}
