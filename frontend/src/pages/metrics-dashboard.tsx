import { useState, useMemo } from 'react';
import {
  AlertTriangle,
  Cpu,
  MemoryStick,
  Network,
  Download,
  Clock,
  Server,
  Box,
  RefreshCw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useEndpoints } from '@/hooks/use-endpoints';
import { useContainers } from '@/hooks/use-containers';
import { useContainerMetrics, useAnomalies } from '@/hooks/use-metrics';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import { MetricsLineChart } from '@/components/charts/metrics-line-chart';
import { AnomalySparkline } from '@/components/charts/anomaly-sparkline';
import { AutoRefreshToggle } from '@/components/shared/auto-refresh-toggle';
import { RefreshButton } from '@/components/shared/refresh-button';
import { SkeletonCard } from '@/components/shared/loading-skeleton';
import { cn } from '@/lib/utils';

const TIME_RANGES = [
  { value: '15m', label: '15 min' },
  { value: '30m', label: '30 min' },
  { value: '1h', label: '1 hour' },
  { value: '6h', label: '6 hours' },
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
];

const METRIC_TYPES = [
  { value: 'cpu', label: 'CPU Usage', icon: Cpu, color: '#3b82f6', unit: '%' },
  { value: 'memory', label: 'Memory Usage', icon: MemoryStick, color: '#8b5cf6', unit: '%' },
  { value: 'memory_bytes', label: 'Memory (Bytes)', icon: MemoryStick, color: '#06b6d4', unit: ' MB' },
];

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb.toFixed(1);
}

function exportToCSV(data: Array<{ timestamp: string; value: number }>, filename: string) {
  const csv = [
    'timestamp,value',
    ...data.map((d) => `${d.timestamp},${d.value}`),
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function MetricsDashboardPage() {
  const [selectedEndpoint, setSelectedEndpoint] = useState<number | null>(null);
  const [selectedContainer, setSelectedContainer] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState('1h');
  const [zoomLevel, setZoomLevel] = useState(1);
  const { interval, setInterval } = useAutoRefresh(0);

  // Fetch endpoints
  const { data: endpoints, isLoading: endpointsLoading } = useEndpoints();

  // Fetch containers
  const { data: allContainers, isLoading: containersLoading, refetch, isFetching } = useContainers();

  // Filter containers by selected endpoint
  const containers = useMemo(() => {
    if (!allContainers || !selectedEndpoint) return [];
    return allContainers.filter((c) => c.endpointId === selectedEndpoint);
  }, [allContainers, selectedEndpoint]);

  // Get selected container details
  const selectedContainerData = useMemo(() => {
    if (!allContainers || !selectedContainer) return null;
    return allContainers.find((c) => c.id === selectedContainer);
  }, [allContainers, selectedContainer]);

  // Fetch metrics for each type
  const {
    data: cpuMetrics,
    isLoading: cpuLoading,
    isError: cpuError,
  } = useContainerMetrics(
    selectedEndpoint ?? undefined,
    selectedContainer ?? undefined,
    'cpu',
    timeRange
  );

  const {
    data: memoryMetrics,
    isLoading: memoryLoading,
    isError: memoryError,
  } = useContainerMetrics(
    selectedEndpoint ?? undefined,
    selectedContainer ?? undefined,
    'memory',
    timeRange
  );

  const {
    data: memoryBytesMetrics,
    isLoading: memoryBytesLoading,
  } = useContainerMetrics(
    selectedEndpoint ?? undefined,
    selectedContainer ?? undefined,
    'memory_bytes',
    timeRange
  );

  // Fetch anomalies
  const { data: anomaliesData } = useAnomalies();

  // Process data for charts
  const cpuData = useMemo(() => {
    if (!cpuMetrics?.data) return [];
    return cpuMetrics.data.map((d) => ({
      timestamp: d.timestamp,
      value: d.value,
      isAnomaly: d.value > 80,
    }));
  }, [cpuMetrics]);

  const memoryData = useMemo(() => {
    if (!memoryMetrics?.data) return [];
    return memoryMetrics.data.map((d) => ({
      timestamp: d.timestamp,
      value: d.value,
      isAnomaly: d.value > 80,
    }));
  }, [memoryMetrics]);

  const memoryBytesData = useMemo(() => {
    if (!memoryBytesMetrics?.data) return [];
    return memoryBytesMetrics.data.map((d) => ({
      timestamp: d.timestamp,
      value: d.value / (1024 * 1024), // Convert to MB
      isAnomaly: false,
    }));
  }, [memoryBytesMetrics]);

  // Calculate statistics
  const stats = useMemo(() => {
    const calcStats = (data: Array<{ value: number }>) => {
      if (!data.length) return { avg: 0, max: 0, min: 0 };
      const values = data.map((d) => d.value);
      return {
        avg: values.reduce((a, b) => a + b, 0) / values.length,
        max: Math.max(...values),
        min: Math.min(...values),
      };
    };

    return {
      cpu: calcStats(cpuData),
      memory: calcStats(memoryData),
      memoryBytes: calcStats(memoryBytesData),
    };
  }, [cpuData, memoryData, memoryBytesData]);

  // Handle endpoint change
  const handleEndpointChange = (endpointId: number) => {
    setSelectedEndpoint(endpointId);
    setSelectedContainer(null);
  };

  const isLoading = endpointsLoading || containersLoading;
  const hasSelection = selectedEndpoint && selectedContainer;
  const metricsLoading = cpuLoading || memoryLoading || memoryBytesLoading;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Metrics Dashboard</h1>
          <p className="text-muted-foreground">
            CPU/memory time series with anomaly detection
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoRefreshToggle interval={interval} onIntervalChange={setInterval} />
          <RefreshButton onClick={() => refetch()} isLoading={isFetching} />
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-card p-4">
        {/* Endpoint Selector */}
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-muted-foreground" />
          <select
            value={selectedEndpoint ?? ''}
            onChange={(e) => handleEndpointChange(Number(e.target.value))}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={endpointsLoading}
          >
            <option value="">Select endpoint...</option>
            {endpoints?.map((ep) => (
              <option key={ep.id} value={ep.id}>
                {ep.name}
              </option>
            ))}
          </select>
        </div>

        {/* Container Selector */}
        <div className="flex items-center gap-2">
          <Box className="h-4 w-4 text-muted-foreground" />
          <select
            value={selectedContainer ?? ''}
            onChange={(e) => setSelectedContainer(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={!selectedEndpoint || containersLoading}
          >
            <option value="">Select container...</option>
            {containers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Time Range Selector */}
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <div className="flex rounded-md border border-input overflow-hidden">
            {TIME_RANGES.map((range) => (
              <button
                key={range.value}
                onClick={() => setTimeRange(range.value)}
                className={cn(
                  'px-3 py-1.5 text-sm font-medium transition-colors',
                  timeRange === range.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background hover:bg-muted'
                )}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={() => setZoomLevel((z) => Math.max(0.5, z - 0.25))}
            className="rounded-md p-2 hover:bg-muted"
            title="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="text-sm text-muted-foreground min-w-[3rem] text-center">
            {Math.round(zoomLevel * 100)}%
          </span>
          <button
            onClick={() => setZoomLevel((z) => Math.min(2, z + 0.25))}
            className="rounded-md p-2 hover:bg-muted"
            title="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="space-y-4">
          <SkeletonCard className="h-[350px]" />
          <SkeletonCard className="h-[350px]" />
        </div>
      )}

      {/* No Selection State */}
      {!isLoading && !hasSelection && (
        <div className="rounded-lg border border-dashed bg-muted/20 p-12 text-center">
          <Server className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold">Select a Container</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Choose an endpoint and container to view metrics
          </p>
        </div>
      )}

      {/* Metrics Content */}
      {hasSelection && (
        <>
          {/* Container Info & Stats */}
          {selectedContainerData && (
            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-lg border bg-card p-4">
                <p className="text-sm text-muted-foreground">Container</p>
                <p className="text-lg font-semibold truncate">{selectedContainerData.name}</p>
              </div>
              <div className="rounded-lg border bg-card p-4">
                <p className="text-sm text-muted-foreground">Avg CPU</p>
                <p className="text-lg font-semibold">{stats.cpu.avg.toFixed(1)}%</p>
                <AnomalySparkline
                  values={cpuData.map((d) => d.value)}
                  anomalyIndices={cpuData.map((d, i) => d.isAnomaly ? i : -1).filter((i) => i >= 0)}
                  className="mt-2"
                />
              </div>
              <div className="rounded-lg border bg-card p-4">
                <p className="text-sm text-muted-foreground">Avg Memory</p>
                <p className="text-lg font-semibold">{stats.memory.avg.toFixed(1)}%</p>
                <AnomalySparkline
                  values={memoryData.map((d) => d.value)}
                  anomalyIndices={memoryData.map((d, i) => d.isAnomaly ? i : -1).filter((i) => i >= 0)}
                  className="mt-2"
                />
              </div>
              <div className="rounded-lg border bg-card p-4">
                <p className="text-sm text-muted-foreground">Peak Memory</p>
                <p className="text-lg font-semibold">{stats.memoryBytes.max.toFixed(1)} MB</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Min: {stats.memoryBytes.min.toFixed(1)} MB
                </p>
              </div>
            </div>
          )}

          {/* Charts */}
          {metricsLoading ? (
            <div className="space-y-4">
              <SkeletonCard className="h-[350px]" />
              <SkeletonCard className="h-[350px]" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* CPU Chart */}
              <div className="rounded-lg border bg-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Cpu className="h-5 w-5 text-blue-500" />
                    <h3 className="text-lg font-semibold">CPU Usage</h3>
                  </div>
                  <button
                    onClick={() => exportToCSV(cpuMetrics?.data || [], `cpu-metrics-${selectedContainer}.csv`)}
                    className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-muted"
                    disabled={!cpuMetrics?.data?.length}
                  >
                    <Download className="h-4 w-4" />
                    Export CSV
                  </button>
                </div>
                <div style={{ height: 300 * zoomLevel }}>
                  <MetricsLineChart
                    data={cpuData}
                    label="CPU Usage"
                    color="#3b82f6"
                    unit="%"
                  />
                </div>
                {cpuError && (
                  <div className="mt-4 flex items-center gap-2 text-sm text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                    Failed to load CPU metrics
                  </div>
                )}
              </div>

              {/* Memory Chart */}
              <div className="rounded-lg border bg-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <MemoryStick className="h-5 w-5 text-purple-500" />
                    <h3 className="text-lg font-semibold">Memory Usage</h3>
                  </div>
                  <button
                    onClick={() => exportToCSV(memoryMetrics?.data || [], `memory-metrics-${selectedContainer}.csv`)}
                    className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-muted"
                    disabled={!memoryMetrics?.data?.length}
                  >
                    <Download className="h-4 w-4" />
                    Export CSV
                  </button>
                </div>
                <div style={{ height: 300 * zoomLevel }}>
                  <MetricsLineChart
                    data={memoryData}
                    label="Memory Usage"
                    color="#8b5cf6"
                    unit="%"
                  />
                </div>
                {memoryError && (
                  <div className="mt-4 flex items-center gap-2 text-sm text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                    Failed to load memory metrics
                  </div>
                )}
              </div>

              {/* Memory Bytes Chart */}
              <div className="rounded-lg border bg-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <MemoryStick className="h-5 w-5 text-cyan-500" />
                    <h3 className="text-lg font-semibold">Memory (Absolute)</h3>
                  </div>
                  <button
                    onClick={() => exportToCSV(
                      memoryBytesMetrics?.data?.map((d) => ({ ...d, value: d.value / (1024 * 1024) })) || [],
                      `memory-bytes-${selectedContainer}.csv`
                    )}
                    className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-muted"
                    disabled={!memoryBytesMetrics?.data?.length}
                  >
                    <Download className="h-4 w-4" />
                    Export CSV
                  </button>
                </div>
                <div style={{ height: 300 * zoomLevel }}>
                  <MetricsLineChart
                    data={memoryBytesData}
                    label="Memory"
                    color="#06b6d4"
                    unit=" MB"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Anomaly Summary */}
          {anomaliesData && (
            <div className="rounded-lg border bg-card p-6">
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                <h3 className="text-lg font-semibold">Recent Anomalies</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Anomalies are highlighted with red dots on the charts. Values exceeding 80% threshold are flagged.
              </p>
              <div className="mt-4 flex items-center gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-red-500" />
                  <span>Anomaly detected</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-blue-500" />
                  <span>Normal value</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
