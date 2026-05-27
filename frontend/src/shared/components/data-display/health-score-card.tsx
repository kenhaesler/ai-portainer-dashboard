import { AlertCircle, AlertTriangle, CheckCircle2, HelpCircle, XCircle } from 'lucide-react';
import type { HealthStats } from '@/features/ai-intelligence/components/fleet-health-summary';

/**
 * Presentational tile that surfaces the Overall Health Score. Extracted from
 * `fleet-health-summary.tsx` so the Home page and the Health & Monitoring page
 * stay in sync — both render through this component and reuse the shared
 * `calculateHealthStats` / `calculateHealthScore` helpers for the formula and
 * color-band thresholds (≥80% green, ≥50% amber, <50% red, null = gray).
 */
export interface HealthScoreCardProps {
  /** Aggregated container health stats from `calculateHealthStats`. */
  stats: HealthStats;
  /**
   * Score from `calculateHealthScore(stats)`. `null` indicates no container
   * reports a health signal — rendered as the gray "No healthchecks
   * configured" state.
   */
  score: number | null;
}

export function HealthScoreCard({ stats, score }: HealthScoreCardProps) {
  const reporting = stats.healthy + stats.unhealthy;
  const issueCount = stats.unhealthy + stats.stopped;

  return (
    <div className="flex items-center gap-5 min-w-0" data-testid="health-score-card">
      <div className="flex h-24 w-24 flex-shrink-0 items-center justify-center rounded-full border-8 border-primary/20 bg-muted/30">
        {score === null ? (
          <HelpCircle className="h-12 w-12 text-muted-foreground" />
        ) : score >= 80 ? (
          <CheckCircle2 className="h-12 w-12 text-emerald-500" data-testid="health-score-icon-green" />
        ) : score >= 50 ? (
          <AlertCircle className="h-12 w-12 text-amber-500" data-testid="health-score-icon-amber" />
        ) : (
          <XCircle className="h-12 w-12 text-red-500" data-testid="health-score-icon-red" />
        )}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-muted-foreground">Overall Health Score</p>
        {score === null ? (
          <>
            <p className="text-2xl font-semibold text-muted-foreground" data-testid="health-score-na">
              No healthchecks configured
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.total} containers tracked. Configure Docker healthchecks to enable scoring.
            </p>
          </>
        ) : (
          <>
            <p className="text-4xl font-bold tabular-nums leading-none mt-1" data-testid="health-score">
              {score.toFixed(1)}%
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.healthy} of {reporting} reporting healthy
              {stats.noHealthcheck > 0 && ` · ${stats.noHealthcheck} without healthcheck`}
            </p>
          </>
        )}
        {issueCount > 0 && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-red-700 dark:text-red-400">
            <AlertTriangle className="h-4 w-4" />
            {issueCount} container{issueCount === 1 ? '' : 's'} need{issueCount === 1 ? 's' : ''} attention
          </p>
        )}
      </div>
    </div>
  );
}
