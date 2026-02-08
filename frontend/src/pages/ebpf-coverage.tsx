import { useState } from 'react';
import {
  Radio,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Server,
  ShieldCheck,
  ShieldOff,
  ShieldQuestion,
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

const STATUS_OPTIONS = ['planned', 'deployed', 'excluded', 'failed', 'unknown'] as const;

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
    </div>
  );
}

function CoverageRow({ record }: { record: CoverageRecord }) {
  const [editing, setEditing] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState(record.status);
  const [reason, setReason] = useState(record.exclusion_reason ?? '');
  const updateMutation = useUpdateCoverageStatus();
  const verifyMutation = useVerifyCoverage();

  function handleSave() {
    updateMutation.mutate(
      { endpointId: record.endpoint_id, status: selectedStatus, reason: reason || undefined },
      { onSuccess: () => setEditing(false) },
    );
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
        {editing ? (
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value as typeof selectedStatus)}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            data-testid="status-select"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ) : (
          <StatusBadge status={record.status} />
        )}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {record.exclusion_reason || '-'}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {formatDate(record.last_trace_at)}
      </td>
      <td className="px-4 py-3 text-sm text-muted-foreground">
        {formatDate(record.last_verified_at)}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              {selectedStatus === 'excluded' && (
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason..."
                  className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                />
              )}
              <button
                onClick={handleSave}
                disabled={updateMutation.isPending}
                className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setSelectedStatus(record.status);
                  setReason(record.exclusion_reason ?? '');
                }}
                className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-muted"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setEditing(true)}
                className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-muted"
                data-testid="edit-status-btn"
              >
                Update Status
              </button>
              <button
                onClick={() => verifyMutation.mutate(record.endpoint_id)}
                disabled={verifyMutation.isPending}
                className="flex items-center gap-1 rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
                data-testid="verify-btn"
              >
                <CheckCircle2 className="h-3 w-3" />
                Verify
              </button>
            </>
          )}
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
                  Exclusion Reason
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
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No endpoints found. Click "Sync Endpoints" to load endpoints from Portainer.
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
