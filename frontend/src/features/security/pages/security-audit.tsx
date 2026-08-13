import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ChevronDown, ChevronRight, Search, ShieldAlert, SlidersHorizontal } from 'lucide-react';
import { useSecurityAudit, type SecurityAuditEntry } from '@/features/security/hooks/use-security-audit';
import { useEndpoints } from '@/features/containers/hooks/use-endpoints';
import { ThemedSelect } from '@/shared/components/ui/themed-select';
import { DataTable, type ColumnDef } from '@/shared/components/tables/data-table';
import { SkeletonTableRow } from '@/shared/components/feedback/skeleton';
import { PageHeader } from '@/shared/components/layout/page-header';
import { cn } from '@/shared/lib/utils';
import { ObservedDestinationsPanel } from '@/features/security/components/observed-destinations-panel';
import { SpotlightCard } from '@/shared/components/data-display/spotlight-card';

const severityOptions = [
  { value: 'all', label: 'All Severities' },
  { value: 'critical', label: 'Critical' },
  { value: 'warning', label: 'Warning' },
  { value: 'info', label: 'Info' },
  { value: 'none', label: 'No Findings' },
] as const;

const ignoredOptions = [
  { value: 'all', label: 'All Containers' },
  { value: 'active', label: 'Not Ignored' },
  { value: 'ignored', label: 'Ignored' },
] as const;

function severityRank(severity: string): number {
  switch (severity) {
    case 'critical':
      return 0;
    case 'warning':
      return 1;
    case 'info':
      return 2;
    default:
      return 3;
  }
}

function severityBadgeClass(severity: string): string {
  switch (severity) {
    case 'critical':
      return 'bg-red-500/15 text-red-700 dark:text-red-400';
    case 'warning':
      return 'bg-amber-500/15 text-amber-700 dark:text-amber-400';
    case 'info':
      return 'bg-blue-500/15 text-blue-700 dark:text-blue-400';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

function capabilityBadgeClass(capability: string): string {
  if (capability === 'SYS_ADMIN') return 'bg-red-500/15 text-red-700 dark:text-red-400';
  if (capability === 'NET_ADMIN' || capability === 'SYS_PTRACE') return 'bg-amber-500/15 text-amber-700 dark:text-amber-400';
  return 'bg-muted text-muted-foreground';
}

/**
 * Isolation modes worth a line of text. Docker's defaults (`bridge`, the
 * per-compose-project network, `private` PID) are the answer for almost every
 * container, and printing `net=container-insights_dashboard-net | pid=—` on
 * every row spent a column on saying "normal" 13 times.
 */
function isolationNotes(posture: SecurityAuditEntry['posture']): string[] {
  const notes: string[] = [];
  const net = posture.networkMode ?? '';
  const pid = posture.pidMode ?? '';
  if (net === 'host') notes.push('host network');
  else if (net.startsWith('container:')) notes.push(`network shared with ${net.slice('container:'.length)}`);
  if (pid === 'host') notes.push('host PID namespace');
  else if (pid.startsWith('container:')) notes.push(`PID shared with ${pid.slice('container:'.length)}`);
  return notes;
}

/**
 * Whether this container is worth a row at all.
 *
 * On a clean fleet every row read `None / No / net=… | pid=— / NONE / Active` —
 * 13 rows of the same five constants, while the one number that mattered sat
 * above them in 14px muted text. Rows are for exceptions; the count of
 * everything else is a summary line.
 */
function isException(entry: SecurityAuditEntry): boolean {
  return entry.findings.length > 0
    || entry.posture.capAdd.length > 0
    || entry.posture.privileged
    || isolationNotes(entry.posture).length > 0;
}

export default function SecurityAuditPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEndpoint, setSelectedEndpoint] = useState<string>('all');
  const [selectedSeverity, setSelectedSeverity] = useState<string>('all');
  const [selectedIgnored, setSelectedIgnored] = useState<string>('all');
  const [selectedStack, setSelectedStack] = useState<string>('all');
  const [showClean, setShowClean] = useState(false);

  const { data: endpoints = [] } = useEndpoints();
  const { data, isLoading: auditLoading, isPending: auditPending, isError, error, refetch } = useSecurityAudit(
    selectedEndpoint === 'all' ? undefined : Number(selectedEndpoint),
  );
  // Treat both isLoading and isPending-without-data as "loading" to avoid
  // rendering a blank page during SPA navigation before data arrives.
  const isLoading = auditLoading || (auditPending && !data);

  const entries = data?.entries ?? [];

  const stackOptions = useMemo(() => {
    const stacks = Array.from(
      new Set(entries.map((entry) => entry.stackName).filter((value): value is string => !!value)),
    ).sort();

    return [
      { value: 'all', label: 'All Stacks' },
      ...stacks.map((stack) => ({ value: stack, label: stack })),
    ];
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return entries
      .filter((entry) => {
        if (q && !entry.containerName.toLowerCase().includes(q) && !entry.image.toLowerCase().includes(q)) return false;
        if (selectedSeverity !== 'all' && entry.severity !== selectedSeverity) return false;
        if (selectedIgnored === 'ignored' && !entry.ignored) return false;
        if (selectedIgnored === 'active' && entry.ignored) return false;
        if (selectedStack !== 'all' && entry.stackName !== selectedStack) return false;
        return true;
      })
      .sort((a, b) => {
        const sev = severityRank(a.severity) - severityRank(b.severity);
        if (sev !== 0) return sev;
        return a.containerName.localeCompare(b.containerName);
      });
  }, [entries, searchQuery, selectedSeverity, selectedIgnored, selectedStack]);

  /**
   * The one line an operator actually reads. It used to be 14px muted text
   * under a table of constants; it is now the lead, and it names the three
   * things this page checks rather than "13 containers shown".
   */
  const posture = useMemo(() => {
    const withCaps = entries.filter((entry) => entry.posture.capAdd.length > 0);
    const privileged = entries.filter((entry) => entry.posture.privileged);
    const hostNamespaces = entries.filter((entry) => isolationNotes(entry.posture).length > 0);
    const exceptions = entries.filter(isException);
    return {
      total: entries.length,
      withCaps: withCaps.length,
      privileged: privileged.length,
      hostNamespaces: hostNamespaces.length,
      exceptions: exceptions.length,
      ignored: entries.filter((entry) => entry.ignored).length,
    };
  }, [entries]);

  // Any active filter is an explicit request to see those rows, clean or not.
  const isFiltered = searchQuery.trim() !== ''
    || selectedSeverity !== 'all'
    || selectedIgnored !== 'all'
    || selectedStack !== 'all';

  const cleanEntries = useMemo(
    () => filteredEntries.filter((entry) => !isException(entry)),
    [filteredEntries],
  );
  const visibleEntries = isFiltered || showClean
    ? filteredEntries
    : filteredEntries.filter(isException);

  /**
   * Containers that genuinely need review — independent of how many rows the
   * table is currently showing. Expanding the clean list is a display choice,
   * not a change in what was found.
   */
  const exceptionCount = useMemo(
    () => filteredEntries.filter(isException).length,
    [filteredEntries],
  );

  const columns = useMemo<ColumnDef<SecurityAuditEntry, unknown>[]>(() => [
    {
      id: 'container',
      accessorKey: 'containerName',
      header: 'Container',
      cell: ({ row }) => {
        const entry = row.original;
        return (
          <div className={cn(entry.ignored && 'opacity-70')}>
            <div className="font-medium">{entry.containerName}</div>
            <div className="text-xs text-muted-foreground">{entry.image}</div>
          </div>
        );
      },
    },
    {
      id: 'stack',
      accessorKey: 'stackName',
      header: 'Stack',
      cell: ({ row }) => (
        <span className={cn('text-muted-foreground', row.original.ignored && 'opacity-70')}>
          {row.original.stackName ?? '—'}
        </span>
      ),
    },
    {
      id: 'endpoint',
      accessorKey: 'endpointName',
      header: 'Endpoint',
      cell: ({ row }) => (
        <span className={cn('text-muted-foreground', row.original.ignored && 'opacity-70')}>
          {row.original.endpointName}
        </span>
      ),
    },
    {
      id: 'capabilities',
      header: 'Capabilities Added',
      enableSorting: false,
      cell: ({ row }) => {
        const entry = row.original;
        return (
          <div className={cn('flex flex-wrap gap-1.5', entry.ignored && 'opacity-70')}>
            {entry.posture.capAdd.length === 0 ? (
              <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">None</span>
            ) : (
              entry.posture.capAdd.map((capability) => (
                <span
                  key={capability}
                  className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', capabilityBadgeClass(capability))}
                >
                  {capability}
                </span>
              ))
            )}
          </div>
        );
      },
    },
    {
      id: 'privileged',
      header: 'Privileged',
      accessorFn: (entry) => entry.posture.privileged,
      cell: ({ row }) => {
        const entry = row.original;
        return (
          <span
            className={cn(
              'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
              entry.ignored && 'opacity-70',
              entry.posture.privileged
                ? 'bg-red-500/15 text-red-700 dark:text-red-400'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {entry.posture.privileged ? 'Yes' : 'No'}
          </span>
        );
      },
    },
    {
      id: 'isolation',
      header: 'Isolation',
      enableSorting: false,
      cell: ({ row }) => {
        const entry = row.original;
        const notes = isolationNotes(entry.posture);
        if (notes.length === 0) {
          return (
            <span
              className="text-xs text-muted-foreground"
              title={`network: ${entry.posture.networkMode ?? 'default'} · pid: ${entry.posture.pidMode ?? 'private'}`}
            >
              —
            </span>
          );
        }
        return (
          <span className={cn('text-xs font-medium text-amber-700 dark:text-amber-400', entry.ignored && 'opacity-70')}>
            {notes.join(', ')}
          </span>
        );
      },
    },
    {
      id: 'severity',
      accessorKey: 'severity',
      header: 'Severity',
      sortFn: (a, b) => severityRank(a.original.severity) - severityRank(b.original.severity),
      cell: ({ row }) => {
        const entry = row.original;
        // A coloured badge for the ABSENCE of a finding is noise. Badges are
        // for signal.
        if (entry.severity === 'none') {
          return <span className="text-xs text-muted-foreground">—</span>;
        }
        return (
          <span
            className={cn(
              'inline-flex rounded-full px-2 py-0.5 text-xs font-medium uppercase',
              entry.ignored && 'opacity-70',
              severityBadgeClass(entry.severity),
            )}
          >
            {entry.severity}
          </span>
        );
      },
    },
    {
      id: 'ignored',
      accessorKey: 'ignored',
      header: 'Ignored',
      cell: ({ row }) => {
        const entry = row.original;
        return (
          <span
            className={cn(
              'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
              entry.ignored
                ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {entry.ignored ? 'Ignored' : 'Active'}
          </span>
        );
      },
    },
  ], []);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Security Audit"
        subtitle={isLoading
          ? undefined
          : posture.exceptions === 0
            ? `No container of ${posture.total} has added capabilities, privileged mode, or a host namespace`
            : `${posture.exceptions} of ${posture.total} containers have added capabilities, privileged mode, or a host namespace`}
        actions={(
          <Link
            to="/settings?tab=security"
            className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Manage ignore list
          </Link>
        )}
      />

      {!isLoading && posture.total > 0 && (
        <SpotlightCard>
        <section className="rounded-lg border bg-card p-6 shadow-sm" data-testid="posture-summary">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-sm text-muted-foreground">Added capabilities</dt>
              <dd className="mt-1 text-2xl font-bold tracking-tight">{posture.withCaps}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Privileged</dt>
              <dd className="mt-1 text-2xl font-bold tracking-tight">{posture.privileged}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Host network or PID</dt>
              <dd className="mt-1 text-2xl font-bold tracking-tight">{posture.hostNamespaces}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">On the ignore list</dt>
              <dd className="mt-1 text-2xl font-bold tracking-tight">{posture.ignored}</dd>
            </div>
          </dl>
          <p className="mt-4 text-sm text-muted-foreground">
            Ignored containers are excluded from the dashboard security count. Edit the patterns
            at{' '}
            <Link to="/settings?tab=security" className="text-primary hover:underline">
              Settings → Security
            </Link>
            .
          </p>
        </section>
        </SpotlightCard>
      )}

      <SpotlightCard>
      <section className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search containers by name or image..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-md border border-input bg-background pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="grid gap-3 lg:grid-cols-4">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Endpoint</span>
            <ThemedSelect
              className="h-9 w-full"
              value={selectedEndpoint}
              onValueChange={setSelectedEndpoint}
              options={[
                { value: 'all', label: 'All Endpoints' },
                ...endpoints.map((endpoint) => ({ value: String(endpoint.id), label: endpoint.name })),
              ]}
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Severity</span>
            <ThemedSelect
              className="h-9 w-full"
              value={selectedSeverity}
              onValueChange={setSelectedSeverity}
              options={severityOptions.map((option) => ({ value: option.value, label: option.label }))}
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Stack</span>
            <ThemedSelect
              className="h-9 w-full"
              value={selectedStack}
              onValueChange={setSelectedStack}
              options={stackOptions}
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Ignored</span>
            <ThemedSelect
              className="h-9 w-full"
              value={selectedIgnored}
              onValueChange={setSelectedIgnored}
              options={ignoredOptions.map((option) => ({ value: option.value, label: option.label }))}
            />
          </label>
        </div>
      </section>
      </SpotlightCard>

      {isError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6">
          <p className="font-medium text-destructive">Failed to load security audit</p>
          <p className="mt-1 text-sm text-muted-foreground">{error instanceof Error ? error.message : 'Unknown error'}</p>
          <button
            onClick={() => refetch()}
            className="mt-3 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            Retry
          </button>
        </div>
      )}

      <SpotlightCard>
      <section className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          {/*
            Count the containers that actually need review, not the rows on
            screen. This read `visibleEntries.length`, which includes the clean
            rows once "Show 20 clean containers" is expanded — so clicking to
            confirm everything was fine flipped the counter from "0 containers
            need a look" to "20 containers need a look" while the button beside
            it said "Hide 20 clean containers". On a security page that
            manufactured twenty findings out of nothing.
          */}
          <span>
            {isFiltered
              ? `${filteredEntries.length} of ${entries.length} containers match the filters`
              : `${exceptionCount} container${exceptionCount === 1 ? '' : 's'} need a look`}
          </span>
          {!isFiltered && cleanEntries.length > 0 && (
            <button
              type="button"
              onClick={() => setShowClean((prev) => !prev)}
              aria-expanded={showClean}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-foreground hover:bg-accent"
            >
              {showClean
                ? <ChevronDown className="h-4 w-4" />
                : <ChevronRight className="h-4 w-4" />}
              {showClean ? 'Hide' : 'Show'} {cleanEntries.length} clean container
              {cleanEntries.length === 1 ? '' : 's'}
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="overflow-x-auto" role="status" aria-label="Loading security audit">
            <table className="w-full min-w-[1100px] text-sm">
              <tbody>
                {Array.from({ length: 6 }).map((_, i) => (
                  <SkeletonTableRow key={i} columns={8} />
                ))}
              </tbody>
            </table>
            <span className="sr-only">Loading…</span>
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="rounded-lg border bg-muted/30 p-8 text-center">
            <ShieldAlert className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-medium">No matching containers</p>
            <p className="mt-1 text-sm text-muted-foreground">Try adjusting your search or filters.</p>
          </div>
        ) : visibleEntries.length === 0 ? (
          <div className="rounded-lg border bg-muted/30 p-8 text-center">
            <ShieldAlert className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-medium">Nothing to review</p>
            <p className="mt-1 text-sm text-muted-foreground">
              No container adds a capability, runs privileged, or shares a host namespace.
            </p>
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={visibleEntries}
            hideSearch
            minTableWidth={1100}
          />
        )}
      </section>
      </SpotlightCard>

      {/* Observed Destinations (#1240) — outbound traffic captured by Beyla */}
      <ObservedDestinationsPanel
        endpointId={selectedEndpoint === 'all' ? undefined : Number(selectedEndpoint)}
      />
    </div>
  );
}
