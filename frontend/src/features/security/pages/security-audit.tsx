import { useMemo, useState } from 'react';
import { Search, ShieldAlert } from 'lucide-react';
import { useSecurityAudit } from '@/features/security/hooks/use-security-audit';
import { useEndpoints } from '@/features/containers/hooks/use-endpoints';
import { ThemedSelect } from '@/shared/components/themed-select';
import { cn } from '@/shared/lib/utils';

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

export default function SecurityAuditPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEndpoint, setSelectedEndpoint] = useState<string>('all');
  const [selectedSeverity, setSelectedSeverity] = useState<string>('all');
  const [selectedIgnored, setSelectedIgnored] = useState<string>('all');
  const [selectedStack, setSelectedStack] = useState<string>('all');

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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Security Audit</h1>
        <p className="text-muted-foreground">Container capability posture across endpoints with ignore-list visibility.</p>
      </div>

      <section className="rounded-xl border bg-card/75 p-4 backdrop-blur">
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

      <section className="rounded-xl border bg-card/75 p-4 backdrop-blur">
        <div className="mb-3 text-sm text-muted-foreground">
          {filteredEntries.length} containers shown ({entries.filter((entry) => entry.findings.length > 0).length} with findings total)
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading security audit...</div>
        ) : filteredEntries.length === 0 ? (
          <div className="rounded-lg border bg-muted/30 p-8 text-center">
            <ShieldAlert className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 font-medium">No matching containers</p>
            <p className="mt-1 text-sm text-muted-foreground">Try adjusting your search or filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2.5 font-medium">Container</th>
                  <th className="px-3 py-2.5 font-medium">Stack</th>
                  <th className="px-3 py-2.5 font-medium">Endpoint</th>
                  <th className="px-3 py-2.5 font-medium">Capabilities Added</th>
                  <th className="px-3 py-2.5 font-medium">Privileged</th>
                  <th className="px-3 py-2.5 font-medium">Network/PID</th>
                  <th className="px-3 py-2.5 font-medium">Severity</th>
                  <th className="px-3 py-2.5 font-medium">Ignored</th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((entry) => (
                  <tr
                    key={`${entry.endpointId}:${entry.containerId}`}
                    className={cn('border-b last:border-0', entry.ignored && 'opacity-70')}
                  >
                    <td className="px-3 py-3">
                      <div className="font-medium">{entry.containerName}</div>
                      <div className="text-xs text-muted-foreground">{entry.image}</div>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{entry.stackName ?? '—'}</td>
                    <td className="px-3 py-3 text-muted-foreground">{entry.endpointName}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1.5">
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
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={cn(
                          'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                          entry.posture.privileged
                            ? 'bg-red-500/15 text-red-700 dark:text-red-400'
                            : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {entry.posture.privileged ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      net={entry.posture.networkMode ?? '—'} | pid={entry.posture.pidMode ?? '—'}
                    </td>
                    <td className="px-3 py-3">
                      <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium uppercase', severityBadgeClass(entry.severity))}>
                        {entry.severity}
                      </span>
                    </td>
                    <td className="px-3 py-3">
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
