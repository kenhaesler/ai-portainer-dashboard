import { useState, useMemo } from 'react';
import { useMonitoring } from '@/hooks/use-monitoring';
import { useInvestigations, safeParseJson } from '@/hooks/use-investigations';
import type { Investigation, RecommendedAction } from '@/hooks/use-investigations';
import { useIncidents, useResolveIncident, type Incident } from '@/hooks/use-incidents';
import { useCorrelatedAnomalies, type CorrelatedAnomaly } from '@/hooks/use-correlated-anomalies';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import { RefreshButton } from '@/components/shared/refresh-button';
import { AutoRefreshToggle } from '@/components/shared/auto-refresh-toggle';
import { SkeletonCard } from '@/components/shared/loading-skeleton';
import { cn, formatDate } from '@/lib/utils';
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
  Filter,
  Search,
  Loader2,
  XCircle,
  Clock,
  Brain,
  Layers,
  CheckCircle2,
  Zap,
} from 'lucide-react';

type Severity = 'critical' | 'warning' | 'info';

interface InsightCardProps {
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

function SeverityBadge({ severity }: { severity: Severity }) {
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

function CorrelationTypeBadge({ type }: { type: string }) {
  const config: Record<string, { icon: typeof Clock; label: string; className: string }> = {
    temporal: {
      icon: Clock,
      label: 'Temporal',
      className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    },
    cascade: {
      icon: Layers,
      label: 'Cascade',
      className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    },
    dedup: {
      icon: Filter,
      label: 'Dedup',
      className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    },
  };

  const entry = config[type] ?? config.temporal;
  const Icon = entry.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
        entry.className,
      )}
    >
      <Icon className="h-3 w-3" />
      {entry.label}
    </span>
  );
}

function ConfidenceBadge({ confidence }: { confidence: 'high' | 'medium' | 'low' }) {
  const config = {
    high: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    low: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  }[confidence];

  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize', config)}>
      {confidence} confidence
    </span>
  );
}

function CorrelationSeverityBadge({ severity }: { severity: 'low' | 'medium' | 'high' | 'critical' }) {
  const config = {
    critical: {
      icon: AlertTriangle,
      label: 'Critical',
      className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    },
    high: {
      icon: AlertCircle,
      label: 'High',
      className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    },
    medium: {
      icon: AlertCircle,
      label: 'Medium',
      className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    },
    low: {
      icon: Info,
      label: 'Low',
      className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    },
  }[severity];

  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
        config.className,
      )}
    >
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  );
}

function PatternBadge({ pattern }: { pattern: string }) {
  const shortLabel = pattern.includes(':') ? pattern.split(':')[0].trim() : pattern;

  const colorMap: Record<string, string> = {
    'Resource Exhaustion': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    'Memory Leak Suspected': 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    'CPU Spike': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  };

  const colorClass = colorMap[shortLabel] ?? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400';

  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium', colorClass)}>
      <Zap className="h-3 w-3" />
      {shortLabel}
    </span>
  );
}

function DetectionMethodBadge({ method }: { method: string }) {
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
  };
  const entry = config[method] ?? config.zscore;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', entry.className)}>
      <Activity className="h-3 w-3" />
      {entry.label}
    </span>
  );
}

function CorrelatedAnomalyCard({ anomaly }: { anomaly: CorrelatedAnomaly }) {
  const patternDescription = anomaly.pattern?.includes(':')
    ? anomaly.pattern.split(':').slice(1).join(':').trim()
    : null;

  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-4 transition-all',
        anomaly.severity === 'critical' && 'border-red-500/40 bg-red-50/30 dark:bg-red-900/10',
        anomaly.severity === 'high' && 'border-orange-500/40 bg-orange-50/30 dark:bg-orange-900/10',
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Box className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <span className="font-mono text-sm font-medium truncate">{anomaly.containerName}</span>
        </div>
        <span className="text-lg font-bold tabular-nums flex-shrink-0" title="Composite score">
          {anomaly.compositeScore.toFixed(2)}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-3">
        <CorrelationSeverityBadge severity={anomaly.severity} />
        {anomaly.pattern && <PatternBadge pattern={anomaly.pattern} />}
      </div>

      {/* Per-metric z-score bars */}
      <div className="space-y-1.5" data-testid="zscore-bars">
        {anomaly.metrics.map((m) => {
          const absZ = Math.abs(m.zScore);
          const widthPct = Math.min((absZ / 5) * 100, 100);
          const barColor = absZ >= 3 ? 'bg-red-500' : absZ >= 2 ? 'bg-amber-500' : 'bg-blue-500';

          return (
            <div key={m.type} className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-20 truncate font-mono">{m.type}</span>
              <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all', barColor)}
                  style={{ width: `${widthPct}%` }}
                />
              </div>
              <span className="text-xs tabular-nums text-muted-foreground w-10 text-right">
                {m.zScore.toFixed(1)}
              </span>
            </div>
          );
        })}
      </div>

      {patternDescription && (
        <p className="mt-2 text-xs text-muted-foreground">{patternDescription}</p>
      )}
    </div>
  );
}

function InvestigationStatusBadge({ status }: { status: Investigation['status'] }) {
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
        {investigation.llm_model && (
          <span>Model: {investigation.llm_model}</span>
        )}
      </div>
    </div>
  );
}

function IncidentCard({ incident, onResolve }: { incident: Incident; onResolve: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const containers: string[] = JSON.parse(incident.affected_containers || '[]');
  const isActive = incident.status === 'active';

  return (
    <div className={cn(
      'overflow-hidden rounded-lg border-2 bg-card transition-all',
      isActive
        ? incident.severity === 'critical'
          ? 'border-red-500/40 bg-red-50/30 dark:bg-red-900/10'
          : 'border-amber-500/40 bg-amber-50/30 dark:bg-amber-900/10'
        : 'border-border opacity-60',
      expanded && 'ring-2 ring-primary/20',
    )}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 text-left transition-colors hover:bg-muted/20"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="mt-0.5 rounded-full bg-purple-100 dark:bg-purple-900/30 p-2">
              <Layers className="h-4 w-4 text-purple-600 dark:text-purple-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <SeverityBadge severity={incident.severity} />
                <span className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
                  isActive
                    ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
                )}>
                  {isActive ? 'Active Incident' : 'Resolved'}
                </span>
                <CorrelationTypeBadge type={incident.correlation_type} />
                <span className="text-xs text-muted-foreground">
                  {formatDate(incident.created_at)}
                </span>
              </div>
              <h3 className="font-semibold text-base leading-snug mb-1">{incident.title}</h3>
              {!expanded && incident.summary && (
                <p className="text-sm text-muted-foreground line-clamp-2">{incident.summary}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs font-medium">
              {incident.insight_count} alerts
            </span>
            {expanded ? (
              <ChevronDown className="h-5 w-5 text-muted-foreground flex-shrink-0" />
            ) : (
              <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
            )}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t px-4 py-4 bg-muted/10 space-y-3">
          {incident.summary && (
            <div>
              <h4 className="text-sm font-medium mb-1">Summary</h4>
              <p className="text-sm text-muted-foreground">{incident.summary}</p>
            </div>
          )}

          {containers.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-1.5">Affected Containers</h4>
              <div className="flex flex-wrap gap-1.5">
                {containers.map((name) => (
                  <span key={name} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-mono">
                    <Box className="h-3 w-3 text-muted-foreground" />
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-4 pt-2 border-t text-xs text-muted-foreground">
            <ConfidenceBadge confidence={incident.correlation_confidence} />
            {incident.endpoint_name && <span>Endpoint: {incident.endpoint_name}</span>}
            <span>ID: {incident.id.slice(0, 8)}</span>
            {isActive && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onResolve(incident.id);
                }}
                className="ml-auto inline-flex items-center gap-1 rounded-md bg-emerald-100 dark:bg-emerald-900/30 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-900/50 transition-colors"
              >
                <CheckCircle2 className="h-3 w-3" />
                Resolve
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function InsightCard({
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
              <div className="hidden sm:flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs">
                <Box className="h-3 w-3 text-muted-foreground" />
                <span className="font-mono">{insight.container_name}</span>
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

export default function AiMonitorPage() {
  const [severityFilter, setSeverityFilter] = useState<'all' | Severity>('all');
  const [acknowledgementFilter, setAcknowledgementFilter] = useState<'all' | 'unacknowledged'>('all');
  const { interval, setInterval } = useAutoRefresh(30);

  const {
    insights,
    isLoading,
    error,
    subscribedSeverities,
    subscribeSeverity,
    unsubscribeSeverity,
    acknowledgeInsight,
    acknowledgeError,
    acknowledgingInsightId,
    refetch,
  } = useMonitoring();

  const { getInvestigationForInsight } = useInvestigations();
  const { data: incidentsData } = useIncidents('active');
  const resolveIncidentMutation = useResolveIncident();
  const { data: correlatedAnomalies, isLoading: correlatedLoading } = useCorrelatedAnomalies();

  // Filter insights by severity
  const filteredInsights = useMemo(() => {
    const bySeverity = severityFilter === 'all'
      ? insights
      : insights.filter((i) => i.severity === severityFilter);

    if (acknowledgementFilter === 'unacknowledged') {
      return bySeverity.filter((i) => !i.is_acknowledged);
    }

    return bySeverity;
  }, [acknowledgementFilter, insights, severityFilter]);

  // Stats
  const stats = useMemo(() => ({
    total: insights.length,
    critical: insights.filter((i) => i.severity === 'critical').length,
    warning: insights.filter((i) => i.severity === 'warning').length,
    info: insights.filter((i) => i.severity === 'info').length,
  }), [insights]);

  const handleSeverityToggle = (severity: Severity) => {
    if (subscribedSeverities.has(severity)) {
      unsubscribeSeverity(severity);
      // If we're filtering by this severity and we unsubscribe, reset to 'all'
      if (severityFilter === severity) {
        setSeverityFilter('all');
      }
    } else {
      subscribeSeverity(severity);
    }
  };

  // Error state
  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">AI Monitor</h1>
          <p className="text-muted-foreground">
            Real-time AI-powered infrastructure insights
          </p>
        </div>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
          <p className="mt-4 font-medium text-destructive">Failed to load insights</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'An unexpected error occurred'}
          </p>
          <button
            onClick={() => refetch()}
            className="mt-4 inline-flex items-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">AI Monitor</h1>
          <p className="text-muted-foreground">
            Real-time AI-powered infrastructure insights
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoRefreshToggle interval={interval} onIntervalChange={setInterval} />
          <RefreshButton onClick={() => refetch()} />
        </div>
      </div>

      {/* Stats Cards — click to toggle real-time alerts */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">Total Insights</p>
            <Activity className="h-5 w-5 text-primary" />
          </div>
          <p className="mt-2 text-3xl font-bold">{stats.total}</p>
        </div>
        {([
          { severity: 'critical' as const, label: 'Critical', icon: AlertTriangle, count: stats.critical,
            active: 'bg-red-50 dark:bg-red-900/20 ring-2 ring-red-500/20',
            text: 'text-red-800 dark:text-red-200', iconColor: 'text-red-600 dark:text-red-400',
            countColor: 'text-red-900 dark:text-red-100', dotColor: 'bg-red-500' },
          { severity: 'warning' as const, label: 'Warnings', icon: AlertCircle, count: stats.warning,
            active: 'bg-amber-50 dark:bg-amber-900/20 ring-2 ring-amber-500/20',
            text: 'text-amber-800 dark:text-amber-200', iconColor: 'text-amber-600 dark:text-amber-400',
            countColor: 'text-amber-900 dark:text-amber-100', dotColor: 'bg-amber-500' },
          { severity: 'info' as const, label: 'Info', icon: Info, count: stats.info,
            active: 'bg-blue-50 dark:bg-blue-900/20 ring-2 ring-blue-500/20',
            text: 'text-blue-800 dark:text-blue-200', iconColor: 'text-blue-600 dark:text-blue-400',
            countColor: 'text-blue-900 dark:text-blue-100', dotColor: 'bg-blue-500' },
        ]).map((card) => {
          const isSubscribed = subscribedSeverities.has(card.severity);
          const Icon = card.icon;
          return (
            <div
              key={card.severity}
              className={cn(
                'rounded-lg border p-4 cursor-pointer transition-all',
                isSubscribed ? card.active : 'bg-card opacity-60'
              )}
              onClick={() => handleSeverityToggle(card.severity)}
              title={isSubscribed ? `Click to pause ${card.label.toLowerCase()} live alerts` : `Click to enable ${card.label.toLowerCase()} live alerts`}
            >
              <div className="flex items-center justify-between">
                <p className={cn('text-sm font-medium', card.text)}>{card.label}</p>
                <Icon className={cn('h-5 w-5', card.iconColor)} />
              </div>
              <p className={cn('mt-2 text-3xl font-bold', card.countColor)}>
                {card.count}
              </p>
              <div className="mt-2 flex items-center gap-1.5">
                <span className={cn(
                  'h-2 w-2 rounded-full',
                  isSubscribed ? card.dotColor + ' animate-pulse' : 'bg-muted-foreground/40'
                )} />
                <span className="text-xs text-muted-foreground">
                  {isSubscribed ? 'Live alerts' : 'Paused'}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Severity Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2 overflow-x-auto rounded-lg border bg-card p-1">
        <button
          onClick={() => setSeverityFilter('all')}
          className={cn(
            'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap',
            severityFilter === 'all'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          <Filter className="h-4 w-4" />
          All
          <span
            className={cn(
              'rounded-full px-1.5 py-0.5 text-xs',
              severityFilter === 'all'
                ? 'bg-primary-foreground/20'
                : 'bg-muted-foreground/20'
            )}
          >
            {stats.total}
          </span>
        </button>
        {(['critical', 'warning', 'info'] as const).map((severity) => {
          const config = {
            critical: { icon: AlertTriangle, label: 'Critical', count: stats.critical },
            warning: { icon: AlertCircle, label: 'Warnings', count: stats.warning },
            info: { icon: Info, label: 'Info', count: stats.info },
          }[severity];

          const Icon = config.icon;

          return (
            <button
              key={severity}
              onClick={() => setSeverityFilter(severity)}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap',
                severityFilter === severity
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <Icon className="h-4 w-4" />
              {config.label}
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-xs',
                  severityFilter === severity
                    ? 'bg-primary-foreground/20'
                    : 'bg-muted-foreground/20'
                )}
              >
                {config.count}
              </span>
            </button>
          );
        })}
        <div className="mx-1 hidden h-6 w-px bg-border sm:block" />
        <button
          onClick={() => setAcknowledgementFilter('all')}
          className={cn(
            'rounded-md px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap',
            acknowledgementFilter === 'all'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          All Statuses
        </button>
        <button
          onClick={() => setAcknowledgementFilter('unacknowledged')}
          className={cn(
            'rounded-md px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap',
            acknowledgementFilter === 'unacknowledged'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          Unacknowledged
        </button>
      </div>

      {/* Correlated Anomalies */}
      {(correlatedLoading || (correlatedAnomalies && correlatedAnomalies.length > 0)) && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            <h2 className="text-lg font-semibold">
              Correlated Anomalies
              {correlatedAnomalies && correlatedAnomalies.length > 0 && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({correlatedAnomalies.length})
                </span>
              )}
            </h2>
          </div>
          {correlatedLoading ? (
            <div className="grid gap-4 md:grid-cols-2">
              <SkeletonCard className="h-[180px]" />
              <SkeletonCard className="h-[180px]" />
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {correlatedAnomalies!.map((anomaly) => (
                <CorrelatedAnomalyCard key={anomaly.containerId} anomaly={anomaly} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Active Incidents */}
      {incidentsData && incidentsData.incidents.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            <h2 className="text-lg font-semibold">
              Active Incidents
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({incidentsData.counts.active} active)
              </span>
            </h2>
          </div>
          {incidentsData.incidents.map((incident) => (
            <IncidentCard
              key={incident.id}
              incident={incident}
              onResolve={(id) => resolveIncidentMutation.mutate(id)}
            />
          ))}
        </div>
      )}

      {/* Insights Feed */}
      {isLoading ? (
        <SkeletonCard className="h-[400px]" />
      ) : filteredInsights.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/20 p-12 text-center">
          <Activity className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold">No insights</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {acknowledgementFilter === 'unacknowledged'
              ? 'No unacknowledged insights match the current filters.'
              : severityFilter === 'all'
                ? 'AI monitoring has not generated any insights yet. Check back soon.'
                : `No ${severityFilter} insights found. Try a different filter.`}
          </p>
          {!subscribedSeverities.has(severityFilter as Severity) && severityFilter !== 'all' && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
              You are not subscribed to {severityFilter} severity. Click the stat card above to subscribe.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredInsights.map((insight) => (
            <InsightCard
              key={insight.id}
              insight={insight}
              investigation={getInvestigationForInsight(insight.id)}
              onAcknowledge={acknowledgeInsight}
              isAcknowledging={acknowledgingInsightId === insight.id}
              acknowledgeErrorMessage={acknowledgeError instanceof Error ? acknowledgeError.message : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
