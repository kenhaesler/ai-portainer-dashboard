import { AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import {
  calculateHealthcheckPassRate,
  calculateNeedsAttention,
  type HealthStats,
  type InsightAttentionCounts,
} from '@/shared/lib/health-score';

/**
 * The "Needs attention" tile of `FleetHealthSummary`.
 *
 * Both figures are derived here from `stats` (plus the caller's unacknowledged
 * insight counts) rather than accepted as props, so no caller can pass a number
 * that disagrees with the data beside it.
 *
 * The healthcheck pass rate is secondary and named for what it measures:
 * `calculateHealthcheckPassRate` reads only `healthy`/`unhealthy`, so it can
 * show 100% while the hero count is not zero — see the second case in
 * `health-score-card.test.tsx`.
 *
 * No ring around the icon — a static circle encodes nothing; the last case in
 * that test file fails if `border-8` returns.
 */
export interface HealthScoreCardProps {
  /** Aggregated container health stats from `calculateHealthStats`. */
  stats: HealthStats;
  /**
   * Unacknowledged critical / warning insight counts. Callers without the
   * insight feed (Home) omit this; the clear-state sentence then mentions
   * containers only.
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
  // The clear-state sentence names every bucket `attention.total` covers:
  // containers (unhealthy + stopped + dead) and, when `insightCounts` was
  // supplied, unacknowledged critical + warning insights. See
  // `calculateNeedsAttention` and the clear-state cases in
  // `health-score-card.test.tsx`.
  const breakdown = isClear
    ? insightCounts
      ? 'No unhealthy, stopped or dead containers, no unacknowledged critical or warning insights.'
      : 'No unhealthy, stopped or dead containers.'
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
        {/* Whole percent only — the exact fraction is spelled out on the same
            line. */}
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
