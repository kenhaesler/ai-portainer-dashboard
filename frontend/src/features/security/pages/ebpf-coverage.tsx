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
  MoreHorizontal,
} from 'lucide-react';
import { useState } from 'react';
import {
  useEbpfCoverage,
  useSyncCoverage,
  useVerifyCoverage,
  useDeployBeyla,
  useDisableBeyla,
  useEnableBeyla,
  useRemoveBeyla,
  useDeleteStaleCoverage,
} from '@/features/security/hooks/use-ebpf-coverage';
import type { CoverageRecord } from '@/features/security/hooks/use-ebpf-coverage';
import { useEndpoints } from '@/features/containers/hooks/use-endpoints';
import { useAuth } from '@/providers/auth-provider';
import { StatusBadge } from '@/shared/components/feedback/status-badge';
import { ConfirmDialog } from '@/shared/components/feedback/confirm-dialog';
import { SkeletonText, SkeletonChart } from '@/shared/components/feedback/skeleton';
import { SpotlightCard } from '@/shared/components/data-display/spotlight-card';
import { PageHeader } from '@/shared/components/layout/page-header';
import { formatDate } from '@/shared/lib/utils';

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

const NOT_ADMIN_TITLE = 'Requires the admin role';

/** An endpoint known to Portainer but not yet to the coverage table. */
const NO_COVERAGE_RECORD_HINT =
  'Endpoint known to Portainer with no coverage record yet — Sync Endpoints or Deploy to create one';

export interface CoverageRow extends CoverageRecord {
  /** Row synthesised from the live endpoint list, not read from the DB. */
  synthetic?: boolean;
}

/**
 * One row per endpoint the app knows about.
 *
 * The page used to render only what `/api/ebpf/coverage` returned, so before a
 * Sync it reported an empty fleet — `Coverage: 0/0 endpoints (0%)` — while five
 * other pages showed the live endpoint and its containers. The endpoint list
 * was never unknown; only its coverage state was.
 */
export function mergeEndpointCoverage(
  coverage: CoverageRecord[],
  endpoints: Array<{ id: number; name: string }>,
): CoverageRow[] {
  const byEndpointId = new Map(coverage.map((record) => [record.endpoint_id, record]));

  const rows: CoverageRow[] = endpoints.map((endpoint) => {
    const record = byEndpointId.get(endpoint.id);
    if (record) return record;
    return {
      endpoint_id: endpoint.id,
      endpoint_name: endpoint.name,
      status: 'unknown',
      exclusion_reason: null,
      deployment_profile: null,
      last_trace_at: null,
      last_verified_at: null,
      created_at: '',
      updated_at: '',
      synthetic: true,
    };
  });

  // Coverage rows whose endpoint no longer exists in Portainer are exactly the
  // stale records "Delete stale" is for — they must stay visible.
  const liveIds = new Set(endpoints.map((endpoint) => endpoint.id));
  for (const record of coverage) {
    if (!liveIds.has(record.endpoint_id)) rows.push(record);
  }

  return rows;
}

export interface CoverageTotals {
  total: number;
  deployed: number;
  missing: number;
  failed: number;
  planned: number;
  unreachable: number;
  incompatible: number;
  coveragePercent: number;
}

/** Counted from the rows on screen, so the bar cannot contradict the table. */
export function summarizeCoverage(rows: CoverageRow[]): CoverageTotals {
  const countOf = (status: string) => rows.filter((row) => row.status === status).length;
  const total = rows.length;
  const deployed = countOf('deployed');
  return {
    total,
    deployed,
    missing: total - deployed,
    failed: countOf('failed'),
    planned: countOf('planned'),
    unreachable: countOf('unreachable'),
    incompatible: countOf('incompatible'),
    coveragePercent: total === 0 ? 0 : Math.round((deployed / total) * 100),
  };
}

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

function SummaryBar({ summary, isLoading }: { summary: CoverageTotals; isLoading: boolean }) {
  if (isLoading) {
    return <SkeletonText lines={2} />;
  }

  // Every counter here is structurally zero when there are no endpoints, and
  // the percentage is 0/0. The table's empty state already says what to do.
  if (summary.total === 0) return null;

  // Counters are suppressed at zero — the rule the unreachable/incompatible
  // pair already followed.
  const counters: Array<{ label: string; value: number; className?: string }> = [
    { label: 'Missing', value: summary.missing },
    { label: 'Failed', value: summary.failed },
    { label: 'Planned', value: summary.planned },
    { label: 'Unreachable', value: summary.unreachable, className: 'text-orange-600 dark:text-orange-400' },
    { label: 'Incompatible', value: summary.incompatible },
  ].filter((counter) => counter.value > 0);

  return (
    <SpotlightCard>
    <div
      data-testid="coverage-summary"
      className="flex flex-wrap items-center gap-4 rounded-lg border bg-card p-6 shadow-sm"
    >
      <div className="flex items-center gap-2">
        <Radio className="h-5 w-5 text-primary" />
        <span className="text-sm font-semibold">
          Coverage: {summary.deployed}/{summary.total} endpoints ({summary.coveragePercent}%)
        </span>
      </div>
      {counters.map((counter) => (
        <span key={counter.label} className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground" aria-hidden="true">|</span>
          <span className={`text-sm ${counter.className ?? 'text-muted-foreground'}`}>
            {counter.label}: {counter.value}
          </span>
        </span>
      ))}
    </div>
    </SpotlightCard>
  );
}

function CoverageRow({
  record,
  canMutate,
}: {
  record: CoverageRow;
  /** Every action below is `requireRole('admin')` on the backend. */
  canMutate: boolean;
}) {
  const [pendingAction, setPendingAction] = useState<null | {
    action: 'deploy' | 'disable' | 'enable' | 'remove' | 'delete_stale';
    title: string;
    description: string;
    destructive?: boolean;
  }>(null);
  const [showOverflow, setShowOverflow] = useState(false);
  const [deployOtlpEndpoint, setDeployOtlpEndpoint] = useState(record.otlp_endpoint_override || '');

  const verifyMutation = useVerifyCoverage();
  const deployMutation = useDeployBeyla();
  const disableMutation = useDisableBeyla();
  const enableMutation = useEnableBeyla();
  const removeMutation = useRemoveBeyla();
  const deleteStaleMutation = useDeleteStaleCoverage();
  const hint = record.synthetic ? NO_COVERAGE_RECORD_HINT : STATUS_HINTS[record.status];
  const mutationPending =
    verifyMutation.isPending ||
    deployMutation.isPending ||
    disableMutation.isPending ||
    enableMutation.isPending ||
    removeMutation.isPending ||
    deleteStaleMutation.isPending;

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

  const openDeleteStaleDialog = () => {
    setShowOverflow(false);
    setPendingAction({
      action: 'delete_stale',
      title: `Delete stale endpoint ${record.endpoint_name}?`,
      description: 'This removes only the local eBPF coverage metadata row from the dashboard database.',
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
    if (pendingAction.action === 'delete_stale') deleteStaleMutation.mutate(record.endpoint_id);
    setPendingAction(null);
  };

  const canDisable = record.status === 'deployed';
  const canEnable = record.status === 'failed';
  const canToggle = canDisable || canEnable;

  /**
   * Why Enable/Disable is unavailable, in the operator's terms.
   *
   * `Enable` only applies to a deployment that previously failed, which is not
   * discoverable from a greyed button. On a fresh install every row is
   * `unknown`, so this was the state most operators met first.
   */
  const toggleDisabledReason = !canMutate
    ? NOT_ADMIN_TITLE
    : canToggle
      ? null
      : record.status === 'incompatible'
        ? 'This endpoint cannot run Beyla'
        : 'Enable applies to a deployment that failed. Use Deploy to install the tracer first.';
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
              disabled={!canMutate || mutationPending || record.status === 'incompatible'}
              className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              data-testid="verify-btn"
              title={
                !canMutate
                  ? NOT_ADMIN_TITLE
                  : record.status === 'incompatible'
                    ? 'Cannot verify incompatible endpoints'
                    : 'Verify trace ingestion'
              }
            >
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Verify
              </span>
            </button>
            <button
              onClick={() => openActionDialog(canDisable ? 'disable' : 'enable')}
              disabled={!canMutate || mutationPending || !canToggle}
              className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              data-testid="toggle-btn"
              // Every disabled state names its reason. This was
              // `canMutate ? undefined : NOT_ADMIN_TITLE`, so an admin looking
              // at the common `unknown` row got a greyed button with no
              // tooltip at all — the only dead end on the page, sitting beside
              // two live buttons.
              title={toggleDisabledReason ?? undefined}
            >
              {canDisable ? 'Disable' : 'Enable'}
            </button>
            {showRemoveToggle ? (
              <button
                onClick={() => openActionDialog('remove')}
                disabled={!canMutate || mutationPending}
                className="rounded-md border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/40"
                data-testid="remove-btn"
                title={canMutate ? 'Stops and removes the Beyla container' : NOT_ADMIN_TITLE}
              >
                Remove
              </button>
            ) : (
              <button
                onClick={() => openActionDialog('deploy')}
                disabled={!canMutate || mutationPending || !canDeploy}
                className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                data-testid="deploy-btn"
                title={canMutate ? undefined : NOT_ADMIN_TITLE}
              >
                Deploy
              </button>
            )}
            {/* "Delete stale" removes a database row; "Remove" tears down a
                deployed tracer. They no longer sit side by side looking alike. */}
            {!record.synthetic && (
              <div className="relative">
                <button
                  onClick={() => setShowOverflow((prev) => !prev)}
                  disabled={!canMutate || mutationPending}
                  aria-expanded={showOverflow}
                  aria-haspopup="menu"
                  className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                  data-testid="row-overflow-btn"
                  title={canMutate ? 'More actions' : NOT_ADMIN_TITLE}
                >
                  <MoreHorizontal className="h-3 w-3" aria-hidden="true" />
                  <span className="sr-only">More actions for {record.endpoint_name}</span>
                </button>
                {showOverflow && (
                  <div
                    role="menu"
                    className="absolute right-0 z-10 mt-1 w-48 rounded-md border border-border bg-card p-1 shadow-lg"
                    onKeyDown={(e) => { if (e.key === 'Escape') setShowOverflow(false); }}
                  >
                    <button
                      role="menuitem"
                      onClick={openDeleteStaleDialog}
                      className="w-full rounded px-2 py-1.5 text-left text-xs font-medium hover:bg-muted"
                      data-testid="delete-stale-btn"
                      title="Deletes the dashboard's coverage row only"
                    >
                      Delete stale record
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </td>
      </tr>
      {pendingAction && (
        <ConfirmDialog
          open
          title={pendingAction.title}
          description={pendingAction.description}
          variant={pendingAction.destructive ? 'danger' : 'default'}
          isLoading={mutationPending}
          onConfirm={runPendingAction}
          onCancel={() => setPendingAction(null)}
          data-testid="ebpf-action-dialog"
        >
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
        </ConfirmDialog>
      )}
    </>
  );
}

export default function EbpfCoveragePage() {
  const { data, isLoading: coverageLoading, isPending: coveragePending } = useEbpfCoverage();
  const { data: endpoints, isLoading: endpointsLoading } = useEndpoints();
  const { role } = useAuth();
  const canMutate = role === 'admin';
  // Treat both isLoading and isPending-without-data as "loading" to avoid
  // rendering a blank page during SPA navigation before data arrives.
  const isLoading = coverageLoading || (coveragePending && !data) || endpointsLoading;
  const syncMutation = useSyncCoverage();

  const rows = mergeEndpointCoverage(data?.coverage ?? [], endpoints ?? []);
  const summary = summarizeCoverage(rows);

  return (
    <div className="space-y-6">
      <PageHeader
        title="eBPF Coverage"
        subtitle="Track Beyla (eBPF tracer) deployment status across all Portainer endpoints."
        actions={
          <button
            onClick={() => syncMutation.mutate()}
            disabled={!canMutate || syncMutation.isPending}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            data-testid="sync-btn"
            title={canMutate ? undefined : NOT_ADMIN_TITLE}
          >
            <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
            Sync Endpoints
          </button>
        }
      />

      {/* Summary bar */}
      <SummaryBar summary={summary} isLoading={isLoading} />

      {/* Coverage table */}
      {isLoading ? (
        <SkeletonChart size="md" className="h-64" />
      ) : (
        <SpotlightCard>
        <div className="overflow-x-auto rounded-lg border bg-card shadow-sm">
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
              {rows.length > 0 ? (
                rows.map((record) => (
                  <CoverageRow
                    key={record.endpoint_id}
                    record={record}
                    canMutate={canMutate}
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
        </div>
        </SpotlightCard>
      )}
    </div>
  );
}
