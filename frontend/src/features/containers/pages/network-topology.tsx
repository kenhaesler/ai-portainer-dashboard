import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { X, AlertTriangle } from 'lucide-react';
import { ThemedSelect } from '@/shared/components/ui/themed-select';
import { useContainers, type Container } from '@/features/containers/hooks/use-containers';
import { useNetworks, type Network } from '@/features/containers/hooks/use-networks';
import { useEndpoints } from '@/features/containers/hooks/use-endpoints';
import { useAutoRefresh } from '@/shared/hooks/use-auto-refresh';
import { useNetworkRates } from '@/features/observability/hooks/use-metrics';
import { useServiceMap } from '@/features/observability/hooks/use-service-map';
import { TopologyGraph, type RpcEdgeInput } from '@/features/containers/components/network/topology-graph';
import { RefreshControls } from '@/shared/components/ui/refresh-controls';
import { SkeletonChart } from '@/shared/components/feedback/skeleton';
import { EmptyState } from '@/shared/components/feedback/empty-state';
import { StatusBadge } from '@/shared/components/feedback/status-badge';
import { PageHeader } from '@/shared/components/layout/page-header';
import { findDestination } from '@/features/core/lib/navigation-manifest';
import { formatDate } from '@/shared/lib/utils';
import { formatPortMapping, isPubliclyBound } from '@/features/containers/lib/port-bindings';
import { useUiStore } from '@/stores/ui-store';

const PAGE_TITLE = findDestination('/topology')?.label ?? 'Topology';

// Memoised 24h window — recomputed at most once per render. Stable across
// renders within the same minute so React Query can dedupe.
function useLast24hWindow() {
  return useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
    // Round to the minute to keep the React Query cache key stable.
    from.setSeconds(0, 0);
    to.setSeconds(0, 0);
    return { from, to };
  }, []);
}

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

  // RPC overlay (#1233): fetch last-24h service map, default-on if there's
  // anything to show, user can toggle from the header.
  const { from: smFrom, to: smTo } = useLast24hWindow();
  const { data: serviceMap } = useServiceMap({ from: smFrom, to: smTo });
  const observedEdges = useMemo<RpcEdgeInput[]>(() => {
    if (!serviceMap?.edges) return [];
    // Cross-reference each edge with its target node's errorRate so the
    // overlay can colour-code by service health.
    const nodeErrorRate = new Map<string, number | undefined>();
    for (const n of serviceMap.nodes) nodeErrorRate.set(n.name, n.errorRate);
    return serviceMap.edges.map((e) => ({
      source: e.source,
      target: e.target,
      callCount: e.callCount ?? 0,
      avgDuration: e.avgDuration,
      errorRate: nodeErrorRate.get(e.target),
    }));
  }, [serviceMap]);

  const hasObservedTraffic = observedEdges.length > 0;
  const [overlayUserToggled, setOverlayUserToggled] = useState(false);
  const [showObservedTraffic, setShowObservedTraffic] = useState(false);
  useEffect(() => {
    // Default-on once data confirms observed edges exist, but stop
    // overriding the user once they've expressed a preference.
    if (!overlayUserToggled) setShowObservedTraffic(hasObservedTraffic);
  }, [hasObservedTraffic, overlayUserToggled]);

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

  // The hook owns the timer — the dropdown used to schedule nothing at all.
  const { interval, setRefreshInterval } = useAutoRefresh(30, {
    storageKey: 'topology',
    onTick: handleRefresh,
  });

  // Treat both isLoading and isPending-without-data as "loading" to avoid
  // rendering a blank page during SPA navigation before data arrives.
  const isLoading = containersLoading || networksLoading || (containersPending && !containers) || (networksPending && !networks);
  const isError = containersError || networksError;
  const isFetching = containersFetching || networksFetching;

  // The subtitle used to read "Interactive network graph visualization" —
  // three synonyms for "graph", none of which the operator cannot already see.
  // The counts are the fact worth carrying.
  const fleetSummary =
    containers && networks
      ? `${containers.length} container${containers.length !== 1 ? 's' : ''} across ${networks.length} network${networks.length !== 1 ? 's' : ''}`
      : undefined;

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
      <PageHeader
        className="shrink-0"
        title={PAGE_TITLE}
        subtitle={fleetSummary}
        hideSubtitleOnMobile={false}
        actions={
          <>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showObservedTraffic}
                onChange={(e) => {
                  setOverlayUserToggled(true);
                  setShowObservedTraffic(e.target.checked);
                }}
                disabled={!hasObservedTraffic}
                aria-label="Toggle observed traffic overlay"
                className="h-4 w-4 rounded border-input"
              />
              <span className={hasObservedTraffic ? '' : 'text-muted-foreground'}>
                Observed traffic
                {hasObservedTraffic && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    ({observedEdges.length})
                  </span>
                )}
              </span>
            </label>
            <RefreshControls
              interval={interval}
              onIntervalChange={setRefreshInterval}
              onRefresh={handleRefresh}
              isLoading={isFetching}
            />
          </>
        }
      />

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

      </div>

      {/* Graph Container — fills remaining height */}
      <div className="relative flex-1 min-h-0 mt-4">
        {isLoading ? (
          <SkeletonChart size="lg" className="h-full" />
        ) : isError ? (
          <div className="flex h-full flex-col items-center justify-center">
            <EmptyState
              variant="error"
              icon={AlertTriangle}
              title="Error loading topology"
              description="Failed to load containers or networks. Please try again."
            />
            <button
              onClick={handleRefresh}
              className="mt-4 px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="flex gap-4 h-full">
            <div className={`${potatoMode ? '' : 'transition-all'} h-full ${selectedNode ? 'w-2/3' : 'w-full'}`}>
              <TopologyGraph
                containers={graphData.containers}
                networks={graphData.networks}
                onNodeClick={handleNodeClick}
                networkRates={networkRatesData?.rates}
                showObservedTraffic={showObservedTraffic}
                observedEdges={observedEdges}
              />
            </div>

            {/* Side Panel */}
            {selectedNode && (
              <div className="w-1/3 rounded-lg border bg-card p-6 shadow-sm space-y-4 overflow-y-auto">
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
                  <NetworkDetails network={selectedNode.data} containers={containers ?? []} />
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
            {/*
              The bind address is part of the mapping, not decoration. Without
              it the IPv4 and IPv6 bindings Docker publishes for one port render
              as two identical lines, and a loopback-only publish is
              indistinguishable from a world-facing one.
            */}
            {container.ports.map((port, i) => (
              <div key={i} className="text-sm font-mono">
                {formatPortMapping(port)}
                {isPubliclyBound(port.ip) && (
                  <span className="ml-2 font-sans text-xs text-amber-600 dark:text-amber-400">
                    all interfaces
                  </span>
                )}
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

/**
 * Resolve a network's member container IDs to names.
 *
 * The panel listed raw 12-character hex IDs while the rest of the app names
 * containers — and the page already holds the full `containers` array. An ID
 * with no match (a container on another endpoint, or one removed since the
 * network was read) keeps its short ID rather than inventing a name.
 */
export function resolveNetworkMembers(
  containerIds: string[],
  containers: Pick<Container, 'id' | 'name'>[],
): { id: string; shortId: string; name: string | null }[] {
  const nameById = new Map(containers.map((c) => [c.id, c.name]));
  return containerIds.map((id) => ({
    id,
    shortId: id.slice(0, 12),
    name: nameById.get(id) ?? null,
  }));
}

function NetworkDetails({
  network,
  containers,
}: {
  network: Network;
  containers: Pick<Container, 'id' | 'name'>[];
}) {
  const members = resolveNetworkMembers(network.containers, containers);

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
          {members.length > 0 ? (
            <div className="space-y-1">
              {members.map((member) => (
                <div key={member.id} className="text-sm px-2 py-1 rounded bg-muted">
                  <span className={member.name ? '' : 'font-mono'}>
                    {member.name ?? member.shortId}
                  </span>
                  {member.name && (
                    <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                      {member.shortId}
                    </span>
                  )}
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
