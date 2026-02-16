import { useMemo, useState } from 'react';
import {
  Shield, ShieldAlert, ShieldCheck, Search, RefreshCw,
  ExternalLink, AlertTriangle, CheckCircle2, Package, Bug,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThemedSelect } from '@/components/shared/themed-select';
import {
  useHarborStatus,
  useHarborVulnerabilities,
  useTriggerHarborSync,
  type VulnerabilityRecord,
} from '@/hooks/use-harbor-vulnerabilities';

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

  // Not configured state
  if (status && !status.configured) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Vulnerability Management</h1>
          <p className="text-muted-foreground">Harbor Registry integration for image vulnerability tracking.</p>
        </div>
        <div className="rounded-xl border bg-card/75 p-8 backdrop-blur text-center">
          <ShieldAlert className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">Harbor Not Configured</h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            Set <code className="text-xs bg-muted px-1 py-0.5 rounded">HARBOR_API_URL</code>,{' '}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">HARBOR_ROBOT_NAME</code>, and{' '}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">HARBOR_ROBOT_SECRET</code> environment
            variables to connect to your Harbor registry.
          </p>
        </div>
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
      <section className="rounded-xl border bg-card/75 p-4 backdrop-blur">
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
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load vulnerability data: {error instanceof Error ? error.message : 'Unknown error'}
          <button onClick={() => refetch()} className="ml-2 underline">Retry</button>
        </div>
      )}

      {/* Vulnerability table */}
      {!isLoading && !isError && (
        <section className="rounded-xl border bg-card/75 backdrop-blur overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th className="px-3 py-2 font-medium">CVE</th>
                  <th className="px-3 py-2 font-medium">Severity</th>
                  <th className="px-3 py-2 font-medium">CVSS</th>
                  <th className="px-3 py-2 font-medium">Package</th>
                  <th className="px-3 py-2 font-medium">Repository</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">In Use</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                      {vulnerabilities.length === 0
                        ? 'No vulnerability data yet. Click "Sync Now" to fetch from Harbor.'
                        : 'No vulnerabilities match your filters.'}
                    </td>
                  </tr>
                ) : (
                  filtered.map((v) => (
                    <VulnerabilityRow
                      key={v.id}
                      vuln={v}
                      expanded={expandedRow === v.id}
                      onToggle={() => setExpandedRow(expandedRow === v.id ? null : v.id)}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
          {filtered.length > 0 && (
            <div className="border-t px-3 py-2 text-xs text-muted-foreground">
              Showing {filtered.length} of {summary?.total ?? vulnerabilities.length} vulnerabilities
            </div>
          )}
        </section>
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
    <div
      className={cn(
        'rounded-xl border bg-card/75 p-4 backdrop-blur',
        highlight && 'border-red-500/30 bg-red-500/5',
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className={cn('h-4 w-4', className)} />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className={cn('mt-1 text-2xl font-bold', className)}>{value.toLocaleString()}</div>
    </div>
  );
}

function VulnerabilityRow({
  vuln,
  expanded,
  onToggle,
}: {
  vuln: VulnerabilityRecord;
  expanded: boolean;
  onToggle: () => void;
}) {
  const containers = parseContainers(vuln.matching_containers);
  const tags = parseTags(vuln.tags);
  const links = parseLinks(vuln.links);

  return (
    <>
      <tr
        onClick={onToggle}
        className={cn(
          'border-b cursor-pointer hover:bg-muted/30 transition-colors',
          vuln.in_use && 'bg-amber-500/5',
        )}
      >
        <td className="px-3 py-2 font-mono text-xs">{vuln.cve_id}</td>
        <td className="px-3 py-2">
          <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', severityBadgeClass(vuln.severity))}>
            {vuln.severity}
          </span>
        </td>
        <td className="px-3 py-2 tabular-nums">
          {vuln.cvss_v3_score != null ? vuln.cvss_v3_score.toFixed(1) : '—'}
        </td>
        <td className="px-3 py-2">
          <div className="flex items-center gap-1.5">
            <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="truncate max-w-[180px]">{vuln.package}</span>
            <span className="text-muted-foreground text-xs">{vuln.version}</span>
          </div>
        </td>
        <td className="px-3 py-2 truncate max-w-[200px]">{vuln.repository_name}</td>
        <td className="px-3 py-2">
          {vuln.fixed_version ? (
            <span className="text-emerald-600 dark:text-emerald-400 text-xs">
              Fix: {vuln.fixed_version}
            </span>
          ) : (
            <span className="text-muted-foreground text-xs">{vuln.status || 'No fix'}</span>
          )}
        </td>
        <td className="px-3 py-2">
          {vuln.in_use ? (
            <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 text-xs font-medium">
              <Shield className="h-3 w-3" />
              {containers.length} container{containers.length !== 1 ? 's' : ''}
            </span>
          ) : (
            <span className="text-muted-foreground text-xs">—</span>
          )}
        </td>
      </tr>

      {expanded && (
        <tr className="border-b">
          <td colSpan={7} className="px-3 py-3 bg-muted/20">
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
          </td>
        </tr>
      )}
    </>
  );
}
