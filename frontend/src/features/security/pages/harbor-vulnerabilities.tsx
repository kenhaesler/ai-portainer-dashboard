import { useEffect, useMemo, useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import {
  Shield, ShieldAlert, ShieldCheck, Search, RefreshCw,
  ExternalLink, AlertTriangle, CheckCircle2, Package, Bug,
} from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { ThemedSelect } from '@/shared/components/ui/themed-select';
import { DataTable } from '@/shared/components/tables/data-table';
import { SpotlightCard } from '@/shared/components/data-display/spotlight-card';
import {
  useHarborStatus,
  useHarborVulnerabilities,
  useTriggerHarborSync,
  type VulnerabilityRecord,
} from '@/features/security/hooks/use-harbor-vulnerabilities';

const severityOptions = [
  { value: 'all', label: 'All Severities' },
  { value: 'Critical', label: 'Critical' },
  { value: 'High', label: 'High' },
  { value: 'Medium', label: 'Medium' },
  { value: 'Low', label: 'Low' },
] as const;

const inUseOptions = [
  { value: 'all', label: 'All Images' },
  { value: 'true', label: 'In Use' },
  { value: 'false', label: 'Not In Use' },
] as const;

function severityBadgeClass(severity: string): string {
  switch (severity) {
    case 'Critical':
      return 'bg-red-500/15 text-red-700 dark:text-red-400';
    case 'High':
      return 'bg-orange-500/15 text-orange-700 dark:text-orange-400';
    case 'Medium':
      return 'bg-amber-500/15 text-amber-700 dark:text-amber-400';
    case 'Low':
      return 'bg-blue-500/15 text-blue-700 dark:text-blue-400';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function parseContainers(json: string | null): Array<{ id: string; name: string; endpoint: number }> {
  if (!json) return [];
  try { return JSON.parse(json); } catch { return []; }
}

function parseTags(json: string | null): string[] {
  if (!json) return [];
  try { return JSON.parse(json); } catch { return []; }
}

function parseLinks(json: string | null): string[] {
  if (!json) return [];
  try { return JSON.parse(json); } catch { return []; }
}

export default function HarborVulnerabilitiesPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSeverity, setSelectedSeverity] = useState<string>('all');
  const [selectedInUse, setSelectedInUse] = useState<string>('all');
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  const { data: status } = useHarborStatus();
  const { data, isLoading, isError, error, refetch } = useHarborVulnerabilities({
    severity: selectedSeverity !== 'all' ? selectedSeverity : undefined,
    inUse: selectedInUse !== 'all' ? selectedInUse === 'true' : undefined,
    limit: 500,
  });
  const triggerSync = useTriggerHarborSync();

  const vulnerabilities = data?.vulnerabilities ?? [];
  const summary = data?.summary;

  const filtered = useMemo(() => {
    if (!searchQuery) return vulnerabilities;
    const q = searchQuery.toLowerCase();
    return vulnerabilities.filter(
      (v) =>
        v.cve_id.toLowerCase().includes(q) ||
        v.package.toLowerCase().includes(q) ||
        v.repository_name.toLowerCase().includes(q),
    );
  }, [vulnerabilities, searchQuery]);

  const expandedVuln = useMemo(
    () => filtered.find((v) => v.id === expandedRow) ?? null,
    [filtered, expandedRow],
  );

  // Collapse the detail panel if its row drops out of the current filter, so it
  // doesn't silently reopen when the same row reappears.
  useEffect(() => {
    if (expandedRow !== null && !filtered.some((v) => v.id === expandedRow)) {
      setExpandedRow(null);
    }
  }, [filtered, expandedRow]);

  const columns = useMemo<ColumnDef<VulnerabilityRecord, unknown>[]>(() => [
    {
      accessorKey: 'cve_id',
      header: 'CVE',
      cell: ({ getValue }) => <span className="font-mono text-xs">{getValue<string>()}</span>,
    },
    {
      accessorKey: 'severity',
      header: 'Severity',
      cell: ({ getValue }) => {
        const severity = getValue<string>();
        return (
          <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', severityBadgeClass(severity))}>
            {severity}
          </span>
        );
      },
    },
    {
      accessorKey: 'cvss_v3_score',
      header: 'CVSS',
      cell: ({ getValue }) => {
        const score = getValue<number | null>();
        return <span className="tabular-nums">{score != null ? score.toFixed(1) : '—'}</span>;
      },
    },
    {
      accessorKey: 'package',
      header: 'Package',
      cell: ({ row }) => {
        const v = row.original;
        return (
          <div className="flex items-center gap-1.5">
            <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="truncate max-w-[180px]">{v.package}</span>
            <span className="text-muted-foreground text-xs">{v.version}</span>
          </div>
        );
      },
    },
    {
      accessorKey: 'repository_name',
      header: 'Repository',
      cell: ({ getValue }) => (
        <span className="block truncate max-w-[200px]">{getValue<string>()}</span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      enableSorting: false,
      cell: ({ row }) => {
        const v = row.original;
        return v.fixed_version ? (
          <span className="text-emerald-600 dark:text-emerald-400 text-xs">
            Fix: {v.fixed_version}
          </span>
        ) : (
          <span className="text-muted-foreground text-xs">{v.status || 'No fix'}</span>
        );
      },
    },
    {
      id: 'in_use',
      header: 'In Use',
      accessorFn: (v) => v.in_use,
      cell: ({ row }) => {
        const v = row.original;
        const containers = parseContainers(v.matching_containers);
        return v.in_use ? (
          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 text-xs font-medium">
            <Shield className="h-3 w-3" />
            {containers.length} container{containers.length !== 1 ? 's' : ''}
          </span>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        );
      },
    },
  ], []);

  // Not configured state
  if (status && !status.configured) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Vulnerability Management</h1>
          <p className="text-muted-foreground">Harbor Registry integration for image vulnerability tracking.</p>
        </div>
        <SpotlightCard>
        <div className="rounded-lg border bg-card p-6 shadow-sm text-center">
          <ShieldAlert className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">Harbor Not Configured</h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            Set <code className="text-xs bg-muted px-1 py-0.5 rounded">HARBOR_API_URL</code>,{' '}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">HARBOR_ROBOT_NAME</code>, and{' '}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">HARBOR_ROBOT_SECRET</code> environment
            variables to connect to your Harbor registry.
          </p>
        </div>
        </SpotlightCard>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Vulnerability Management</h1>
          <p className="text-muted-foreground">
            Harbor Registry vulnerabilities prioritized by running workloads.
            {status?.lastSync?.completed_at && (
              <span className="ml-2 text-xs">
                Last sync: {formatTimeAgo(status.lastSync.completed_at)}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => triggerSync.mutate()}
          disabled={triggerSync.isPending}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <RefreshCw className={cn('h-4 w-4', triggerSync.isPending && 'animate-spin')} />
          {triggerSync.isPending ? 'Syncing...' : 'Sync Now'}
        </button>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <SummaryCard
            label="Total Vulnerabilities"
            value={summary.total}
            icon={Bug}
            className="text-foreground"
          />
          <SummaryCard
            label="Critical"
            value={summary.critical}
            icon={ShieldAlert}
            className="text-red-600 dark:text-red-400"
            highlight={summary.critical > 0}
          />
          <SummaryCard
            label="In-Use Critical"
            value={summary.in_use_critical}
            icon={AlertTriangle}
            className="text-orange-600 dark:text-orange-400"
            highlight={summary.in_use_critical > 0}
          />
          <SummaryCard
            label="Fixable"
            value={summary.fixable}
            icon={CheckCircle2}
            className="text-emerald-600 dark:text-emerald-400"
          />
          <SummaryCard
            label="Excepted"
            value={summary.excepted}
            icon={ShieldCheck}
            className="text-blue-600 dark:text-blue-400"
          />
        </div>
      )}

      {/* Filters */}
      <SpotlightCard>
      <section className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by CVE, package, or repository..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-md border border-input bg-background pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Severity</span>
            <ThemedSelect
              className="h-9 w-full"
              value={selectedSeverity}
              onValueChange={setSelectedSeverity}
              options={severityOptions.map((o) => ({ value: o.value, label: o.label }))}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">In Use</span>
            <ThemedSelect
              className="h-9 w-full"
              value={selectedInUse}
              onValueChange={setSelectedInUse}
              options={inUseOptions.map((o) => ({ value: o.value, label: o.label }))}
            />
          </label>
        </div>
      </section>
      </SpotlightCard>

      {/* Connection error banner */}
      {status && !status.connected && status.configured && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="inline-block h-4 w-4 mr-1.5 -mt-0.5" />
          Harbor connection failed: {status.connectionError ?? 'Unknown error'}. Showing cached data.
        </div>
      )}

      {/* Loading / Error */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load vulnerability data: {error instanceof Error ? error.message : 'Unknown error'}
          <button onClick={() => refetch()} className="ml-2 underline">Retry</button>
        </div>
      )}

      {/* Vulnerability table */}
      {!isLoading && !isError && (
        <SpotlightCard>
        <section className="rounded-lg border bg-card p-4 shadow-sm">
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-muted-foreground">
              {vulnerabilities.length === 0
                ? 'No vulnerability data yet. Click "Sync Now" to fetch from Harbor.'
                : 'No vulnerabilities match your filters.'}
            </div>
          ) : (
            <>
              <DataTable
                columns={columns}
                data={filtered}
                hideSearch
                pageSize={15}
                rowClassName={(v) => (v.in_use ? 'bg-amber-500/5' : '')}
                onRowClick={(v) => setExpandedRow(expandedRow === v.id ? null : v.id)}
              />
              {expandedVuln && <VulnerabilityDetails vuln={expandedVuln} />}
              <div className="border-t px-3 py-2 text-xs text-muted-foreground">
                Showing {filtered.length} of {summary?.total ?? vulnerabilities.length} vulnerabilities
              </div>
            </>
          )}
        </section>
        </SpotlightCard>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function SummaryCard({
  label,
  value,
  icon: Icon,
  className,
  highlight,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  className?: string;
  highlight?: boolean;
}) {
  return (
    <SpotlightCard className="h-full">
      <div
        className={cn(
          'h-full rounded-lg border bg-card p-6 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 hover:border-primary/20',
          highlight && 'border-red-500/30 bg-red-500/5',
        )}
      >
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <Icon className={cn('h-5 w-5', className)} />
        </div>
        <p className={cn('mt-2 text-3xl font-bold tracking-tight', className)}>{value.toLocaleString()}</p>
      </div>
    </SpotlightCard>
  );
}

function VulnerabilityDetails({ vuln }: { vuln: VulnerabilityRecord }) {
  const containers = parseContainers(vuln.matching_containers);
  const tags = parseTags(vuln.tags);
  const links = parseLinks(vuln.links);

  return (
    <div className="mt-3 rounded-md border bg-muted/20 px-3 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-xs">{vuln.cve_id}</span>
        <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', severityBadgeClass(vuln.severity))}>
          {vuln.severity}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 text-sm">
        {vuln.description && (
          <div className="sm:col-span-2">
            <span className="text-muted-foreground text-xs">Description</span>
            <p className="mt-0.5 text-xs leading-relaxed">{vuln.description}</p>
          </div>
        )}
        {tags.length > 0 && (
          <div>
            <span className="text-muted-foreground text-xs">Tags</span>
            <div className="mt-0.5 flex flex-wrap gap-1">
              {tags.map((t) => (
                <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-xs">{t}</span>
              ))}
            </div>
          </div>
        )}
        {containers.length > 0 && (
          <div>
            <span className="text-muted-foreground text-xs">Running In</span>
            <div className="mt-0.5 space-y-0.5">
              {containers.map((c) => (
                <div key={c.id} className="text-xs">
                  <span className="font-mono">{c.name}</span>
                  <span className="text-muted-foreground ml-1">({c.id})</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {links.length > 0 && (
          <div className="sm:col-span-2">
            <span className="text-muted-foreground text-xs">References</span>
            <div className="mt-0.5 flex flex-wrap gap-2">
              {links.slice(0, 3).map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  {(() => { try { return new URL(url).hostname; } catch { return url; } })()}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
