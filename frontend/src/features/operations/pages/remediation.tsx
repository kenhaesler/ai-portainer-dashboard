import { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Play,
  Clock,
  ThumbsUp,
  ThumbsDown,
  Loader2,
  Bot,
  Box,
  Filter,
  MessageSquare,
  Regex,
} from 'lucide-react';
import {
  useRemediationActions,
  useApproveAction,
  useRejectAction,
  useExecuteAction,
} from '@/features/operations/hooks/use-remediation';
import { useEndpoints } from '@/features/containers/hooks/use-endpoints';
import { useAutoRefresh } from '@/shared/hooks/use-auto-refresh';
import { StatusBadge } from '@/shared/components/feedback/status-badge';
import { RefreshControls } from '@/shared/components/ui/refresh-controls';
import { ConfirmDialog } from '@/shared/components/feedback/confirm-dialog';
import { SkeletonChart } from '@/shared/components/feedback/skeleton';
import { EmptyState } from '@/shared/components/feedback/empty-state';
import { DataTable } from '@/shared/components/tables/data-table';
import { PageHeader } from '@/shared/components/layout/page-header';
import { useSockets } from '@/providers/socket-provider';
import { useAuth } from '@/providers/auth-provider';
import { cn, formatDate } from '@/shared/lib/utils';
import { SpotlightCard } from '@/shared/components/data-display/spotlight-card';

type ActionStatus = 'all' | 'pending' | 'approved' | 'rejected' | 'executing' | 'completed' | 'failed';

const STATUS_TABS: { value: ActionStatus; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'all', label: 'All', icon: Filter },
  { value: 'pending', label: 'Pending', icon: Clock },
  { value: 'approved', label: 'Approved', icon: ThumbsUp },
  { value: 'executing', label: 'Executing', icon: Loader2 },
  { value: 'completed', label: 'Completed', icon: CheckCircle2 },
  { value: 'failed', label: 'Failed', icon: XCircle },
  { value: 'rejected', label: 'Rejected', icon: ThumbsDown },
];

const ACTION_TYPE_LABELS: Record<string, string> = {
  RESTART_CONTAINER: 'Restart Container',
  STOP_CONTAINER: 'Stop Container',
  START_CONTAINER: 'Start Container',
  INVESTIGATE: 'Investigate',
  SCALE_UP: 'Scale Up',
  SCALE_DOWN: 'Scale Down',
};

type ActionRecord = {
  id: string;
  type?: string;
  action_type?: string;
  status: string;
  container_id?: string;
  containerId?: string;
  container_name?: string;
  containerName?: string;
  endpoint_id?: number;
  endpointId?: number;
  rationale?: string;
  description?: string;
  suggested_by?: string;
  suggestedBy?: string;
  created_at?: string;
  createdAt?: string;
  approved_by?: string;
  approvedBy?: string;
  rejected_by?: string;
  rejectedBy?: string;
  rejection_reason?: string;
  rejectionReason?: string;
  execution_result?: string;
  result?: string;
};

/**
 * Action types that interrupt a running workload. These get the destructive
 * dialog treatment; `INVESTIGATE` and the scale actions do not stop traffic.
 */
const DISRUPTIVE_ACTION_TYPES = new Set(['STOP_CONTAINER', 'RESTART_CONTAINER']);

/** Per-type consequence line for the execute confirmation. Says what happens, not that it "performs an operation". */
const ACTION_CONSEQUENCES: Record<string, string> = {
  RESTART_CONTAINER: 'The container stops and starts again. In-flight requests are dropped.',
  STOP_CONTAINER: 'The container stops and does not start again on its own.',
  START_CONTAINER: 'The container starts with its existing configuration.',
  INVESTIGATE: 'Diagnostics only — nothing on the container changes.',
  SCALE_UP: 'The container is recreated with higher resource limits.',
  SCALE_DOWN: 'The container is recreated with lower resource limits.',
};

interface ActionDescription {
  /** "Restart Container" */
  actionType: string;
  actionLabel: string;
  containerName: string;
  endpointLabel: string;
  /** "Restart Container on api-service" — what toasts and dialogs quote. */
  label: string;
  consequence: string;
  isDisruptive: boolean;
}

/**
 * Everything a confirmation or a toast needs to name *this* action rather than
 * "this remediation action". With 28 rows on screen a dialog that renders
 * identically for every one cannot catch a mis-click.
 */
function describeAction(
  action: ActionRecord,
  endpointName?: string,
): ActionDescription {
  const actionType = action.action_type || action.type || 'UNKNOWN_ACTION';
  const actionLabel = ACTION_TYPE_LABELS[actionType] || actionType;
  const containerName = action.container_name || action.containerName || 'an unnamed container';
  const endpointId = action.endpoint_id ?? action.endpointId;
  const endpointLabel = endpointName
    ?? (endpointId != null ? `endpoint ${endpointId}` : 'an unknown endpoint');
  return {
    actionType,
    actionLabel,
    containerName,
    endpointLabel,
    label: `${actionLabel} on ${containerName}`,
    consequence: ACTION_CONSEQUENCES[actionType] ?? `Runs ${actionLabel} against this container.`,
    isDisruptive: DISRUPTIVE_ACTION_TYPES.has(actionType),
  };
}

type AnalysisPriority = 'high' | 'medium' | 'low';
type AnalysisSeverity = 'critical' | 'warning' | 'info';

const ANALYSIS_SEVERITIES: AnalysisSeverity[] = ['critical', 'warning', 'info'];

/**
 * Where the rationale text came from. `pattern-match` is a fixed string picked
 * by the regex table in `remediation-service.ts`; only `llm-analysis` is model
 * output. Mirrors `RationaleSourceSchema` in `@dashboard/contracts`.
 */
type AnalysisSource = 'pattern-match' | 'llm-analysis';

interface ParsedAnalysis {
  root_cause: string;
  /** Null when the model supplied no severity — render no badge, never a default. */
  severity: AnalysisSeverity | null;
  log_analysis: string;
  /** Null when the model supplied no score — render no badge, never a default. */
  confidence_score: number | null;
  analysis_source?: AnalysisSource;
  recommended_actions: Array<{
    action: string;
    priority: AnalysisPriority;
    rationale: string;
  }>;
}

function parseActionAnalysis(raw: string | undefined): ParsedAnalysis | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.root_cause !== 'string') return null;
    // null/absent is a first-class value for both badges: it means "the model
    // supplied none", which must render as no badge. Only a present-but-
    // wrong-typed value rejects the payload — rejecting on null would drop the
    // whole analysis and fall back to printing raw JSON as prose.
    const rawConfidence = parsed.confidence_score;
    if (rawConfidence != null && typeof rawConfidence !== 'number') return null;
    const rawSeverity = parsed.severity;
    if (rawSeverity != null && !ANALYSIS_SEVERITIES.includes(rawSeverity as AnalysisSeverity)) return null;
    if (!Array.isArray(parsed.recommended_actions)) return null;

    const recommendedActions = parsed.recommended_actions
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const entry = item as Record<string, unknown>;
        const action = typeof entry.action === 'string' ? entry.action : '';
        const priority = entry.priority === 'high' || entry.priority === 'medium' || entry.priority === 'low'
          ? entry.priority
          : 'medium';
        const rationale = typeof entry.rationale === 'string' ? entry.rationale : '';
        if (!action) return null;
        return { action, priority, rationale };
      })
      .filter((item): item is ParsedAnalysis['recommended_actions'][number] => item !== null);

    return {
      root_cause: parsed.root_cause,
      severity: rawSeverity == null ? null : (rawSeverity as AnalysisSeverity),
      log_analysis: typeof parsed.log_analysis === 'string' ? parsed.log_analysis : '',
      confidence_score: rawConfidence == null ? null : Math.max(0, Math.min(1, rawConfidence)),
      analysis_source:
        parsed.analysis_source === 'pattern-match' || parsed.analysis_source === 'llm-analysis'
          ? parsed.analysis_source
          : undefined,
      recommended_actions: recommendedActions,
    };
  } catch {
    return null;
  }
}

/**
 * Provenance of a row's rationale text.
 *
 * A rationale that does not parse as JSON is always one of the five fixed
 * strings from the `ACTION_PATTERNS` regex table, so it is `pattern-match` by
 * construction. A parsed analysis carries its own `analysis_source`; when an
 * older stored payload omits it the source is genuinely unknown, and we say so
 * rather than asserting a bot wrote it.
 */
function resolveAnalysisSource(rationale: string | undefined): AnalysisSource | null {
  if (!rationale) return null;
  const parsed = parseActionAnalysis(rationale);
  if (!parsed) return 'pattern-match';
  return parsed.analysis_source ?? null;
}

/**
 * One line of "why this was suggested", for the confirmation dialog. Prefers
 * the parsed root cause; falls back to the stored text as written.
 */
function rationaleSummary(action: ActionRecord): string | null {
  const raw = action.rationale || action.description;
  if (!raw) return null;
  const parsed = parseActionAnalysis(raw);
  return parsed ? parsed.root_cause : raw;
}

/**
 * Renders the parsed AI analysis (or raw rationale) for a single action with a
 * collapsible "Show more / Show less" toggle. Owns the local expansion state so
 * each row can expand independently inside the DataTable.
 */
function AnalysisSummaryCell({ action }: { action: ActionRecord }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const rationale = action.rationale || action.description || 'No rationale provided';
  const parsedAnalysis = parseActionAnalysis(rationale);
  const severityLabel = parsedAnalysis?.severity
    ? `${parsedAnalysis.severity.charAt(0).toUpperCase()}${parsedAnalysis.severity.slice(1)}`
    : null;
  const severityClasses = parsedAnalysis?.severity === 'critical'
    ? 'text-red-700 bg-red-100 dark:bg-red-900/30 dark:text-red-300'
    : parsedAnalysis?.severity === 'warning'
      ? 'text-amber-700 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300'
      : 'text-blue-700 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300';
  const structuredContentLength = parsedAnalysis
    ? (
      parsedAnalysis.root_cause.length
      + parsedAnalysis.log_analysis.length
      + parsedAnalysis.recommended_actions.reduce(
        (total, recommendation) => total + recommendation.action.length + recommendation.rationale.length,
        0,
      )
    )
    : 0;
  const shouldCollapse = parsedAnalysis
    ? (
      parsedAnalysis.log_analysis.length > 0
      || parsedAnalysis.recommended_actions.length > 0
      || structuredContentLength > 220
    )
    : rationale.length > 180;

  return (
    <div className="max-w-sm space-y-2 align-top">
      {parsedAnalysis ? (
        <div
          className={cn(
            'space-y-2 text-xs',
            shouldCollapse && !isExpanded && 'max-h-28 overflow-hidden'
          )}
        >
        {/* Both badges are omitted when the model supplied no value. A default
            rendered as an authoritative measurement is worse than no badge. */}
        {(severityLabel || parsedAnalysis.confidence_score !== null) && (
          <div className="flex flex-wrap items-center gap-2">
            {severityLabel && (
              <span className={cn('rounded px-2 py-0.5 font-medium', severityClasses)}>
                {severityLabel}
              </span>
            )}
            {parsedAnalysis.confidence_score !== null && (
              <span className="rounded bg-muted px-2 py-0.5 font-medium text-foreground">
                Confidence: {(parsedAnalysis.confidence_score * 100).toFixed(0)}%
              </span>
            )}
          </div>
        )}
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">Root Cause:</span> {parsedAnalysis.root_cause}
        </p>
        {parsedAnalysis.log_analysis && (
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">Log Analysis:</span> {parsedAnalysis.log_analysis}
          </p>
        )}
        {parsedAnalysis.recommended_actions.length > 0 && (
          <div className="space-y-1">
            <p className="font-medium text-foreground">Recommended Actions:</p>
            {parsedAnalysis.recommended_actions.map((recommendation, index) => (
              <p key={`${recommendation.action}-${index}`} className="text-muted-foreground">
                <span className="font-medium text-foreground">
                  {recommendation.priority.toUpperCase()}:
                </span>{' '}
                {recommendation.action}
                {recommendation.rationale ? ` - ${recommendation.rationale}` : ''}
              </p>
            ))}
          </div>
        )}
        </div>
      ) : (
        <p
          className={cn(
            'text-xs text-muted-foreground',
            shouldCollapse && !isExpanded && 'line-clamp-3'
          )}
          title={rationale}
        >
          {rationale}
        </p>
      )}
      {shouldCollapse && (
        <button
          onClick={() => setIsExpanded((prev) => !prev)}
          className="text-xs font-medium text-primary hover:underline"
          aria-expanded={isExpanded}
        >
          {isExpanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

/**
 * Where a suggestion came from — the honesty mechanism this page gets right.
 *
 * A rule-derived rationale is fixed text chosen by a keyword match, not model
 * output, and it must not wear the bot. Unknown provenance asserts nothing.
 * Extracted from the old "Suggested By" column so it can ride under the
 * container name without losing any of that distinction.
 */
function SuggestedBy({ action }: { action: ActionRecord }) {
  const source = resolveAnalysisSource(action.rationale || action.description);
  const suggestedBy = action.suggested_by || action.suggestedBy;

  if (source === 'pattern-match') {
    return (
      <span
        className="inline-flex items-center gap-1"
        title="Fixed text selected by a keyword rule, not model output"
      >
        <Regex className="h-3 w-3" />
        Pattern match
      </span>
    );
  }

  if (source === 'llm-analysis') {
    return (
      <span
        className="inline-flex items-center gap-1"
        title="Generated by the LLM from logs and metrics"
      >
        <Bot className="h-3 w-3" />
        {suggestedBy || 'AI analysis'}
      </span>
    );
  }

  return <span>{suggestedBy || 'Source unrecorded'}</span>;
}

/**
 * Who decided, why, and what happened when it ran.
 *
 * The backend has written `approved_by`, `rejected_by`, `rejection_reason` and
 * `execution_result` since the queue existed and none of them reached the
 * screen — a Failed row rendered the word "Failed" and nothing else. An
 * approval queue exists to carry accountability; without these four fields it
 * carries only state.
 */
function DecisionCell({ action }: { action: ActionRecord }) {
  const approvedBy = action.approved_by || action.approvedBy;
  const rejectedBy = action.rejected_by || action.rejectedBy;
  const rejectionReason = action.rejection_reason || action.rejectionReason;
  const executionResult = action.execution_result || action.result;
  const isFailed = action.status === 'failed';

  // Nothing to show until someone decides. This used to render "Awaiting
  // approval" beside a Status column already reading "Pending" — the same
  // fact in two vocabularies, in adjacent columns, on every pending row.
  // Once decided the column carries real audit value (who, why, result),
  // which is why it still exists.
  if (action.status === 'pending') {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const decidedBy = rejectedBy
    ? { verb: 'Rejected by', who: rejectedBy }
    : approvedBy
      ? { verb: 'Approved by', who: approvedBy }
      : null;

  return (
    <div className="max-w-[15rem] space-y-1 text-xs">
      {decidedBy ? (
        <p className="text-muted-foreground">
          {decidedBy.verb} <span className="font-medium text-foreground">{decidedBy.who}</span>
        </p>
      ) : (
        // Never invent an approver. A row that reached a decided state without
        // one is a gap in the audit trail and should read as one.
        <p className="text-muted-foreground">No approver recorded</p>
      )}
      {rejectionReason && (
        <p className="text-muted-foreground break-words">Reason: {rejectionReason}</p>
      )}
      {executionResult && (
        <p className={cn('break-words', isFailed ? 'text-destructive' : 'text-muted-foreground')}>
          Result: {executionResult}
        </p>
      )}
      {isFailed && !executionResult && (
        <p className="text-muted-foreground">No failure detail recorded</p>
      )}
    </div>
  );
}

interface ActionButtonsCellProps {
  action: ActionRecord;
  onApprove: (action: ActionRecord) => void;
  onReject: (action: ActionRecord) => void;
  onExecute: (action: ActionRecord) => void;
  onDiscuss: (action: ActionRecord) => void;
  isApproving: boolean;
  isRejecting: boolean;
  isExecuting: boolean;
  /**
   * Every backend mutation on this queue is `requireRole('admin')`. Rendering
   * the controls to everyone promises a decision the server will refuse.
   */
  canDecide: boolean;
}

/**
 * Renders the per-row remediation controls (Discuss / Approve / Reject /
 * Execute) plus the terminal-status indicators. Action gating and handler
 * wiring are unchanged from the original table — this only relocates the
 * markup into a DataTable cell.
 */
function ActionButtonsCell({
  action,
  onApprove,
  onReject,
  onExecute,
  onDiscuss,
  isApproving,
  isRejecting,
  isExecuting,
  canDecide,
}: ActionButtonsCellProps) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onDiscuss(action)}
        className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-xs font-medium hover:bg-accent"
      >
        <MessageSquare className="h-3 w-3" />
        Discuss with AI
      </button>
      {canDecide && action.status === 'pending' && (
        <>
          <button
            onClick={() => onApprove(action)}
            disabled={isApproving}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-200 disabled:opacity-50 dark:bg-emerald-900/30 dark:text-emerald-400"
          >
            {isApproving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ThumbsUp className="h-3 w-3" />
            )}
            Approve
          </button>
          <button
            onClick={() => onReject(action)}
            disabled={isRejecting}
            className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-200 disabled:opacity-50 dark:bg-red-900/30 dark:text-red-400"
          >
            {isRejecting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ThumbsDown className="h-3 w-3" />
            )}
            Reject
          </button>
        </>
      )}
      {canDecide && action.status === 'approved' && (
        <button
          onClick={() => onExecute(action)}
          disabled={isExecuting}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isExecuting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Play className="h-3 w-3" />
          )}
          Execute
        </button>
      )}
      {!canDecide && (action.status === 'pending' || action.status === 'approved') && (
        <span className="text-xs text-muted-foreground">Admin decision required</span>
      )}
      {action.status === 'executing' && (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Running...
        </span>
      )}
      {action.status === 'completed' && (
        <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-3 w-3" />
          Done
        </span>
      )}
      {action.status === 'failed' && (
        <span className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
          <XCircle className="h-3 w-3" />
          Failed
        </span>
      )}
      {action.status === 'rejected' && (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <ThumbsDown className="h-3 w-3" />
          Rejected
        </span>
      )}
    </div>
  );
}

export default function RemediationPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { remediationSocket } = useSockets();
  const { role } = useAuth();
  // Every mutation on this queue is `requireRole('admin')` server-side. This
  // gate only stops the UI promising a decision the API will refuse — it is
  // not, and must not be treated as, the enforcement point.
  const canDecide = role === 'admin';
  const [statusFilter, setStatusFilter] = useState<ActionStatus>('all');
  const [pendingDecision, setPendingDecision] = useState<
    { kind: 'approve' | 'reject' | 'execute'; action: ActionRecord } | null
  >(null);
  const [rejectReason, setRejectReason] = useState('');
  const { data: endpoints } = useEndpoints();

  // Fetch actions
  const {
    data: actionsData,
    isLoading: actionsLoading,
    isPending: actionsPending,
    isError,
    error,
    refetch,
    isFetching,
  } = useRemediationActions(statusFilter === 'all' ? undefined : statusFilter);
  // The hook owns the timer. Without `onTick` the interval dropdown and its
  // pulsing "live" dot schedule nothing.
  const { interval, setRefreshInterval } = useAutoRefresh(30, {
    onTick: () => { void refetch(); },
  });
  // Treat both isLoading and isPending-without-data as "loading" to avoid
  // rendering a blank page during SPA navigation before data arrives.
  const isLoading = actionsLoading || (actionsPending && !actionsData);

  // Mutations
  const approveAction = useApproveAction();
  const rejectAction = useRejectAction();
  const executeAction = useExecuteAction();

  // Process actions data
  const actions = useMemo<ActionRecord[]>(() => {
    if (!actionsData) return [];
    // Handle both array and object response formats
    return Array.isArray(actionsData) ? actionsData : (actionsData as any).actions || [];
  }, [actionsData]);

  useEffect(() => {
    if (!remediationSocket) return;
    const refreshActions = () => {
      queryClient.invalidateQueries({ queryKey: ['remediation', 'actions'] });
    };
    remediationSocket.on('actions:new', refreshActions);
    remediationSocket.on('actions:updated', refreshActions);
    return () => {
      remediationSocket.off('actions:new', refreshActions);
      remediationSocket.off('actions:updated', refreshActions);
    };
  }, [queryClient, remediationSocket]);

  // Stats
  const stats = useMemo(() => {
    const all = Array.isArray(actionsData) ? actionsData : (actionsData as any)?.actions || [];
    return {
      total: all.length,
      pending: all.filter((a: any) => a.status === 'pending').length,
      approved: all.filter((a: any) => a.status === 'approved').length,
      executing: all.filter((a: any) => a.status === 'executing').length,
      completed: all.filter((a: any) => a.status === 'completed').length,
      failed: all.filter((a: any) => a.status === 'failed').length,
      rejected: all.filter((a: any) => a.status === 'rejected').length,
    };
  }, [actionsData]);

  const endpointNameById = useMemo(() => {
    const byId = new Map<number, string>();
    for (const endpoint of endpoints ?? []) byId.set(endpoint.id, endpoint.name);
    return byId;
  }, [endpoints]);

  const describe = useCallback(
    (action: ActionRecord) => {
      const endpointId = action.endpoint_id ?? action.endpointId;
      return describeAction(
        action,
        endpointId != null ? endpointNameById.get(endpointId) : undefined,
      );
    },
    [endpointNameById],
  );

  // All three decisions route through the same confirmation state, so none of
  // them can regress to a bare one-click mutation.
  const handleApprove = useCallback((action: ActionRecord) => {
    setPendingDecision({ kind: 'approve', action });
  }, []);

  const handleReject = useCallback((action: ActionRecord) => {
    setRejectReason('');
    setPendingDecision({ kind: 'reject', action });
  }, []);

  const handleExecuteClick = useCallback((action: ActionRecord) => {
    setPendingDecision({ kind: 'execute', action });
  }, []);

  const closeDecision = useCallback(() => {
    setPendingDecision(null);
    setRejectReason('');
  }, []);

  const decisionDescription = pendingDecision ? describe(pendingDecision.action) : null;

  const handleDecisionConfirm = () => {
    if (!pendingDecision || !decisionDescription) return;
    const ref = { actionId: pendingDecision.action.id, label: decisionDescription.label };
    const onSettled = () => closeDecision();
    if (pendingDecision.kind === 'approve') {
      approveAction.mutate(ref, { onSettled });
    } else if (pendingDecision.kind === 'reject') {
      rejectAction.mutate({ ...ref, reason: rejectReason }, { onSettled });
    } else {
      executeAction.mutate(ref, { onSettled });
    }
  };

  const handleDiscuss = useCallback((action: ActionRecord) => {
    const actionType = action.action_type || action.type || 'UNKNOWN_ACTION';
    const containerName = action.container_name || action.containerName || 'unknown';
    const containerId = action.container_id || action.containerId || 'unknown';
    const prompt = [
      'I need guidance on this remediation action before approval.',
      `Action: ${ACTION_TYPE_LABELS[actionType] || actionType}`,
      `Container: ${containerName}`,
      `Container ID: ${containerId}`,
      `Endpoint ID: ${action.endpoint_id || action.endpointId || 'unknown'}`,
      `Status: ${action.status}`,
      `Analysis Summary: ${action.rationale || action.description || 'none provided'}`,
      '',
      'Please explain:',
      '1) Why this action is appropriate',
      '2) Safer alternatives and tradeoffs',
      '3) What quick checks I should run first',
    ].join('\n');

    navigate('/assistant', {
      state: {
        prefillPrompt: prompt,
        source: 'remediation',
        actionId: action.id,
        containerName,
        containerSummary: action.rationale || action.description || undefined,
      },
    });
  }, [navigate]);

  // Per-row pending flags depend on the in-flight mutation variables. Read them
  // here so the columns memo recomputes when any mutation starts/settles.
  const approvingId = approveAction.isPending ? approveAction.variables?.actionId : undefined;
  const rejectingId = rejectAction.isPending ? rejectAction.variables?.actionId : undefined;
  const executingId = executeAction.isPending ? executeAction.variables?.actionId : undefined;

  const columns = useMemo<ColumnDef<ActionRecord, unknown>[]>(() => [
    {
      id: 'container',
      header: 'Container',
      enableSorting: false,
      // Action type and provenance ride along as chips under the name rather
      // than owning columns of their own. On a queue where every row is an
      // "Investigate" suggested by "Pattern match", those two columns held 64
      // identical cells between them and squeezed Analysis Summary — the only
      // column with varying content — to ~110px, wrapping it over eight lines
      // and making rows 190px tall so three fit on screen.
      cell: ({ row }) => {
        const action = row.original;
        const containerId = action.container_id || action.containerId || '';
        const containerName = action.container_name || action.containerName || 'unknown';
        const actionType = action.action_type || action.type || 'Unknown';
        return (
          <div className="flex items-start gap-2">
            <Box className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="font-medium" title={containerId ? `Container ID: ${containerId}` : undefined}>
                {containerName}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span>{ACTION_TYPE_LABELS[actionType] || actionType}</span>
                <span aria-hidden="true">·</span>
                <SuggestedBy action={action} />
              </div>
            </div>
          </div>
        );
      },
    },
    {
      id: 'status',
      header: 'Status',
      enableSorting: false,
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: 'decision',
      header: 'Decision',
      enableSorting: false,
      cell: ({ row }) => <DecisionCell action={row.original} />,
    },
    {
      id: 'created',
      header: 'Created',
      enableSorting: false,
      cell: ({ row }) => {
        const createdAt = row.original.created_at || row.original.createdAt || '';
        return (
          <span className="text-sm text-muted-foreground">
            {createdAt ? formatDate(createdAt) : '-'}
          </span>
        );
      },
    },
    {
      id: 'analysis_summary',
      header: 'Analysis Summary',
      enableSorting: false,
      cell: ({ row }) => <AnalysisSummaryCell action={row.original} />,
    },
    {
      id: 'actions',
      header: 'Actions',
      enableSorting: false,
      cell: ({ row }) => {
        const action = row.original;
        return (
          <ActionButtonsCell
            action={action}
            onApprove={handleApprove}
            onReject={handleReject}
            onExecute={handleExecuteClick}
            onDiscuss={handleDiscuss}
            isApproving={approvingId === action.id}
            isRejecting={rejectingId === action.id}
            isExecuting={executingId === action.id}
            canDecide={canDecide}
          />
        );
      },
    },
  ], [handleApprove, handleReject, handleExecuteClick, handleDiscuss, approvingId, rejectingId, executingId, canDecide]);

  // A queue where a human approves everything is not self-healing; the old
  // subtitle contradicted itself in four words. This one carries live state.
  const subtitle = `${stats.pending} action${stats.pending === 1 ? '' : 's'} awaiting approval · nothing runs without you`;

  // Error state
  if (isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Remediation" subtitle={subtitle} />
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
          <p className="mt-4 font-medium text-destructive">Failed to load actions</p>
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
    <div className="space-y-6">
      <PageHeader
        title="Remediation"
        subtitle={subtitle}
        actions={(
          <RefreshControls
            interval={interval}
            onIntervalChange={setRefreshInterval}
            onRefresh={() => refetch()}
            isLoading={isFetching}
          />
        )}
      />

      {!canDecide && (
        <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
          Approving, rejecting and executing actions require the admin role. You can review the
          queue and open any action in the assistant.
        </div>
      )}

      {/*
        The four KPI tiles that stood here restated the filter chips 60px below
        them — same numbers, except the chips are clickable and two of the four
        read 0 on any fresh install. The chips are the surface that does
        something, so they are the surface that keeps the counts.
      */}

      {/* Status Filter Tabs */}
      <SpotlightCard>
      <div className="flex items-center gap-1 overflow-x-auto rounded-lg border bg-card p-1 shadow-sm">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap',
              statusFilter === tab.value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <tab.icon className={cn('h-4 w-4', tab.value === 'executing' && statusFilter === tab.value && 'animate-spin')} />
            {tab.label}
            {tab.value !== 'all' && (
              <span className={cn(
                'rounded-full px-1.5 py-0.5 text-xs',
                statusFilter === tab.value
                  ? 'bg-primary-foreground/20'
                  : 'bg-muted-foreground/20'
              )}>
                {stats[tab.value as keyof typeof stats] || 0}
              </span>
            )}
          </button>
        ))}
      </div>
      </SpotlightCard>

      {/* Actions Table */}
      {isLoading ? (
        <SkeletonChart size="lg" className="h-[400px]" />
      ) : actions.length === 0 ? (
        <EmptyState
          icon={Box}
          title="No actions queued"
          // Most rationales in this queue come from a keyword rule table, not a
          // model, so the empty state does not credit "AI monitoring" for them.
          description={statusFilter === 'all'
            ? 'Nothing is waiting for approval. Actions appear here when the monitoring pipeline raises an insight against a container.'
            : `No actions with status "${statusFilter}".`}
        />
      ) : (
        <SpotlightCard>
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <DataTable
            columns={columns}
            data={actions}
            getRowId={(action) => action.id}
            hideSearch
            minTableWidth={1000}
          />
        </div>
        </SpotlightCard>
      )}

      {/*
        One dialog for all three decisions. It names the action, the container
        and the endpoint, and quotes the rationale the decision rests on — the
        fixed "Are you sure you want to execute this remediation action?" it
        replaces rendered identically for every row, so it could not catch a
        mis-click.
      */}
      {pendingDecision && decisionDescription && (
        <ConfirmDialog
          open
          data-testid="remediation-decision-dialog"
          title={
            pendingDecision.kind === 'approve'
              ? `Approve ${decisionDescription.actionLabel} on ${decisionDescription.containerName}`
              : pendingDecision.kind === 'reject'
                ? `Reject ${decisionDescription.actionLabel} on ${decisionDescription.containerName}`
                : `Run ${decisionDescription.actionLabel} on ${decisionDescription.containerName} now`
          }
          description={
            pendingDecision.kind === 'approve'
              ? 'Approving records your decision. Nothing runs until you press Execute.'
              : pendingDecision.kind === 'reject'
                ? 'Rejecting closes this action. It cannot be approved afterwards.'
                : decisionDescription.consequence
          }
          confirmLabel={
            pendingDecision.kind === 'approve'
              ? 'Approve'
              : pendingDecision.kind === 'reject'
                ? 'Reject'
                : decisionDescription.actionLabel
          }
          variant={
            pendingDecision.kind === 'reject'
              ? 'warning'
              : pendingDecision.kind === 'execute' && decisionDescription.isDisruptive
                ? 'danger'
                : 'default'
          }
          isLoading={
            pendingDecision.kind === 'approve'
              ? approveAction.isPending
              : pendingDecision.kind === 'reject'
                ? rejectAction.isPending
                : executeAction.isPending
          }
          onConfirm={handleDecisionConfirm}
          onCancel={closeDecision}
        >
          <dl className="mt-4 space-y-1.5 rounded-md border bg-muted/30 p-3 text-xs">
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-muted-foreground">Container</dt>
              <dd className="min-w-0 break-words font-medium">{decisionDescription.containerName}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-muted-foreground">Endpoint</dt>
              <dd className="min-w-0 break-words font-medium">{decisionDescription.endpointLabel}</dd>
            </div>
            {(() => {
              const summary = rationaleSummary(pendingDecision.action);
              if (!summary) return null;
              const source = resolveAnalysisSource(
                pendingDecision.action.rationale || pendingDecision.action.description,
              );
              return (
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-muted-foreground">
                    {source === 'pattern-match'
                      ? 'Rule text'
                      : source === 'llm-analysis'
                        ? 'LLM analysis'
                        : 'Rationale'}
                  </dt>
                  <dd className="min-w-0 break-words text-muted-foreground">{summary}</dd>
                </div>
              );
            })()}
          </dl>
          {pendingDecision.kind === 'reject' && (
            <label className="mt-3 block text-xs">
              <span className="mb-1 block text-muted-foreground">
                Reason (optional — stored with the rejection)
              </span>
              <textarea
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                rows={2}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Restarting would drop the nightly import that is still running."
              />
            </label>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
