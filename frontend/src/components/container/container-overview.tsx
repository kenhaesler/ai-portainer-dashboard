import { Box, Server, HardDrive, Clock, Activity, RotateCw, Network, Tag } from 'lucide-react';
import { type Container } from '@/hooks/use-containers';
import { StatusBadge } from '@/components/shared/status-badge';
import { formatDate } from '@/lib/utils';

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

function MetadataItem({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}

interface ContainerOverviewProps {
  container: Container;
}

export function ContainerOverview({ container }: ContainerOverviewProps) {
  const ports = container.ports || [];
  const networks = container.networks || [];
  const labels = container.labels || {};
  const labelEntries = Object.entries(labels);

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

        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <MetadataItem
            icon={Server}
            label="Endpoint"
            value={container.endpointName}
          />
          <MetadataItem
            icon={HardDrive}
            label="Image"
            value={container.image.split(':')[0].split('/').pop() || container.image}
          />
          <MetadataItem
            icon={Clock}
            label="Uptime"
            value={formatUptime(container.created)}
          />
          <MetadataItem
            icon={Activity}
            label="Status"
            value={container.status}
          />
          <MetadataItem
            icon={RotateCw}
            label="Created"
            value={formatDate(new Date(container.created * 1000))}
          />
        </div>
      </div>

      <div data-testid="container-info-grid" className="grid gap-6 lg:grid-cols-3">
        {/* Image Information Card */}
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            Image Information
          </h3>
          <div className="space-y-2">
            <div>
              <p className="text-xs text-muted-foreground">Full Image</p>
              <p className="text-sm font-mono">{container.image}</p>
            </div>
          </div>
        </div>

        {/* Endpoint Information Card */}
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Server className="h-5 w-5" />
            Endpoint Information
          </h3>
          <div className="space-y-2">
            <div>
              <p className="text-xs text-muted-foreground">Name</p>
              <p className="text-sm font-medium">{container.endpointName}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">ID</p>
              <p className="text-sm font-mono">{container.endpointId}</p>
            </div>
          </div>
        </div>

        {/* Networks Card */}
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Network className="h-5 w-5" />
            Networks
          </h3>
          <div className="flex flex-wrap gap-2">
            {networks.length > 0 ? networks.map((network) => (
              <span
                key={network}
                className="inline-flex items-center rounded-md bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
              >
                {network}
              </span>
            )) : (
              <span className="text-sm text-muted-foreground">No networks attached</span>
            )}
          </div>
        </div>
      </div>

      {/* Port Mappings Card */}
      {ports.length > 0 && (
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Network className="h-5 w-5" />
            Port Mappings
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">Container Port</th>
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">Host Port</th>
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">Type</th>
                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">Host IP</th>
                </tr>
              </thead>
              <tbody>
                {ports.map((port, index) => (
                  <tr key={index} className="border-b last:border-0">
                    <td className="py-2 px-3 font-mono">{port.private}</td>
                    <td className="py-2 px-3 font-mono">{port.public || '-'}</td>
                    <td className="py-2 px-3 uppercase">{port.type}</td>
                    <td className="py-2 px-3 font-mono">0.0.0.0</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Labels Card */}
      {labelEntries.length > 0 && (
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Tag className="h-5 w-5" />
            Labels ({labelEntries.length})
          </h3>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {labelEntries.map(([key, value]) => (
              <div key={key} className="flex flex-col gap-1 p-2 rounded bg-muted/50">
                <p className="text-xs font-mono text-muted-foreground break-all">{key}</p>
                <p className="text-sm font-mono break-all">{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
