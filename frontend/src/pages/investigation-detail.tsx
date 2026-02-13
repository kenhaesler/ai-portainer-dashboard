import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Brain, Clock, Database, Layers, Server, AlertTriangle, Loader2 } from 'lucide-react';
import {
  safeParseJson,
  useInvestigationByInsightId,
  useInvestigationDetail,
  type RecommendedAction,
} from '@/hooks/use-investigations';
import { formatDate } from '@/lib/utils';
import { SpotlightCard } from '@/components/shared/spotlight-card';

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    gathering: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    analyzing: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    complete: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status] ?? styles.pending}`}>
      {status}
    </span>
  );
}

export default function InvestigationDetailPage() {
  const { id, insightId } = useParams();
  const detailQuery = useInvestigationDetail(id);
  const byInsightQuery = useInvestigationByInsightId(insightId);

  const query = insightId ? byInsightQuery : detailQuery;
  const investigation = query.data;

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="h-48 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (query.error || !investigation) {
    const message = query.error instanceof Error ? query.error.message : 'Investigation not found';
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Investigation Detail</h1>
          <p className="text-muted-foreground">Unable to load the requested investigation.</p>
        </div>
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-6">
          <p className="font-medium text-destructive">Failed to load investigation</p>
          <p className="mt-1 text-sm text-muted-foreground">{message}</p>
          <Link
            to="/ai-monitor"
            className="mt-4 inline-flex items-center gap-1 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to AI Monitor
          </Link>
        </div>
      </div>
    );
  }

  const contributingFactors = safeParseJson<string[]>(investigation.contributing_factors) ?? [];
  const recommendedActions = safeParseJson<RecommendedAction[]>(investigation.recommended_actions) ?? [];

  const timeline = [
    { label: 'Investigation created', time: investigation.created_at, detail: 'Investigation queued from triggering insight.' },
    ...(investigation.status === 'gathering' ? [{ label: 'Evidence gathering', time: investigation.created_at, detail: 'Collecting logs and metrics for root-cause analysis.' }] : []),
    ...(investigation.status === 'analyzing' ? [{ label: 'AI analysis started', time: investigation.created_at, detail: 'Analyzing evidence with configured model.' }] : []),
    ...(investigation.completed_at
      ? [{ label: 'Investigation completed', time: investigation.completed_at, detail: investigation.status === 'failed' ? 'Analysis failed.' : 'Root cause report generated.' }]
      : []),
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Investigation Detail</h1>
          <p className="text-muted-foreground">ID: {investigation.id}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={investigation.status} />
          <Link
            to="/ai-monitor"
            className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <SpotlightCard>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-sm">Created</span>
            <Clock className="h-4 w-4" />
          </div>
          <p className="mt-2 text-sm font-medium">{formatDate(investigation.created_at)}</p>
        </div>
        </SpotlightCard>
        <SpotlightCard>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-sm">Confidence</span>
            <Brain className="h-4 w-4" />
          </div>
          <p className="mt-2 text-lg font-semibold">
            {investigation.confidence_score != null ? `${Math.round(investigation.confidence_score * 100)}%` : 'N/A'}
          </p>
        </div>
        </SpotlightCard>
        <SpotlightCard>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-sm">Duration</span>
            <Loader2 className="h-4 w-4" />
          </div>
          <p className="mt-2 text-lg font-semibold">
            {investigation.analysis_duration_ms != null ? `${(investigation.analysis_duration_ms / 1000).toFixed(1)}s` : 'N/A'}
          </p>
        </div>
        </SpotlightCard>
        <SpotlightCard>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-sm">Model</span>
            <Database className="h-4 w-4" />
          </div>
          <p className="mt-2 text-sm font-medium">{investigation.llm_model ?? 'Unknown'}</p>
        </div>
        </SpotlightCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SpotlightCard className="rounded-lg border bg-card p-5">
          <h2 className="text-lg font-semibold">Timeline</h2>
          <div className="mt-4 space-y-3">
            {timeline.map((item, index) => (
              <div key={`${item.label}-${index}`} className="flex gap-3">
                <div className="mt-1 h-2 w-2 rounded-full bg-primary" />
                <div>
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(item.time)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </SpotlightCard>

        <SpotlightCard className="rounded-lg border bg-card p-5">
          <h2 className="text-lg font-semibold">Related Artifacts</h2>
          <div className="mt-4 space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-muted-foreground" />
              <span>Insight ID:</span>
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{investigation.insight_id}</code>
            </div>
            {investigation.container_name && (
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-muted-foreground" />
                <span>Container:</span>
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{investigation.container_name}</code>
              </div>
            )}
            {investigation.container_id && (
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-muted-foreground" />
                <span>Container ID:</span>
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{investigation.container_id}</code>
              </div>
            )}
            {investigation.endpoint_id != null && (
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                <span>Endpoint ID:</span>
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{investigation.endpoint_id}</code>
              </div>
            )}
          </div>
        </SpotlightCard>
      </div>

      <SpotlightCard className="rounded-lg border bg-card p-5">
        <h2 className="text-lg font-semibold">Findings</h2>
        <div className="mt-4 space-y-4">
          {investigation.root_cause && (
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Root Cause</h3>
              <p className="mt-1 text-sm">{investigation.root_cause}</p>
            </div>
          )}
          {contributingFactors.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Contributing Factors</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {contributingFactors.map((factor, idx) => (
                  <li key={`${factor}-${idx}`}>{factor}</li>
                ))}
              </ul>
            </div>
          )}
          {recommendedActions.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Recommended Actions</h3>
              <div className="mt-2 space-y-2">
                {recommendedActions.map((action, idx) => (
                  <div key={`${action.action}-${idx}`} className="rounded-md border bg-muted/30 p-3">
                    <p className="text-sm font-medium">{action.action}</p>
                    <p className="text-xs text-muted-foreground">Priority: {action.priority}</p>
                    {action.rationale && <p className="mt-1 text-xs text-muted-foreground">{action.rationale}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {investigation.error_message && (
            <div className="rounded-md border border-red-300 bg-red-50 p-3 dark:border-red-900/40 dark:bg-red-900/20">
              <p className="text-sm font-medium text-red-700 dark:text-red-400">Investigation Error</p>
              <p className="text-xs text-red-700/90 dark:text-red-300">{investigation.error_message}</p>
            </div>
          )}
        </div>
      </SpotlightCard>
    </div>
  );
}
