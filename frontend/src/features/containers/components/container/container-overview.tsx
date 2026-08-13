import { useMemo, useState, type ReactNode } from 'react';
import {
  Box,
  Info,
  HardDrive,
  Clock,
  Activity,
  CalendarClock,
  Layers,
  Network,
  Tag,
} from 'lucide-react';
import { type Container } from '@/features/containers/hooks/use-containers';
import { StatusBadge } from '@/shared/components/feedback/status-badge';
import { DataTable, type ColumnDef } from '@/shared/components/tables/data-table';
import { formatDate } from '@/shared/lib/utils';
import {
  UNSPECIFIED_BIND_ADDRESSES,
  isLoopbackBind,
  type PortMapping,
} from '@/features/containers/lib/port-bindings';

/**
 * The token the backend substitutes for a label value that looked like a host path.
 */
const REDACTED_TOKEN = '[REDACTED]';

const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project';
const COMPOSE_SERVICE_LABEL = 'com.docker.compose.service';

/** Labels shown before "Show all N" is pressed. */
const COLLAPSED_LABEL_COUNT = 8;

function formatUptime(createdTimestamp: number): string {
  const now = Date.now();
  const created = createdTimestamp * 1000;
  const diff = now - created;

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function getHealthStatus(container: Container): string {
  if (container.healthStatus) {
    return container.healthStatus;
  }
  if (container.state === 'running') {
    return 'healthy';
  }
  return 'unknown';
}

/**
 * The running-time field.
 *
 * The strip used to carry `Uptime 10h 7m` *and* `Status Up 10 hours` — one fact
 * at two precisions — and it computed "uptime" from the creation timestamp even
 * for an exited container, so a container stopped a week ago reported a growing
 * uptime. Running containers now get the computed duration; everything else
 * gets Docker's own state line, which is where the exit code lives.
 */
function runningTimeField(container: Container): { label: string; value: string } {
  if (container.state === 'running') {
    return { label: 'Uptime', value: formatUptime(container.created) };
  }
  return { label: 'State', value: container.status || container.state };
}

function MetadataItem({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}

function DetailRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-xs text-muted-foreground sm:text-sm">{term}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

interface ContainerOverviewProps {
  container: Container;
}

export function ContainerOverview({ container }: ContainerOverviewProps) {
  const ports: PortMapping[] = container.ports || [];
  const networks = container.networks || [];
  const labels = container.labels || {};

  const [showAllLabels, setShowAllLabels] = useState(false);

  const composeProject = labels[COMPOSE_PROJECT_LABEL];
  const composeService = labels[COMPOSE_SERVICE_LABEL];
  const stackValue = composeProject
    ? composeService
      ? `${composeProject} / ${composeService}`
      : composeProject
    : undefined;

  const { totalLabels, namedLabels, emptyLabelCount } = useMemo(() => {
    const entries = Object.entries(labels);
    const named = entries
      .filter(([, value]) => (value ?? '').trim() !== '')
      .sort(([a], [b]) => a.localeCompare(b));
    return {
      totalLabels: entries.length,
      namedLabels: named,
      emptyLabelCount: entries.length - named.length,
    };
  }, [labels]);

  const visibleLabels = showAllLabels ? namedLabels : namedLabels.slice(0, COLLAPSED_LABEL_COUNT);

  const portColumns = useMemo<ColumnDef<PortMapping, unknown>[]>(
    () => [
      {
        accessorKey: 'private',
        header: 'Container Port',
        cell: ({ getValue }) => <span className="font-mono">{getValue<number>()}</span>,
      },
      {
        accessorKey: 'public',
        header: 'Host Port',
        cell: ({ getValue }) => <span className="font-mono">{getValue<number | undefined>() || '-'}</span>,
      },
      {
        accessorKey: 'type',
        header: 'Type',
        cell: ({ getValue }) => <span className="uppercase">{getValue<string>()}</span>,
      },
      {
        // Docker's real host bind address. This column used to render the
        // literal string "0.0.0.0" for every row, which asserted the least safe
        // answer with confidence and collapsed the separate IPv4 and IPv6
        // bindings of one mapping into two identical rows.
        accessorKey: 'ip',
        header: 'Host IP',
        cell: ({ row }) => {
          const ip = row.original.ip;
          if (!ip) {
            return (
              <span
                className="text-muted-foreground"
                title="Exposed by the image but not published to a host interface"
              >
                Not published
              </span>
            );
          }
          return (
            <span className="flex items-center gap-2">
              <span className="font-mono">{ip}</span>
              {UNSPECIFIED_BIND_ADDRESSES.has(ip) ? (
                <span className="rounded px-1.5 py-0.5 text-xs font-medium text-amber-700 bg-amber-500/10 dark:text-amber-400">
                  all interfaces
                </span>
              ) : isLoopbackBind(ip) ? (
                <span className="text-xs text-muted-foreground">loopback only</span>
              ) : null}
            </span>
          );
        },
      },
    ],
    []
  );

  return (
    <div className="space-y-6">
      {/* Container Summary Card */}
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10">
              <Box className="h-7 w-7 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold">{container.name}</h2>
              <p className="text-sm text-muted-foreground">
                {container.id.slice(0, 12)}
              </p>
            </div>
          </div>
          <StatusBadge
            status={getHealthStatus(container)}
            className="text-sm px-3 py-1"
          />
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <MetadataItem
            icon={HardDrive}
            label="Image"
            value={container.image.split(':')[0].split('/').pop() || container.image}
          />
          <MetadataItem
            icon={container.state === 'running' ? Clock : Activity}
            {...runningTimeField(container)}
          />
          <MetadataItem
            icon={CalendarClock}
            label="Created"
            value={formatDate(new Date(container.created * 1000))}
          />
          {stackValue && (
            <MetadataItem icon={Layers} label="Stack" value={stackValue} />
          )}
        </div>
      </div>

      {/*
        One definition list, not three near-empty cards. Image Information held a
        single field, Endpoint Information held two (one of them repeated from the
        strip above and the page subline), and Networks held one chip — roughly
        450px of card chrome around five lines of text.
      */}
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
          <Info className="h-5 w-5" />
          Details
        </h3>
        <dl className="divide-y divide-border" data-testid="container-details">
          <DetailRow term="Image">
            <span className="font-mono break-all">{container.image}</span>
          </DetailRow>
          <DetailRow term="Container ID">
            <span className="font-mono break-all">{container.id}</span>
          </DetailRow>
          <DetailRow term="Endpoint">
            <span className="font-medium">{container.endpointName}</span>
            <span className="text-muted-foreground"> · ID {container.endpointId}</span>
          </DetailRow>
          <DetailRow term="Networks">
            {networks.length === 0 ? (
              <span className="text-muted-foreground">None attached</span>
            ) : (
              <span className="flex flex-wrap gap-2">
                {networks.map((network) => (
                  <span
                    key={network}
                    className="inline-flex items-center rounded-md border border-border bg-muted/50 px-2 py-0.5 text-sm font-medium"
                  >
                    {network}
                    {container.networkIPs?.[network] && (
                      <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                        {container.networkIPs[network]}
                      </span>
                    )}
                  </span>
                ))}
              </span>
            )}
          </DetailRow>
        </dl>
      </div>

      {/* Port Mappings Card */}
      {ports.length > 0 && (
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Network className="h-5 w-5" />
            Port Mappings
          </h3>
          <DataTable columns={portColumns} data={ports} hideSearch />
        </div>
      )}

      {/* Labels Card */}
      {totalLabels > 0 && (
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Tag className="h-5 w-5" />
            Labels ({totalLabels})
          </h3>
          <div
            className={`space-y-2 ${showAllLabels ? 'max-h-[400px] overflow-y-auto scrollbar-themed' : ''}`}
            data-testid="container-labels"
          >
            {visibleLabels.map(([key, value]) => (
              <div key={key} className="flex flex-col gap-1 p-2 rounded bg-muted/50">
                <p data-testid="label-key" className="text-xs font-mono text-muted-foreground break-all">{key}</p>
                {value === REDACTED_TOKEN ? (
                  <p
                    className="text-sm italic text-muted-foreground"
                    title="Filesystem paths in container labels are stripped before they reach the browser."
                  >
                    — host path hidden —
                  </p>
                ) : (
                  <p className="text-sm font-mono break-all">{value}</p>
                )}
              </div>
            ))}
          </div>
          {namedLabels.length > COLLAPSED_LABEL_COUNT && (
            <button
              type="button"
              onClick={() => setShowAllLabels((prev) => !prev)}
              className="mt-3 text-sm font-medium text-primary hover:underline"
            >
              {showAllLabels ? 'Show fewer' : `Show all ${namedLabels.length}`}
            </button>
          )}
          {emptyLabelCount > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              {emptyLabelCount} {emptyLabelCount === 1 ? 'label is' : 'labels are'} set with no
              value and {emptyLabelCount === 1 ? 'is' : 'are'} not shown.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
