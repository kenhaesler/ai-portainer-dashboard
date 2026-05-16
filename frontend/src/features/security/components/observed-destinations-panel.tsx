import { useQuery } from '@tanstack/react-query';
import { Globe } from 'lucide-react';
import { api } from '@/shared/lib/api';
import { cn } from '@/shared/lib/utils';
import { NoTraceDataCallout } from '@/features/observability/components/no-trace-data-callout';
import { SpotlightCard } from '@/shared/components/data-display/spotlight-card';

export type Verdict = 'allow' | 'warn' | 'deny';

export interface ObservedDestinationDto {
  peer: string;
  port: number | null;
  callCount: number;
  firstSeen: string;
  lastSeen: string;
  verdict: Verdict;
  reason: string | null;
}

interface Props {
  endpointId?: number;
}

function verdictClass(v: Verdict): string {
  switch (v) {
    case 'allow':
      return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400';
    case 'deny':
      return 'bg-red-500/15 text-red-700 dark:text-red-400';
    case 'warn':
    default:
      return 'bg-amber-500/15 text-amber-700 dark:text-amber-400';
  }
}

function fmt(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString();
}

/**
 * Observed Destinations panel (#1240).
 *
 * Lists outbound destinations captured by Beyla in the last 24h, classified
 * against the security_destination_rules table. Renders below the audit
 * findings on the Security Audit page; empty state uses the shared trace
 * data callout because absent rows usually mean Beyla isn't deployed.
 */
export function ObservedDestinationsPanel({ endpointId }: Props) {
  const { data, isLoading, isError, error, refetch } = useQuery<{ destinations: ObservedDestinationDto[] }>({
    queryKey: ['observed-destinations', endpointId],
    queryFn: () =>
      api.get<{ destinations: ObservedDestinationDto[] }>(
        '/api/security/observed-destinations',
        endpointId ? { params: { endpointId } } : undefined,
      ),
  });

  const destinations = data?.destinations ?? [];

  return (
    <SpotlightCard>
    <section className="rounded-lg border bg-card p-6 shadow-sm" data-testid="observed-destinations-panel">
      <div className="mb-3 flex items-center gap-2">
        <Globe className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-lg font-semibold">Observed Destinations</h2>
        <span className="text-xs text-muted-foreground">last 24h</span>
      </div>

      {isError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="font-medium text-destructive">Failed to load observed destinations</p>
          <p className="mt-1 text-sm text-muted-foreground">{error instanceof Error ? error.message : 'Unknown error'}</p>
          <button
            onClick={() => refetch()}
            className="mt-3 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            Retry
          </button>
        </div>
      )}

      {!isError && isLoading && (
        <div className="text-sm text-muted-foreground">Loading observed destinations…</div>
      )}

      {!isError && !isLoading && destinations.length === 0 && (
        <NoTraceDataCallout description="No outbound destinations captured in the last 24h. Deploy Beyla on this endpoint to see what your containers are talking to." />
      )}

      {!isError && !isLoading && destinations.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2.5 font-medium">Peer</th>
                <th className="px-3 py-2.5 font-medium">Port</th>
                <th className="px-3 py-2.5 font-medium text-right">Calls</th>
                <th className="px-3 py-2.5 font-medium">First seen</th>
                <th className="px-3 py-2.5 font-medium">Last seen</th>
                <th className="px-3 py-2.5 font-medium">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {destinations.map((row) => (
                <tr key={`${row.peer}:${row.port ?? ''}`} className="border-b last:border-0">
                  <td className="px-3 py-2.5 font-mono text-xs">{row.peer}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{row.port ?? '—'}</td>
                  <td className="px-3 py-2.5 text-right">{row.callCount}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{fmt(row.firstSeen)}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{fmt(row.lastSeen)}</td>
                  <td className="px-3 py-2.5">
                    <span
                      className={cn(
                        'inline-flex rounded-full px-2 py-0.5 text-xs font-medium uppercase',
                        verdictClass(row.verdict),
                      )}
                      title={row.reason ?? undefined}
                    >
                      {row.verdict}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
    </SpotlightCard>
  );
}
