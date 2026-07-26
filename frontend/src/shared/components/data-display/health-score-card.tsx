import { AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import {
  calculateHealthcheckPassRate,
  calculateNeedsAttention,
  type HealthStats,
  type InsightAttentionCounts,
} from '@/shared/lib/health-score';

/**
 * The hero tile of the Fleet Vitals pane, shared by Home and Health &
 * Monitoring so the two pages can never disagree about the fleet's headline
 * number.
 *
 * It used to lead with "Overall Health Score 100.0%" — the Docker healthcheck
 * pass rate under a name that claimed to summarise the fleet. On Health &
 * Monitoring that green 100.0% rendered two inches from "14 Critical", because
 * the rate is structurally blind to insights. The rate is still here and still
 * correct; it is now named for what it measures, states its own exclusion
 * inline, and is secondary to a count the operator can act on.
 *
 * Both numbers are derived internally from `stats` (+ the caller's
 * unacknowledged insight counts) rather than accepted as props, so no caller
 * can pass a number that disagrees with the data beside it.
 *
 * There is deliberately no ring around the icon. The old one was
 * `border-8 border-primary/20` — a static full circle that read as a radial
 * progress meter and rendered identically at 100% and at 12%.
 */
export interface HealthScoreCardProps {
  /** Aggregated container health stats from `calculateHealthStats`. */
  stats: HealthStats;
  /**
   * Unacknowledged critical / warning insight counts. Pages that don't load
   * the insight feed (Home) omit this; the count then covers container state
   * only and the breakdown line says so rather than implying zero insights.
   */
  insightCounts?: InsightAttentionCounts;
}

function plural(n: number, singular: string, plural_: string): string {
  return `${n} ${n === 1 ? singular : plural_}`;
}

export function HealthScoreCard({ stats, insightCounts }: HealthScoreCardProps) {
  const passRate = calculateHealthcheckPassRate(stats);
  const reporting = stats.healthy + stats.unhealthy;
  const attention = calculateNeedsAttention(stats, insightCounts);

  const isClear = attention.total === 0;
  const isCritical = stats.unhealthy > 0 || (insightCounts?.critical ?? 0) > 0;

  const breakdownParts: string[] = [];
  if (attention.containers > 0) {
    breakdownParts.push(plural(attention.containers, 'container', 'containers'));
  }
  if (attention.insights > 0) {
    breakdownParts.push(
      `${plural(attention.insights, 'unacknowledged insight', 'unacknowledged insights')}`,
    );
  }
  const breakdown = isClear
    ? insightCounts
      ? 'No unhealthy or stopped containers, no unacknowledged critical or warning insights.'
      : 'No unhealthy or stopped containers.'
    : breakdownParts.join(' · ');

  return (
    <div className="flex items-center gap-5 min-w-0" data-testid="health-score-card">
      <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-full bg-muted/40">
        {isClear ? (
          <CheckCircle2 className="h-10 w-10 text-emerald-500" data-testid="attention-icon-clear" />
        ) : isCritical ? (
          <XCircle className="h-10 w-10 text-red-500" data-testid="attention-icon-critical" />
        ) : (
          <AlertCircle className="h-10 w-10 text-amber-500" data-testid="attention-icon-warning" />
        )}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-muted-foreground">Needs attention</p>
        <p
          className="text-4xl font-bold tabular-nums leading-none mt-1"
          data-testid="needs-attention-count"
        >
          {attention.total}
        </p>
        <p className="text-xs text-muted-foreground mt-1" data-testid="needs-attention-breakdown">
          {breakdown}
        </p>
        {/* Secondary, and named for what it measures. Whole percent only: on a
            fleet of 11 reporting containers the tenths digit is noise — one
            container moves the number 9.1 points, and the exact fraction is
            spelled out on the same line anyway. */}
        <p className="mt-3 border-t pt-2 text-xs text-muted-foreground" data-testid="healthcheck-pass-rate">
          {passRate === null ? (
            <>
              Healthcheck pass rate unavailable — none of the {stats.total} containers has a Docker
              healthcheck configured.
            </>
          ) : (
            <>
              Healthcheck pass rate{' '}
              <span className="font-medium text-foreground tabular-nums">
                {Math.round(passRate)}%
              </span>{' '}
              — {stats.healthy} of {reporting} containers with a healthcheck
              {stats.noHealthcheck > 0 && ` · ${stats.noHealthcheck} without one, excluded`}
            </>
          )}
        </p>
      </div>
    </div>
  );
}
