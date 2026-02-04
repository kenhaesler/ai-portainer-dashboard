import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ScrollText } from 'lucide-react';
import { useEndpoints } from '@/hooks/use-endpoints';
import { useContainers } from '@/hooks/use-containers';
import { RefreshButton } from '@/components/shared/refresh-button';
import { ContainerLogsViewer } from '@/components/container/container-logs-viewer';

export default function ContainerLogsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // URL state management for endpoint
  const endpointParam = searchParams.get('endpoint');
  const containerParam = searchParams.get('container');
  const selectedEndpoint = endpointParam ? Number(endpointParam) : undefined;
  const selectedContainer = containerParam || undefined;

  const setSelectedEndpoint = (endpointId: number | undefined) => {
    const params: Record<string, string> = {};
    if (endpointId !== undefined) {
      params.endpoint = String(endpointId);
    }
    setSearchParams(params);
  };

  const setSelectedContainer = (containerId: string | undefined) => {
    const params: Record<string, string> = {};
    if (selectedEndpoint !== undefined) {
      params.endpoint = String(selectedEndpoint);
    }
    if (containerId) {
      params.container = containerId;
    }
    setSearchParams(params);
  };

  // Data fetching
  const { data: endpoints, isLoading: endpointsLoading } = useEndpoints();
  const { data: containers, isLoading: containersLoading } = useContainers(selectedEndpoint);

  // Filter containers list
  const availableContainers = useMemo(() => {
    if (!containers) return [];
    return containers;
  }, [containers]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Container Logs</h1>
        <p className="text-muted-foreground">
          Docker container log viewer
        </p>
      </div>

      {/* Selectors */}
      <div className="flex items-center gap-4 flex-wrap">
        {/* Endpoint Selector */}
        <div className="flex items-center gap-2">
          <label htmlFor="endpoint-select" className="text-sm font-medium">
            Endpoint
          </label>
          <select
            id="endpoint-select"
            value={selectedEndpoint ?? ''}
            onChange={(e) => setSelectedEndpoint(e.target.value ? Number(e.target.value) : undefined)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={endpointsLoading}
          >
            <option value="">Select an endpoint</option>
            {endpoints?.map((ep) => (
              <option key={ep.id} value={ep.id}>
                {ep.name} (ID: {ep.id})
              </option>
            ))}
          </select>
        </div>

        {/* Container Selector */}
        <div className="flex items-center gap-2">
          <label htmlFor="container-select" className="text-sm font-medium">
            Container
          </label>
          <select
            id="container-select"
            value={selectedContainer ?? ''}
            onChange={(e) => setSelectedContainer(e.target.value || undefined)}
            className="min-w-[300px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={!selectedEndpoint || containersLoading}
          >
            <option value="">Select a container</option>
            {availableContainers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.endpointName})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Log Viewer */}
      {!selectedEndpoint || !selectedContainer ? (
        <div className="rounded-lg border bg-card p-8 text-center">
          <ScrollText className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-4 font-medium">No container selected</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Select an endpoint and container to view logs
          </p>
        </div>
      ) : (
        <ContainerLogsViewer
          endpointId={selectedEndpoint}
          containerId={selectedContainer}
        />
      )}
    </div>
  );
}
