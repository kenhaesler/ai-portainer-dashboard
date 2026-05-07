import { useState } from 'react';
import {
  AlertTriangle,
  Info,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Activity,
  Shield,
  Sparkles,
  Server,
  Box,
  Search,
  Loader2,
  XCircle,
  Clock,
  Brain,
  CheckCircle2,
  TrendingUp,
  FileText,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn, formatDate } from '@/shared/lib/utils';
import { safeParseJson } from '@/features/ai-intelligence/hooks/use-investigations';
import type { Investigation, RecommendedAction } from '@/features/ai-intelligence/hooks/use-investigations';
import { getModelUseCase } from '@/features/core/components/settings/model-use-cases';

export type Severity = 'critical' | 'warning' | 'info';

export interface InsightCardProps {
  insight: {
    id: string;
    endpoint_id: number | null;
    endpoint_name: string | null;
    container_id: string | null;
    container_name: string | null;
    severity: Severity;
    category: string;
    title: string;
    description: string;
    suggested_action: string | null;
    is_acknowledged: number;
    created_at: string;
  };
  investigation?: Investigation;
  onAcknowledge: (insightId: string) => void;
  isAcknowledging: boolean;
  acknowledgeErrorMessage?: string;
}

/**
 * Renders a container name in a chip. Links to the container detail page
 * when both endpointId and containerId are known; otherwise renders as plain
 * text. `stopPropagation` keeps the parent row's expand-on-click behaviour
 * intact when the chip lives inside an expandable card.
 */
export function ContainerChip({
  name,
  endpointId,
  containerId,
  className,
}: {
  name: string;
  endpointId?: number | null;
  containerId?: string | null;
  className?: string;
}) {
  const baseClasses = cn(
    'inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs font-mono',
    className,
  );
  if (endpointId != null && containerId) {
    return (
      <Link
        to={`/containers/${endpointId}/${containerId}`}
        onClick={(e) => e.stopPropagation()}
        className={cn(baseClasses, 'hover:bg-muted/70 hover:text-foreground transition-colors')}
        title={`Open ${name}`}
      >
        <Box className="h-3 w-3 text-muted-foreground" />
        {name}
      </Link>
    );
  }
  return (
    <span className={baseClasses}>
      <Box className="h-3 w-3 text-muted-foreground" />
      {name}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const config = {
    critical: {
      icon: AlertTriangle,
      label: 'Critical',
      className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    },
    warning: {
      icon: AlertCircle,
      label: 'Warning',
      className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    },
    info: {
      icon: Info,
      label: 'Info',
      className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    },
  }[severity];

  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
        config.className
      )}
    >
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  );
}

export function DetectionMethodBadge({ method }: { method: string }) {
  const config: Record<string, { label: string; className: string }> = {
    zscore: {
      label: 'Z-Score',
      className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    },
    bollinger: {
      label: 'Bollinger',
      className: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
    },
    adaptive: {
      label: 'Adaptive',
      className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    },
    'isolation-forest': {
      label: 'Isolation Forest',
      className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    },
  };
  const entry = config[method] ?? config.zscore;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', entry.className)}>
      <Activity className="h-3 w-3" />
      {entry.label}
    </span>
  );
}

export function InvestigationStatusBadge({ status }: { status: Investigation['status'] }) {
  const config = {
    pending: { label: 'Pending', className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300', spinning: false },
    gathering: { label: 'Gathering Evidence', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', spinning: true },
    analyzing: { label: 'Analyzing', className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400', spinning: true },
    complete: { label: 'Complete', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', spinning: false },
    failed: { label: 'Failed', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', spinning: false },
  }[status];

  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium', config.className)}>
      {config.spinning && <Loader2 className="h-3 w-3 animate-spin" />}
      {status === 'complete' && <Brain className="h-3 w-3" />}
      {status === 'failed' && <XCircle className="h-3 w-3" />}
      {config.label}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: 'high' | 'medium' | 'low' }) {
  const config = {
    high: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    low: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  }[priority];

  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', config)}>
      {priority}
    </span>
  );
}

function InvestigationSection({ investigation }: { investigation: Investigation }) {
  if (investigation.status === 'pending' || investigation.status === 'gathering' || investigation.status === 'analyzing') {
    return (
      <div className="mt-3 rounded-md border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 p-4">
        <div className="flex items-center gap-2 mb-1">
          <Search className="h-4 w-4 text-purple-600 dark:text-purple-400" />
          <h4 className="text-sm font-medium text-purple-900 dark:text-purple-100">Root Cause Investigation</h4>
          <InvestigationStatusBadge status={investigation.status} />
        </div>
        <p className="text-sm text-purple-700 dark:text-purple-300">
          {investigation.status === 'pending' && 'Investigation queued...'}
          {investigation.status === 'gathering' && 'Gathering container logs, metrics, and related context...'}
          {investigation.status === 'analyzing' && 'AI is analyzing the evidence...'}
        </p>
      </div>
    );
  }

  if (investigation.status === 'failed') {
    return (
      <div className="mt-3 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4">
        <div className="flex items-center gap-2 mb-1">
          <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
          <h4 className="text-sm font-medium text-red-900 dark:text-red-100">Investigation Failed</h4>
        </div>
        <p className="text-sm text-red-700 dark:text-red-300">
          {investigation.error_message || 'An unknown error occurred during analysis.'}
        </p>
      </div>
    );
  }

  // Complete investigation
  const contributingFactors = safeParseJson<string[]>(investigation.contributing_factors) ?? [];
  const recommendedActions = safeParseJson<RecommendedAction[]>(investigation.recommended_actions) ?? [];

  return (
    <div className="mt-3 space-y-3">
      <div className="flex items-center gap-2">
        <Brain className="h-4 w-4 text-purple-600 dark:text-purple-400" />
        <h4 className="text-sm font-semibold text-purple-900 dark:text-purple-100">Root Cause Investigation</h4>
        <InvestigationStatusBadge status="complete" />
      </div>

      {/* Root Cause */}
      {investigation.root_cause && (
        <div className="rounded-md border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 p-3">
          <h5 className="text-xs font-semibold uppercase tracking-wider text-purple-600 dark:text-purple-400 mb-1">Root Cause</h5>
          <p className="text-sm text-purple-900 dark:text-purple-100">{investigation.root_cause}</p>
        </div>
      )}

      {/* AI Summary */}
      {investigation.ai_summary && (
        <div className="rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Sparkles className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            <h5 className="text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">AI Summary</h5>
          </div>
          <p className="text-sm text-blue-900 dark:text-blue-100">{investigation.ai_summary}</p>
        </div>
      )}

      {/* Contributing Factors */}
      {contributingFactors.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Contributing Factors</h5>
          <ul className="space-y-1">
            {contributingFactors.map((factor, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-purple-500 flex-shrink-0" />
                {factor}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Recommended Actions */}
      {recommendedActions.length > 0 && (
        <div>
          <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Recommended Actions</h5>
          <div className="space-y-2">
            {recommendedActions.map((action, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <PriorityBadge priority={action.priority} />
                <div className="flex-1">
                  <p className="text-foreground">{action.action}</p>
                  {action.rationale && (
                    <p className="text-xs text-muted-foreground mt-0.5">{action.rationale}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Metadata footer */}
      <div className="flex items-center gap-4 pt-2 border-t text-xs text-muted-foreground">
        {investigation.confidence_score != null && (
          <span className="flex items-center gap-1">
            Confidence: {Math.round(investigation.confidence_score * 100)}%
          </span>
        )}
        {investigation.analysis_duration_ms != null && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {(investigation.analysis_duration_ms / 1000).toFixed(1)}s
          </span>
        )}
        {investigation.llm_model && (() => {
          const useCase = getModelUseCase(investigation.llm_model);
          return (
            <span className="flex items-center gap-1.5">
              Model: {investigation.llm_model}
              <span className={cn('font-semibold', useCase.color)}>{useCase.label}</span>
            </span>
          );
        })()}
      </div>
    </div>
  );
}


export function InsightCard({
  insight,
  investigation,
  onAcknowledge,
  isAcknowledging,
  acknowledgeErrorMessage,
}: InsightCardProps) {
  const [expanded, setExpanded] = useState(false);

  const categoryIcon = {
    security: Shield,
    anomaly: Activity,
    'ai-analysis': Sparkles,
    predictive: TrendingUp,
    'log-analysis': FileText,
  }[insight.category.split(':')[0]] || Server;

  const CategoryIcon = categoryIcon;

  const hasInvestigation = !!investigation;
  const isInvestigating = investigation && ['pending', 'gathering', 'analyzing'].includes(investigation.status);

  const detectionMethod = insight.category === 'anomaly'
    ? insight.description.match(/method:\s*(\w+)/)?.[1] ?? null
    : null;

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border bg-card transition-all',
        expanded && 'ring-2 ring-primary/20'
      )}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 text-left transition-colors hover:bg-muted/30"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="mt-0.5 rounded-full bg-muted p-2">
              <CategoryIcon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <SeverityBadge severity={insight.severity} />
                {detectionMethod && <DetectionMethodBadge method={detectionMethod} />}
                {hasInvestigation && (
                  <InvestigationStatusBadge status={investigation.status} />
                )}
                <span className="text-xs text-muted-foreground">
                  {formatDate(insight.created_at)}
                </span>
              </div>
              <h3 className="font-semibold text-base leading-snug mb-1">
                {insight.title}
              </h3>
              {!expanded && (
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {insight.description}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isInvestigating && (
              <Loader2 className="h-4 w-4 animate-spin text-purple-500" />
            )}
            {insight.container_name && (
              <div className="hidden sm:flex">
                <ContainerChip
                  name={insight.container_name}
                  endpointId={insight.endpoint_id}
                  containerId={insight.container_id}
                />
              </div>
            )}
            {expanded ? (
              <ChevronDown className="h-5 w-5 text-muted-foreground flex-shrink-0" />
            ) : (
              <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
            )}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t px-4 py-4 bg-muted/10">
          <div className="space-y-3">
            <div>
              <h4 className="text-sm font-medium mb-1">Description</h4>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {insight.description}
              </p>
            </div>

            {insight.suggested_action && (
              <div>
                <h4 className="text-sm font-medium mb-2">Suggested Action</h4>
                <div className="rounded-md bg-blue-50 dark:bg-blue-900/20 p-3">
                  <p className="text-sm text-blue-900 dark:text-blue-100">
                    {insight.suggested_action}
                  </p>
                </div>
              </div>
            )}

            {/* Investigation Report */}
            {investigation && (
              <InvestigationSection investigation={investigation} />
            )}
            <div className="flex justify-end">
              <a
                href={investigation ? `/investigations/${investigation.id}` : `/investigations/insight/${insight.id}`}
                className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium hover:bg-accent"
              >
                View Investigation Details
              </a>
            </div>

            {!insight.is_acknowledged && (
              <div className="rounded-md border border-amber-200 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-900/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-amber-800 dark:text-amber-200">
                    Mark this insight as acknowledged to reduce noise during triage.
                  </p>
                  <button
                    type="button"
                    onClick={() => onAcknowledge(insight.id)}
                    disabled={isAcknowledging}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                      isAcknowledging
                        ? 'bg-muted text-muted-foreground cursor-not-allowed'
                        : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:hover:bg-emerald-900/50'
                    )}
                  >
                    {isAcknowledging ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Acknowledging...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-3 w-3" />
                        Acknowledge
                      </>
                    )}
                  </button>
                </div>
                {acknowledgeErrorMessage && (
                  <p className="mt-2 text-xs text-red-700 dark:text-red-300">{acknowledgeErrorMessage}</p>
                )}
              </div>
            )}

            {(insight.endpoint_name || insight.container_name) && (
              <div>
                <h4 className="text-sm font-medium mb-2">Resource Details</h4>
                <div className="rounded-md bg-muted p-3 space-y-1">
                  {insight.endpoint_name && (
                    <div className="flex gap-2 text-xs">
                      <span className="text-muted-foreground font-medium min-w-[120px]">
                        Endpoint:
                      </span>
                      <span className="font-mono">{insight.endpoint_name}</span>
                    </div>
                  )}
                  {insight.container_name && (
                    <div className="flex gap-2 text-xs">
                      <span className="text-muted-foreground font-medium min-w-[120px]">
                        Container:
                      </span>
                      <span className="font-mono">{insight.container_name}</span>
                    </div>
                  )}
                  {insight.container_id && (
                    <div className="flex gap-2 text-xs">
                      <span className="text-muted-foreground font-medium min-w-[120px]">
                        Container ID:
                      </span>
                      <span className="font-mono">{insight.container_id.slice(0, 12)}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t text-xs text-muted-foreground">
              <div className="flex items-center gap-4">
                <span>Category: {insight.category}</span>
                <span>ID: {insight.id.slice(0, 8)}</span>
              </div>
              <span className={insight.is_acknowledged ? 'text-emerald-600' : ''}>
                {insight.is_acknowledged ? 'Acknowledged' : 'Unacknowledged'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
