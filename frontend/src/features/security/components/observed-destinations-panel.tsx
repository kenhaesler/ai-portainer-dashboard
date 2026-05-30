import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { type ColumnDef } from '@tanstack/react-table';
import { Globe } from 'lucide-react';
import { api } from '@/shared/lib/api';
import { cn } from '@/shared/lib/utils';
import { DataTable } from '@/shared/components/tables/data-table';
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

  const columns = useMemo<ColumnDef<ObservedDestinationDto, unknown>[]>(() => [
    {
      accessorKey: 'peer',
      header: 'Peer',
      cell: ({ getValue }) => <span className="font-mono text-xs">{getValue<string>()}</span>,
    },
    {
      accessorKey: 'port',
      header: 'Port',
      cell: ({ getValue }) => {
        const port = getValue<number | null>();
        return <span className="text-muted-foreground">{port ?? '—'}</span>;
      },
    },
    {
      accessorKey: 'callCount',
      header: () => <span className="block text-right">Calls</span>,
      cell: ({ getValue }) => <span className="block text-right">{getValue<number>()}</span>,
    },
    {
      accessorKey: 'firstSeen',
      header: 'First seen',
      cell: ({ getValue }) => (
        <span className="text-xs text-muted-foreground">{fmt(getValue<string>())}</span>
      ),
    },
    {
      accessorKey: 'lastSeen',
      header: 'Last seen',
      cell: ({ getValue }) => (
        <span className="text-xs text-muted-foreground">{fmt(getValue<string>())}</span>
      ),
    },
    {
      accessorKey: 'verdict',
      header: 'Verdict',
      cell: ({ row }) => {
        const { verdict, reason } = row.original;
        return (
          <span
            className={cn(
              'inline-flex rounded-full px-2 py-0.5 text-xs font-medium uppercase',
              verdictClass(verdict),
            )}
            title={reason ?? undefined}
          >
            {verdict}
          </span>
        );
      },
    },
  ], []);

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
        <DataTable
          columns={columns}
          data={destinations}
          hideSearch
          minTableWidth={900}
        />
      )}
    </section>
    </SpotlightCard>
  );
}
