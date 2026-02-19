import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
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
  Server,
  RefreshCw,
  Filter,
  MessageSquare,
} from 'lucide-react';
import {
  useRemediationActions,
  useApproveAction,
  useRejectAction,
  useExecuteAction,
} from '@/hooks/use-remediation';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import { StatusBadge } from '@/components/shared/status-badge';
import { AutoRefreshToggle } from '@/components/shared/auto-refresh-toggle';
import { RefreshButton } from '@/components/shared/refresh-button';
import { SkeletonCard } from '@/components/shared/loading-skeleton';
import { useSockets } from '@/providers/socket-provider';
import { cn, formatDate } from '@/lib/utils';

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
  execution_result?: string;
  result?: string;
};

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  confirmVariant?: 'default' | 'destructive';
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

type AnalysisPriority = 'high' | 'medium' | 'low';
type AnalysisSeverity = 'critical' | 'warning' | 'info';

interface ParsedAnalysis {
  root_cause: string;
  severity: AnalysisSeverity;
  log_analysis: string;
  confidence_score: number;
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
    if (typeof parsed.root_cause !== 'string' || typeof parsed.confidence_score !== 'number') return null;
    if (!['critical', 'warning', 'info'].includes(String(parsed.severity))) return null;
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
      severity: parsed.severity as AnalysisSeverity,
      log_analysis: typeof parsed.log_analysis === 'string' ? parsed.log_analysis : '',
      confidence_score: Math.max(0, Math.min(1, parsed.confidence_score)),
      recommended_actions: recommendedActions,
    };
  } catch {
    return null;
  }
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  confirmVariant = 'default',
  isLoading,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative z-50 w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className={cn(
              'rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50',
              confirmVariant === 'destructive'
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            )}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ActionRowProps {
  action: ActionRecord;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onExecute: (id: string) => void;
  onDiscuss: (action: ActionRecord) => void;
  isApproving: boolean;
  isRejecting: boolean;
  isExecuting: boolean;
}

function ActionRow({
  action,
  onApprove,
  onReject,
  onExecute,
  onDiscuss,
  isApproving,
  isRejecting,
  isExecuting,
}: ActionRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const actionType = action.action_type || action.type || 'Unknown';
  const containerId = action.container_id || action.containerId || '';
  const containerName = action.container_name || action.containerName || 'unknown';
  const createdAt = action.created_at || action.createdAt || '';
  const suggestedBy = action.suggested_by || action.suggestedBy || 'AI Monitor';
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
    <tr className="border-b transition-colors hover:bg-muted/30">
      <td className="p-4">
        <span className="font-medium">
          {ACTION_TYPE_LABELS[actionType] || actionType}
        </span>
      </td>
      <td className="p-4">
        <div className="flex items-center gap-2">
          <Box className="h-4 w-4 text-muted-foreground" />
          <p className="font-medium" title={containerId ? `Container ID: ${containerId}` : undefined}>
            {containerName}
          </p>
        </div>
      </td>
      <td className="p-4">
        <StatusBadge status={action.status} />
      </td>
      <td className="p-4">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm">{suggestedBy}</span>
        </div>
      </td>
      <td className="p-4">
        <span className="text-sm text-muted-foreground">
          {createdAt ? formatDate(createdAt) : '-'}
        </span>
      </td>
      <td className="p-4 max-w-sm align-top">
        <div className="space-y-2">
          {parsedAnalysis ? (
            <div
              className={cn(
                'space-y-2 text-xs',
                shouldCollapse && !isExpanded && 'max-h-28 overflow-hidden'
              )}
            >
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn('rounded px-2 py-0.5 font-medium', severityClasses)}>
                {severityLabel}
              </span>
              <span className="rounded bg-muted px-2 py-0.5 font-medium text-foreground">
                Confidence: {(parsedAnalysis.confidence_score * 100).toFixed(0)}%
              </span>
            </div>
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
      </td>
      <td className="p-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onDiscuss(action)}
            className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-xs font-medium hover:bg-accent"
          >
            <MessageSquare className="h-3 w-3" />
            Discuss with AI
          </button>
          {action.status === 'pending' && (
            <>
              <button
                onClick={() => onApprove(action.id)}
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
                onClick={() => onReject(action.id)}
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
          {action.status === 'approved' && (
            <button
              onClick={() => onExecute(action.id)}
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
      </td>
    </tr>
  );
}

export default function RemediationPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { remediationSocket } = useSockets();
  const [statusFilter, setStatusFilter] = useState<ActionStatus>('all');
  const [executeDialogOpen, setExecuteDialogOpen] = useState(false);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const { interval, setInterval } = useAutoRefresh(30);

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
  // Treat both isLoading and isPending-without-data as "loading" to avoid
  // rendering a blank page during SPA navigation before data arrives.
  const isLoading = actionsLoading || (actionsPending && !actionsData);

  // Mutations
  const approveAction = useApproveAction();
  const rejectAction = useRejectAction();
  const executeAction = useExecuteAction();

  // Process actions data
  const actions = useMemo(() => {
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

  const handleApprove = (id: string) => {
    approveAction.mutate(id);
  };

  const handleReject = (id: string) => {
    rejectAction.mutate(id);
  };

  const handleExecuteClick = (id: string) => {
    setSelectedActionId(id);
    setExecuteDialogOpen(true);
  };

  const handleExecuteConfirm = () => {
    if (selectedActionId) {
      executeAction.mutate(selectedActionId, {
        onSettled: () => {
          setExecuteDialogOpen(false);
          setSelectedActionId(null);
        },
      });
    }
  };

  const handleDiscuss = (action: ActionRecord) => {
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
  };

  // Error state
  if (isError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Remediation</h1>
          <p className="text-muted-foreground">
            Human-approved self-healing action queue
          </p>
        </div>
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Remediation</h1>
          <p className="text-muted-foreground">
            Human-approved self-healing action queue
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoRefreshToggle interval={interval} onIntervalChange={setInterval} />
          <RefreshButton onClick={() => refetch()} isLoading={isFetching} />
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border bg-amber-50 dark:bg-amber-900/20 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Pending Approval</p>
            <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>
          <p className="mt-2 text-3xl font-bold text-amber-900 dark:text-amber-100">{stats.pending}</p>
        </div>
        <div className="rounded-lg border bg-blue-50 dark:bg-blue-900/20 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-blue-800 dark:text-blue-200">Approved</p>
            <ThumbsUp className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <p className="mt-2 text-3xl font-bold text-blue-900 dark:text-blue-100">{stats.approved}</p>
        </div>
        <div className="rounded-lg border bg-emerald-50 dark:bg-emerald-900/20 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">Completed</p>
            <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="mt-2 text-3xl font-bold text-emerald-900 dark:text-emerald-100">{stats.completed}</p>
        </div>
        <div className="rounded-lg border bg-red-50 dark:bg-red-900/20 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-red-800 dark:text-red-200">Failed</p>
            <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
          </div>
          <p className="mt-2 text-3xl font-bold text-red-900 dark:text-red-100">{stats.failed}</p>
        </div>
      </div>

      {/* Status Filter Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto rounded-lg border bg-card p-1">
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

      {/* Actions Table */}
      {isLoading ? (
        <SkeletonCard className="h-[400px]" />
      ) : actions.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/20 p-12 text-center">
          <Box className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold">No remediation actions</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {statusFilter === 'all'
              ? 'AI monitoring has not suggested any remediation actions yet.'
              : `No actions with status "${statusFilter}" found.`}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-4 text-left text-sm font-medium text-muted-foreground">Action Type</th>
                  <th className="p-4 text-left text-sm font-medium text-muted-foreground">Container</th>
                  <th className="p-4 text-left text-sm font-medium text-muted-foreground">Status</th>
                  <th className="p-4 text-left text-sm font-medium text-muted-foreground">Suggested By</th>
                  <th className="p-4 text-left text-sm font-medium text-muted-foreground">Created</th>
                  <th className="p-4 text-left text-sm font-medium text-muted-foreground">Analysis Summary</th>
                  <th className="p-4 text-left text-sm font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {actions.map((action: any) => (
                  <ActionRow
                    key={action.id}
                    action={action}
                    onApprove={handleApprove}
                    onReject={handleReject}
                    onExecute={handleExecuteClick}
                    onDiscuss={handleDiscuss}
                    isApproving={approveAction.isPending && approveAction.variables === action.id}
                    isRejecting={rejectAction.isPending && rejectAction.variables === action.id}
                    isExecuting={executeAction.isPending && executeAction.variables === action.id}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Execute Confirmation Dialog */}
      <ConfirmDialog
        open={executeDialogOpen}
        title="Execute Remediation Action"
        description="Are you sure you want to execute this remediation action? This will perform the suggested operation on the target container."
        confirmLabel="Execute"
        isLoading={executeAction.isPending}
        onConfirm={handleExecuteConfirm}
        onCancel={() => {
          setExecuteDialogOpen(false);
          setSelectedActionId(null);
        }}
      />
    </div>
  );
}
