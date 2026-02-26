import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { ThemedSelect } from '@/shared/components/themed-select';
import { useContainers, type Container } from '@/features/containers/hooks/use-containers';
import { useNetworks, type Network } from '@/features/containers/hooks/use-networks';
import { useEndpoints } from '@/features/containers/hooks/use-endpoints';
import { useAutoRefresh } from '@/shared/hooks/use-auto-refresh';
import { useNetworkRates } from '@/features/observability/hooks/use-metrics';
import { TopologyGraph } from '@/features/containers/components/network/topology-graph';
import { AutoRefreshToggle } from '@/shared/components/auto-refresh-toggle';
import { RefreshButton } from '@/shared/components/refresh-button';
import { SkeletonCard } from '@/shared/components/loading-skeleton';
import { StatusBadge } from '@/shared/components/status-badge';
import { formatDate } from '@/shared/lib/utils';
import { useUiStore } from '@/stores/ui-store';

type SelectedNode =
  | { type: 'container'; data: Container }
  | { type: 'network'; data: Network }
  | null;

export default function NetworkTopologyPage() {
  const potatoMode = useUiStore((state) => state.potatoMode);
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedNode, setSelectedNode] = useState<SelectedNode>(null);

  const endpointParam = searchParams.get('endpoint');
  const selectedEndpoint = endpointParam ? Number(endpointParam) : undefined;

  const setSelectedEndpoint = (endpointId: number | undefined) => {
    const params: Record<string, string> = {};
    if (endpointId !== undefined) {
      params.endpoint = String(endpointId);
    }
    setSearchParams(params);
  };

  const { data: endpoints } = useEndpoints();
  const { data: containers, isLoading: containersLoading, isPending: containersPending, isError: containersError, refetch: refetchContainers, isFetching: containersFetching } = useContainers(selectedEndpoint !== undefined ? { endpointId: selectedEndpoint } : undefined);
  const { data: networks, isLoading: networksLoading, isPending: networksPending, isError: networksError, refetch: refetchNetworks, isFetching: networksFetching } = useNetworks(selectedEndpoint);
  const { data: networkRatesData } = useNetworkRates(selectedEndpoint);
  const { interval, setInterval } = useAutoRefresh(30);

  // Transform data for TopologyGraph
  const graphData = useMemo(() => {
    if (!containers || !networks) {
      return { containers: [], networks: [] };
    }

    const transformedContainers = containers.map(c => ({
      id: c.id,
      name: c.name,
      state: c.state as 'running' | 'stopped' | 'paused' | 'unknown',
      image: c.image,
      networks: c.networks,
      labels: c.labels,
    }));

    const transformedNetworks = networks.map(n => ({
      id: n.id,
      name: n.name,
      driver: n.driver,
      subnet: n.subnet,
      containers: n.containers,
    }));

    return {
      containers: transformedContainers,
      networks: transformedNetworks,
    };
  }, [containers, networks]);

  const handleRefresh = () => {
    refetchContainers();
    refetchNetworks();
  };

  // Treat both isLoading and isPending-without-data as "loading" to avoid
  // rendering a blank page during SPA navigation before data arrives.
  const isLoading = containersLoading || networksLoading || (containersPending && !containers) || (networksPending && !networks);
  const isError = containersError || networksError;
  const isFetching = containersFetching || networksFetching;

  const handleNodeClick = (nodeId: string) => {
    // Determine if it's a container or network node
    if (nodeId.startsWith('container-')) {
      const containerId = nodeId.replace('container-', '');
      const container = containers?.find(c => c.id === containerId);
      if (container) {
        setSelectedNode({ type: 'container', data: container });
      }
    } else if (nodeId.startsWith('net-')) {
      const networkId = nodeId.replace('net-', '');
      const network = networks?.find(n => n.id === networkId);
      if (network) {
        setSelectedNode({ type: 'network', data: network });
      }
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Network Topology</h1>
          <p className="text-muted-foreground">
            Interactive network graph visualization
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoRefreshToggle interval={interval} onIntervalChange={setInterval} />
          <RefreshButton onClick={handleRefresh} isLoading={isFetching} />
        </div>
      </div>

      {/* Endpoint Filter */}
      <div className="flex items-center gap-4 flex-wrap shrink-0 mt-4">
        <div className="flex items-center gap-2">
          <label htmlFor="endpoint-select" className="text-sm font-medium">
            Endpoint
          </label>
          <ThemedSelect
            id="endpoint-select"
            value={selectedEndpoint !== undefined ? String(selectedEndpoint) : '__all__'}
            onValueChange={(val) => setSelectedEndpoint(val === '__all__' ? undefined : Number(val))}
            options={[
              { value: '__all__', label: 'All endpoints' },
              ...(endpoints?.map((ep) => ({
                value: String(ep.id),
                label: `${ep.name} (ID: ${ep.id})`,
              })) ?? []),
            ]}
          />
        </div>

        {containers && networks && (
          <span className="text-sm text-muted-foreground">
            {containers.length} container{containers.length !== 1 ? 's' : ''} · {networks.length} network{networks.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Graph Container — fills remaining height */}
      <div className="relative flex-1 min-h-0 mt-4">
        {isLoading ? (
          <SkeletonCard className="h-full" />
        ) : isError ? (
          <div className="flex h-full items-center justify-center rounded-lg border bg-card p-8">
            <div className="text-center">
              <p className="text-lg font-semibold text-destructive">Error loading topology</p>
              <p className="text-sm text-muted-foreground mt-2">
                Failed to load containers or networks. Please try again.
              </p>
              <button
                onClick={handleRefresh}
                className="mt-4 px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Retry
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-4 h-full">
            <div className={`${potatoMode ? '' : 'transition-all'} h-full ${selectedNode ? 'w-2/3' : 'w-full'}`}>
              <TopologyGraph
                containers={graphData.containers}
                networks={graphData.networks}
                onNodeClick={handleNodeClick}
                networkRates={networkRatesData?.rates}
              />
            </div>

            {/* Side Panel */}
            {selectedNode && (
              <div className="w-1/3 rounded-lg border bg-card p-6 space-y-4 overflow-y-auto">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">
                    {selectedNode.type === 'container' ? 'Container Details' : 'Network Details'}
                  </h3>
                  <button
                    onClick={() => setSelectedNode(null)}
                    className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {selectedNode.type === 'container' ? (
                  <ContainerDetails container={selectedNode.data} />
                ) : (
                  <NetworkDetails network={selectedNode.data} />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ContainerDetails({ container }: { container: Container }) {
  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-medium text-muted-foreground">Name</label>
        <p className="text-sm font-mono">{container.name}</p>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">Status</label>
        <div className="mt-1">
          <StatusBadge status={container.state} />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">Image</label>
        <p className="text-sm font-mono break-all">{container.image}</p>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">Endpoint</label>
        <p className="text-sm">{container.endpointName}</p>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">Networks</label>
        <div className="mt-1 space-y-1">
          {container.networks.length > 0 ? (
            container.networks.map((net) => (
              <div key={net} className="text-sm px-2 py-1 rounded bg-muted">
                {net}
                {container.networkIPs?.[net] && (
                  <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                    ({container.networkIPs[net]})
                  </span>
                )}
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No networks</p>
          )}
        </div>
      </div>

      {container.ports.length > 0 && (
        <div>
          <label className="text-xs font-medium text-muted-foreground">Ports</label>
          <div className="mt-1 space-y-1">
            {container.ports.map((port, i) => (
              <div key={i} className="text-sm font-mono">
                {port.public ? `${port.public} → ` : ''}{port.private}/{port.type}
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="text-xs font-medium text-muted-foreground">Created</label>
        <p className="text-sm">{formatDate(new Date(container.created * 1000))}</p>
      </div>

      {Object.keys(container.labels).length > 0 && (
        <div>
          <label className="text-xs font-medium text-muted-foreground">Labels</label>
          <div className="mt-1 space-y-1 max-h-40 overflow-y-auto">
            {Object.entries(container.labels).map(([key, value]) => (
              <div key={key} className="text-xs">
                <span className="font-mono text-muted-foreground">{key}:</span>{' '}
                <span className="font-mono">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NetworkDetails({ network }: { network: Network }) {
  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-medium text-muted-foreground">Name</label>
        <p className="text-sm font-mono">{network.name}</p>
      </div>

      {network.driver && (
        <div>
          <label className="text-xs font-medium text-muted-foreground">Driver</label>
          <p className="text-sm">{network.driver}</p>
        </div>
      )}

      {network.scope && (
        <div>
          <label className="text-xs font-medium text-muted-foreground">Scope</label>
          <p className="text-sm">{network.scope}</p>
        </div>
      )}

      {network.subnet && (
        <div>
          <label className="text-xs font-medium text-muted-foreground">Subnet</label>
          <p className="text-sm font-mono">{network.subnet}</p>
        </div>
      )}

      {network.gateway && (
        <div>
          <label className="text-xs font-medium text-muted-foreground">Gateway</label>
          <p className="text-sm font-mono">{network.gateway}</p>
        </div>
      )}

      <div>
        <label className="text-xs font-medium text-muted-foreground">Endpoint</label>
        <p className="text-sm">{network.endpointName}</p>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">Connected Containers</label>
        <div className="mt-1">
          {network.containers.length > 0 ? (
            <div className="space-y-1">
              {network.containers.map((containerId) => (
                <div key={containerId} className="text-sm px-2 py-1 rounded bg-muted font-mono">
                  {containerId.slice(0, 12)}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No containers connected</p>
          )}
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-muted-foreground">ID</label>
        <p className="text-xs font-mono text-muted-foreground break-all">{network.id}</p>
      </div>
    </div>
  );
}
