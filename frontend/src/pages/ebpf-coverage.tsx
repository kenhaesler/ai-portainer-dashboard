import {
  Radio,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Server,
  ShieldCheck,
  ShieldOff,
  ShieldQuestion,
  Unplug,
  Ban,
} from 'lucide-react';
import {
  useEbpfCoverage,
  useEbpfCoverageSummary,
  useUpdateCoverageStatus,
  useSyncCoverage,
  useVerifyCoverage,
} from '@/hooks/use-ebpf-coverage';
import type { CoverageRecord } from '@/hooks/use-ebpf-coverage';
import { StatusBadge } from '@/components/shared/status-badge';
import { SkeletonCard } from '@/components/shared/loading-skeleton';
import { formatDate } from '@/lib/utils';

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
      className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card p-4"
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

function CoverageRow({ record }: { record: CoverageRecord }) {
  const updateMutation = useUpdateCoverageStatus();
  const verifyMutation = useVerifyCoverage();
  const hint = STATUS_HINTS[record.status];
  const deploymentActionLabel = record.status === 'deployed' ? 'Remove' : 'Deploy';
  const enablementActionLabel = record.status === 'excluded' ? 'Enable' : 'Disable';
  const isIncompatible = record.status === 'incompatible';

  function handleDeploymentAction() {
    updateMutation.mutate({
      endpointId: record.endpoint_id,
      status: record.status === 'deployed' ? 'not_deployed' : 'deployed',
    });
  }

  function handleEnablementAction() {
    updateMutation.mutate({
      endpointId: record.endpoint_id,
      status: record.status === 'excluded' ? 'planned' : 'excluded',
      reason: record.status === 'excluded' ? undefined : 'Manually disabled from coverage page',
    });
  }

  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors">
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
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleDeploymentAction}
            disabled={updateMutation.isPending || isIncompatible}
            className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
            data-testid="deploy-remove-btn"
            title={isIncompatible ? 'Cannot deploy to incompatible endpoints' : undefined}
          >
            {deploymentActionLabel}
          </button>
          <button
            onClick={handleEnablementAction}
            disabled={updateMutation.isPending}
            className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
            data-testid="enable-disable-btn"
          >
            {enablementActionLabel}
          </button>
          <button
            onClick={() => verifyMutation.mutate(record.endpoint_id)}
            disabled={verifyMutation.isPending || isIncompatible}
            className="flex items-center gap-1 rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
            data-testid="verify-btn"
            title={isIncompatible ? 'Cannot verify incompatible endpoints' : 'Verify trace ingestion'}
          >
            <CheckCircle2 className="h-3 w-3" />
            Verify
          </button>
        </div>
      </td>
    </tr>
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
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
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
                  <CoverageRow key={record.endpoint_id} record={record} />
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
        </div>
      )}
    </div>
  );
}
