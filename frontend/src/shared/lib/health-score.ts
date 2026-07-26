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
 * Healthcheck pass rate = healthy / (healthy + unhealthy). Containers without a
 * healthcheck are excluded so the operator's choice not to configure one doesn't
 * drag the number down. Returns null when no container reports a health signal.
 *
 * It was previously called `calculateHealthScore` and rendered as "Overall
 * Health Score" — a name that promised a verdict on the fleet while measuring
 * only Docker healthcheck exit status. It is blind to every anomaly insight, so
 * the page could read "100.0%" in green beside "14 Critical". The formula is
 * unchanged and correct; only the claim it makes about itself is narrower now.
 * Render it with its exclusion stated inline (see `HealthScoreCard`).
 */
export function calculateHealthcheckPassRate(stats: HealthStats): number | null {
  const reporting = stats.healthy + stats.unhealthy;
  if (reporting === 0) return null;
  return (stats.healthy / reporting) * 100;
}

/**
 * Unacknowledged insight counts feeding the "Needs attention" number. Supplied
 * by pages that load the insight feed (Health & Monitoring); omitted by pages
 * that don't (Home), in which case only container state contributes.
 */
export interface InsightAttentionCounts {
  /** Unacknowledged insights at `critical` severity. */
  critical: number;
  /** Unacknowledged insights at `warning` severity. */
  warning: number;
}

/**
 * The hero number and the two registers it is summed from. Kept as a breakdown
 * rather than a bare total so the card can state its own basis — a count of
 * "items across two lists" is only honest if it names both lists.
 */
export interface AttentionBreakdown {
  /** Containers that are unhealthy or stopped. */
  containers: number;
  /** Unacknowledged critical + warning insights. `0` when none were supplied. */
  insights: number;
  /** `containers + insights` — what the operator has to look at. */
  total: number;
}

/**
 * How many things need an operator's attention right now.
 *
 * A count, not a percentage: "3 need attention" is something you can act on,
 * where a pass rate is not — and a pass rate of a subset of containers even
 * less so. Derived from `stats` (and, when the caller has them, unacknowledged
 * insight counts) rather than accepted as a number, for the same reason
 * `HealthScoreCard` derives the pass rate internally: two surfaces must not be
 * able to disagree about what the fleet's headline number means.
 */
export function calculateNeedsAttention(
  stats: HealthStats,
  insights?: InsightAttentionCounts,
): AttentionBreakdown {
  const containers = stats.unhealthy + stats.stopped;
  const insightCount = insights ? insights.critical + insights.warning : 0;
  return {
    containers,
    insights: insightCount,
    total: containers + insightCount,
  };
}
