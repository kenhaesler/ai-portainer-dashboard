import {
  Radio,
  RefreshCw,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  Server,
  ShieldCheck,
  ShieldOff,
  ShieldQuestion,
  Unplug,
  Ban,
} from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  useEbpfCoverage,
  useEbpfCoverageSummary,
  useSyncCoverage,
  useVerifyCoverage,
  useDeployBeyla,
  useDisableBeyla,
  useEnableBeyla,
  useRemoveBeyla,
} from '@/hooks/use-ebpf-coverage';
import type { CoverageRecord } from '@/hooks/use-ebpf-coverage';
import { StatusBadge } from '@/components/shared/status-badge';
import { SkeletonCard } from '@/components/shared/loading-skeleton';
import { formatDate } from '@/lib/utils';
import { SpotlightCard } from '@/components/shared/spotlight-card';

/** Human-readable labels for coverage statuses */
const STATUS_LABELS: Record<string, string> = {
  deployed: 'Deployed',
  planned: 'Planned',
  excluded: 'Excluded',
  failed: 'Failed',
  unknown: 'Unknown',
  not_deployed: 'Not Deployed',
  unreachable: 'Unreachable',
  incompatible: 'Incompatible',
};

/** Hint text shown below the status badge */
const STATUS_HINTS: Record<string, string> = {
  not_deployed: 'Endpoint reachable but no Beyla container found',
  unreachable: 'Could not connect to endpoint to check for Beyla',
  incompatible: 'Endpoint type not supported (ACI, Kubernetes, etc.)',
};

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'deployed':
      return <ShieldCheck className="h-4 w-4 text-emerald-500" />;
    case 'planned':
      return <Server className="h-4 w-4 text-blue-500" />;
    case 'excluded':
      return <ShieldOff className="h-4 w-4 text-gray-500" />;
    case 'failed':
      return <AlertTriangle className="h-4 w-4 text-red-500" />;
    case 'not_deployed':
      return <ShieldQuestion className="h-4 w-4 text-blue-500" />;
    case 'unreachable':
      return <Unplug className="h-4 w-4 text-orange-500" />;
    case 'incompatible':
      return <Ban className="h-4 w-4 text-gray-400" />;
    default:
      return <ShieldQuestion className="h-4 w-4 text-yellow-500" />;
  }
}

function SummaryBar() {
  const { data: summary, isLoading } = useEbpfCoverageSummary();

  if (isLoading || !summary) {
    return <SkeletonCard className="h-16" />;
  }

  const missing = summary.total - summary.deployed;

  return (
    <div
      data-testid="coverage-summary"
      className="spotlight-card flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card p-4"
    >
      <div className="flex items-center gap-2">
        <Radio className="h-5 w-5 text-primary" />
        <span className="text-sm font-semibold">
          Coverage: {summary.deployed}/{summary.total} endpoints ({summary.coveragePercent}%)
        </span>
      </div>
      <span className="text-sm text-muted-foreground">|</span>
      <span className="text-sm text-muted-foreground">
        Missing: {missing}
      </span>
      <span className="text-sm text-muted-foreground">|</span>
      <span className="text-sm text-muted-foreground">
        Failed: {summary.failed}
      </span>
      <span className="text-sm text-muted-foreground">|</span>
      <span className="text-sm text-muted-foreground">
        Planned: {summary.planned}
      </span>
      {(summary.unreachable > 0) && (
        <>
          <span className="text-sm text-muted-foreground">|</span>
          <span className="text-sm text-orange-600 dark:text-orange-400">
            Unreachable: {summary.unreachable}
          </span>
        </>
      )}
      {(summary.incompatible > 0) && (
        <>
          <span className="text-sm text-muted-foreground">|</span>
          <span className="text-sm text-muted-foreground">
            Incompatible: {summary.incompatible}
          </span>
        </>
      )}
    </div>
  );
}

function CoverageRow({
  record,
}: {
  record: CoverageRecord;
}) {
  const [pendingAction, setPendingAction] = useState<null | {
    action: 'deploy' | 'disable' | 'enable' | 'remove';
    title: string;
    description: string;
    destructive?: boolean;
  }>(null);
  const [deployOtlpEndpoint, setDeployOtlpEndpoint] = useState(record.otlp_endpoint_override || '');

  const verifyMutation = useVerifyCoverage();
  const deployMutation = useDeployBeyla();
  const disableMutation = useDisableBeyla();
  const enableMutation = useEnableBeyla();
  const removeMutation = useRemoveBeyla();
  const hint = STATUS_HINTS[record.status];
  const mutationPending =
    verifyMutation.isPending ||
    deployMutation.isPending ||
    disableMutation.isPending ||
    enableMutation.isPending ||
    removeMutation.isPending;

  const openActionDialog = (action: 'deploy' | 'disable' | 'enable' | 'remove') => {
    if (action === 'deploy') {
      setPendingAction({
        action: 'deploy',
        title: `Deploy Beyla to ${record.endpoint_name}?`,
        description:
          'This creates/starts a privileged grafana/beyla container with host PID and required kernel mounts. ' +
          'Enter only dashboard IP/hostname. The system automatically builds /api/traces/otlp for you.',
      });
      const existing = record.otlp_endpoint_override || '';
      const hostOnly = existing
        .replace(/^https?:\/\//, '')
        .replace(/\/api\/traces\/otlp$/, '')
        .replace(/\/$/, '');
      setDeployOtlpEndpoint(hostOnly);
      return;
    }

    if (action === 'disable') {
      setPendingAction({
        action: 'disable',
        title: `Disable Beyla on ${record.endpoint_name}?`,
        description: 'This stops the existing Beyla container but keeps it for quick re-enable.',
      });
      return;
    }

    if (action === 'enable') {
      setPendingAction({
        action: 'enable',
        title: `Enable Beyla on ${record.endpoint_name}?`,
        description: 'This starts the existing Beyla container on this endpoint.',
      });
      return;
    }

    setPendingAction({
      action: 'remove',
      title: `Remove Beyla from ${record.endpoint_name}?`,
      description: 'This stops and removes the Beyla container from this endpoint.',
      destructive: true,
    });
  };

  const runPendingAction = () => {
    if (!pendingAction) return;
    if (pendingAction.action === 'deploy') {
      deployMutation.mutate({
        endpointId: record.endpoint_id,
        otlpEndpoint: deployOtlpEndpoint.trim() || undefined,
      });
    }
    if (pendingAction.action === 'disable') disableMutation.mutate(record.endpoint_id);
    if (pendingAction.action === 'enable') enableMutation.mutate(record.endpoint_id);
    if (pendingAction.action === 'remove') removeMutation.mutate({ endpointId: record.endpoint_id, force: true });
    setPendingAction(null);
  };

  const canDisable = record.status === 'deployed';
  const canEnable = record.status === 'failed';
  const canToggle = canDisable || canEnable;
  const showRemoveToggle = record.status === 'deployed' || record.status === 'failed';
  const canDeploy = !showRemoveToggle && record.status !== 'incompatible';

  return (
    <>
      <tr
        className="border-b border-border last:border-0 transition-colors hover:bg-muted/50"
        data-testid="coverage-row"
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <StatusIcon status={record.status} />
            <span className="font-medium">{record.endpoint_name}</span>
            <span className="text-xs text-muted-foreground">(ID: {record.endpoint_id})</span>
          </div>
        </td>
        <td className="px-4 py-3">
          <div className="flex flex-col gap-1">
            <StatusBadge status={record.status} label={STATUS_LABELS[record.status]} />
            {hint && (
              <span className="text-xs text-muted-foreground" data-testid="status-hint">
                {hint}
              </span>
            )}
            {record.status === 'excluded' && record.exclusion_reason && (
              <span className="text-xs text-muted-foreground">
                {record.exclusion_reason}
              </span>
            )}
          </div>
        </td>
        <td className="px-4 py-3 text-sm text-muted-foreground">
          {formatDate(record.last_trace_at)}
        </td>
        <td className="px-4 py-3 text-sm text-muted-foreground">
          {formatDate(record.last_verified_at)}
        </td>
        <td className="px-4 py-3">
          <div className="flex flex-nowrap items-center gap-2">
            <button
              onClick={() => verifyMutation.mutate(record.endpoint_id)}
              disabled={mutationPending || record.status === 'incompatible'}
              className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              data-testid="verify-btn"
              title={record.status === 'incompatible' ? 'Cannot verify incompatible endpoints' : 'Verify trace ingestion'}
            >
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Verify
              </span>
            </button>
            <button
              onClick={() => openActionDialog(canDisable ? 'disable' : 'enable')}
              disabled={mutationPending || !canToggle}
              className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              data-testid="toggle-btn"
            >
              {canDisable ? 'Disable' : 'Enable'}
            </button>
            {showRemoveToggle ? (
              <button
                onClick={() => openActionDialog('remove')}
                disabled={mutationPending}
                className="rounded-md border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/40"
                data-testid="remove-btn"
              >
                Remove
              </button>
            ) : (
              <button
                onClick={() => openActionDialog('deploy')}
                disabled={mutationPending || !canDeploy}
                className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                data-testid="deploy-btn"
              >
                Deploy
              </button>
            )}
          </div>
        </td>
      </tr>
      {pendingAction && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center" data-testid="ebpf-action-dialog">
          <div className="fixed inset-0 bg-black/50" onClick={() => setPendingAction(null)} />
          <div className="relative z-50 w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
            <h3 className="text-lg font-semibold">{pendingAction.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{pendingAction.description}</p>
            {pendingAction.action === 'deploy' && (
              <div className="mt-4 space-y-2">
                <label htmlFor={`otlp-endpoint-${record.endpoint_id}`} className="block text-xs font-semibold text-muted-foreground">
                  Dashboard IP/Hostname (optional)
                </label>
                <input
                  id={`otlp-endpoint-${record.endpoint_id}`}
                  type="text"
                  placeholder="192.168.178.20"
                  value={deployOtlpEndpoint}
                  onChange={(e) => setDeployOtlpEndpoint(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  data-testid="deploy-otlp-input"
                />
                <p className="text-xs text-muted-foreground">
                  Auto format: <code>http://&lt;value&gt;:3051/api/traces/otlp</code>. Leave empty for default routing.
                </p>
              </div>
            )}
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setPendingAction(null)}
                disabled={mutationPending}
                className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={runPendingAction}
                disabled={mutationPending}
                className={`rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ${
                  pendingAction.destructive
                    ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90'
                }`}
              >
                {mutationPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

export default function EbpfCoveragePage() {
  const { data, isLoading } = useEbpfCoverage();
  const syncMutation = useSyncCoverage();

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">eBPF Coverage</h1>
          <p className="text-sm text-muted-foreground">
            Track Beyla (eBPF tracer) deployment status across all Portainer endpoints.
          </p>
        </div>
        <button
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          data-testid="sync-btn"
        >
          <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
          Sync Endpoints
        </button>
      </div>

      {/* Summary bar */}
      <SummaryBar />

      {/* Coverage table */}
      {isLoading ? (
        <SkeletonCard className="h-64" />
      ) : (
        <SpotlightCard className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-left" data-testid="coverage-table">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Endpoint
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Status
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Last Trace
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Last Verified
                </th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {data?.coverage && data.coverage.length > 0 ? (
                data.coverage.map((record) => (
                  <CoverageRow
                    key={record.endpoint_id}
                    record={record}
                  />
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No endpoints found. Click &quot;Sync Endpoints&quot; to load endpoints from Portainer.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </SpotlightCard>
      )}
    </div>
  );
}
