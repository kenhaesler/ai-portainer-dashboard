import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Bot,
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
  TrendingUp,
  TrendingDown,
  Minus,
  Timer,
} from 'lucide-react';
import { ThemedSelect } from '@/components/shared/themed-select';
import { useEndpoints } from '@/hooks/use-endpoints';
import { useContainers } from '@/hooks/use-containers';
import { useStacks } from '@/hooks/use-stacks';
import { useContainerMetrics, useAnomalies, useNetworkRates, useAnomalyExplanations } from '@/hooks/use-metrics';
import { useContainerForecast, useForecasts, useAiForecastNarrative, type CapacityForecast } from '@/hooks/use-forecasts';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import { MetricsLineChart } from '@/components/charts/metrics-line-chart';
import { AnomalySparkline } from '@/components/charts/anomaly-sparkline';
import { AutoRefreshToggle } from '@/components/shared/auto-refresh-toggle';
import { RefreshButton } from '@/components/shared/refresh-button';
import { SkeletonCard } from '@/components/shared/loading-skeleton';
import { AiMetricsSummary } from '@/components/metrics/ai-metrics-summary';
import { InlineChatPanel } from '@/components/metrics/inline-chat-panel';
import { CorrelationInsightsPanel } from '@/components/metrics/correlation-insights-panel';
import { useLlmModels } from '@/hooks/use-llm-models';
import { cn } from '@/lib/utils';
import { buildStackGroupedContainerOptions, NO_STACK_LABEL, resolveContainerStackName } from '@/lib/container-stack-grouping';
import {
  BarChart,
  Bar,
  CartesianGrid,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from 'recharts';
import { formatDate } from '@/lib/utils';

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

type ForecastRiskLevel = 'critical' | 'warning' | 'healthy';

function getForecastRiskLevel(forecast: CapacityForecast): ForecastRiskLevel {
  if (forecast.timeToThreshold !== null && forecast.timeToThreshold <= 2) {
    return 'critical';
  }
  if (
    (forecast.timeToThreshold !== null && forecast.timeToThreshold <= 6)
    || (forecast.trend === 'increasing' && forecast.currentValue >= 75)
  ) {
    return 'warning';
  }
  return 'healthy';
}

function getForecastRiskScore(forecast: CapacityForecast): number {
  if (forecast.timeToThreshold !== null) {
    return Math.max(0, 200 - forecast.timeToThreshold * 20);
  }
  if (forecast.trend === 'increasing') return 120 + forecast.currentValue;
  if (forecast.trend === 'stable') return 50 + forecast.currentValue / 2;
  return forecast.currentValue / 2;
}

export default function MetricsDashboardPage() {
  const navigate = useNavigate();
  const [selectedEndpoint, setSelectedEndpoint] = useState<number | null>(null);
  const [selectedStack, setSelectedStack] = useState<string | null>(null);
  const [selectedContainer, setSelectedContainer] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState('1h');
  const [zoomLevel, setZoomLevel] = useState(1);
  const [chatOpen, setChatOpen] = useState(false);
  const { interval, setInterval } = useAutoRefresh(0);

  // Check if LLM is available (hide Ask AI button when Ollama is down)
  const { data: llmModels } = useLlmModels();
  const llmAvailable = (llmModels?.models?.length ?? 0) > 0;

  // Fetch endpoints
  const { data: endpoints, isLoading: endpointsLoading } = useEndpoints();

  // Fetch containers
  const { data: allContainers, isLoading: containersLoading, refetch, isFetching } = useContainers();
  const { data: networkRatesData } = useNetworkRates(selectedEndpoint ?? undefined);
  const { data: stacks } = useStacks();

  // Filter containers by selected endpoint
  const containers = useMemo(() => {
    if (!allContainers || !selectedEndpoint) return [];
    return allContainers.filter((c) => c.endpointId === selectedEndpoint);
  }, [allContainers, selectedEndpoint]);
  const stackNamesForEndpoint = useMemo(() => {
    if (!selectedEndpoint || !stacks) return [];
    return stacks
      .filter((stack) => stack.endpointId === selectedEndpoint)
      .map((stack) => stack.name);
  }, [selectedEndpoint, stacks]);
  const stackOptions = useMemo(() => {
    const stackSet = new Set<string>(stackNamesForEndpoint);
    for (const container of containers) {
      const resolvedStack = resolveContainerStackName(container, stackNamesForEndpoint) ?? NO_STACK_LABEL;
      stackSet.add(resolvedStack);
    }
    return [...stackSet].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
  }, [containers, stackNamesForEndpoint]);
  const filteredContainers = useMemo(() => {
    if (!selectedStack) return containers;
    return containers.filter((container) => {
      const resolvedStack = resolveContainerStackName(container, stackNamesForEndpoint) ?? NO_STACK_LABEL;
      return resolvedStack === selectedStack;
    });
  }, [containers, selectedStack, stackNamesForEndpoint]);
  const groupedContainerOptions = useMemo(
    () => buildStackGroupedContainerOptions(filteredContainers, stackNamesForEndpoint),
    [filteredContainers, stackNamesForEndpoint],
  );
  // Get selected container details
  const selectedContainerData = useMemo(() => {
    if (!allContainers || !selectedContainer) return null;
    return allContainers.find((c) => c.id === selectedContainer);
  }, [allContainers, selectedContainer]);
  const networkTrafficData = useMemo(() => {
    if (!selectedContainerData) return [];
    const connectedNetworks = selectedContainerData.networks ?? [];
    if (!connectedNetworks.length) return [];

    const rate = networkRatesData?.rates?.[selectedContainerData.id];
    const split = connectedNetworks.length;
    const perNetworkRx = split > 0 ? (rate?.rxBytesPerSec ?? 0) / split : 0;
    const perNetworkTx = split > 0 ? (rate?.txBytesPerSec ?? 0) / split : 0;

    return connectedNetworks
      .map((networkName) => ({
        network: networkName,
        rx: perNetworkRx,
        tx: perNetworkTx,
        total: perNetworkRx + perNetworkTx,
      }))
      .sort((a, b) => b.total - a.total);
  }, [selectedContainerData, networkRatesData]);

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

  // Fetch anomaly explanations for selected container
  const { data: explanationsData } = useAnomalyExplanations(
    selectedContainer ?? undefined,
    timeRange,
  );

  // Fetch capacity forecasts for selected container
  const forecastOverviewQuery = useForecasts(20);
  const { data: cpuForecast } = useContainerForecast(selectedContainer ?? '', 'cpu');
  const { data: memoryForecast } = useContainerForecast(selectedContainer ?? '', 'memory');

  const hasForecastData =
    (cpuForecast && !('error' in cpuForecast)) ||
    (memoryForecast && !('error' in memoryForecast));

  // Pre-filter explanations by metric type for reuse
  const cpuExplanations = useMemo(
    () => explanationsData?.explanations?.filter(e => e.title.toLowerCase().includes('cpu')) ?? [],
    [explanationsData],
  );
  const memoryExplanations = useMemo(
    () => explanationsData?.explanations?.filter(e => e.title.toLowerCase().includes('memory')) ?? [],
    [explanationsData],
  );

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

  const cpuAnomalyIndices = useMemo(
    () => cpuData.reduce<number[]>((acc, d, i) => { if (d.isAnomaly) acc.push(i); return acc; }, []),
    [cpuData],
  );
  const memoryAnomalyIndices = useMemo(
    () => memoryData.reduce<number[]>((acc, d, i) => { if (d.isAnomaly) acc.push(i); return acc; }, []),
    [memoryData],
  );

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

  const rankedForecasts = useMemo(() => {
    const forecasts = forecastOverviewQuery.data ?? [];
    return [...forecasts].sort((a, b) => getForecastRiskScore(b) - getForecastRiskScore(a));
  }, [forecastOverviewQuery.data]);

  const riskBuckets = useMemo(() => {
    return rankedForecasts.reduce(
      (acc, forecast) => {
        const level = getForecastRiskLevel(forecast);
        acc[level] += 1;
        return acc;
      },
      { critical: 0, warning: 0, healthy: 0 }
    );
  }, [rankedForecasts]);

  // Handle endpoint change
  const handleEndpointChange = (endpointId: number) => {
    setSelectedEndpoint(endpointId);
    setSelectedStack(null);
    setSelectedContainer(null);
  };

  const handleRefresh = () => {
    refetch();
  };

  const drillIntoForecast = (containerId: string) => {
    const match = allContainers?.find((container) => container.id === containerId);
    if (match) {
      setSelectedEndpoint(match.endpointId);
      setSelectedContainer(match.id);
    }
  };

  const isLoading = endpointsLoading || containersLoading;
  const hasSelection = selectedEndpoint && selectedContainer;
  const metricsLoading = cpuLoading || memoryLoading || memoryBytesLoading;
  const allMetricsEmpty = !metricsLoading && hasSelection
    && cpuData.length === 0 && memoryData.length === 0 && memoryBytesData.length === 0;

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
          {hasSelection && llmAvailable && (
            <button
              onClick={() => setChatOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition-all hover:shadow-md"
            >
              <Bot className="h-4 w-4" />
              Ask AI
            </button>
          )}
          <AutoRefreshToggle interval={interval} onIntervalChange={setInterval} />
          <RefreshButton onClick={handleRefresh} isLoading={isFetching} />
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-card p-4">
        {/* Endpoint Selector */}
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-muted-foreground" />
          <ThemedSelect
            value={selectedEndpoint !== null ? String(selectedEndpoint) : '__placeholder__'}
            onValueChange={(val) => val !== '__placeholder__' && handleEndpointChange(Number(val))}
            placeholder="Select endpoint..."
            disabled={endpointsLoading}
            options={[
              { value: '__placeholder__', label: 'Select endpoint...', disabled: true },
              ...(endpoints?.map((ep) => ({
                value: String(ep.id),
                label: ep.name,
              })) ?? []),
            ]}
          />
        </div>

        {/* Container Selector */}
        <div className="flex items-center gap-2">
          <Box className="h-4 w-4 text-muted-foreground" />
          <ThemedSelect
            value={selectedStack ?? '__all__'}
            onValueChange={(val) => {
              if (val === '__all__') {
                setSelectedStack(null);
              } else {
                setSelectedStack(val);
              }
              setSelectedContainer(null);
            }}
            placeholder="All stacks"
            disabled={!selectedEndpoint || containersLoading}
            options={[
              { value: '__all__', label: 'All stacks' },
              ...stackOptions.map((stackName) => ({
                value: stackName,
                label: stackName,
              })),
            ]}
          />
        </div>

        {/* Container Selector */}
        <div className="flex items-center gap-2">
          <Box className="h-4 w-4 text-muted-foreground" />
          <ThemedSelect
            value={selectedContainer ?? '__placeholder__'}
            onValueChange={(val) => val !== '__placeholder__' && setSelectedContainer(val)}
            placeholder="Select container..."
            disabled={!selectedEndpoint || containersLoading}
            options={[
              { value: '__placeholder__', label: 'Select container...', disabled: true },
              ...groupedContainerOptions,
            ]}
          />
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

      {hasSelection && (
        <div className="rounded-lg border bg-card p-4 md:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Network className="h-5 w-5 text-blue-500" />
              <div>
                <h3 className="text-lg font-semibold">Network RX/TX by Network</h3>
                <p className="text-xs text-muted-foreground">
                  Selected container: <span className="font-medium text-foreground">{selectedContainerData?.name}</span>
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate(selectedEndpoint ? `/topology?endpoint=${selectedEndpoint}` : '/topology')}
              className="rounded-md border border-border/70 bg-background/70 px-3 py-1.5 text-xs font-medium hover:bg-muted/60"
            >
              Open Full Topology Map
            </button>
          </div>

          {networkTrafficData.length === 0 ? (
            <div className="flex h-[320px] items-center justify-center rounded-lg border border-dashed bg-muted/20 p-8 text-center">
              <div>
                <p className="font-medium">No connected networks found for this container</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Select a different container or check container network attachments.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={networkTrafficData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                    <XAxis dataKey="network" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => formatBytes(Number(value))} />
                    <Tooltip
                      formatter={(value: number, key: string) => [
                        `${formatBytes(value)} MB/s`,
                        key === 'rx' ? 'RX' : 'TX',
                      ]}
                    />
                    <Legend />
                    <Bar dataKey="rx" name="RX" fill="#06b6d4" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="tx" name="TX" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="rounded-full border border-border/60 bg-background/50 px-2.5 py-1">
                  {networkTrafficData.length} networks
                </span>
                <span className="rounded-full border border-border/60 bg-background/50 px-2.5 py-1">
                  RX/TX source: container-level network rates
                </span>
                <span className="rounded-full border border-border/60 bg-background/50 px-2.5 py-1">
                  Per-network values are estimated (evenly split)
                </span>
              </div>
            </div>
          )}
        </div>
      )}

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
                  anomalyIndices={cpuAnomalyIndices}
                  className="mt-2"
                />
              </div>
              <div className="rounded-lg border bg-card p-4">
                <p className="text-sm text-muted-foreground">Avg Memory</p>
                <p className="text-lg font-semibold">{stats.memory.avg.toFixed(1)}%</p>
                <AnomalySparkline
                  values={memoryData.map((d) => d.value)}
                  anomalyIndices={memoryAnomalyIndices}
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

          {/* AI Summary */}
          <AiMetricsSummary
            endpointId={selectedEndpoint ?? undefined}
            containerId={selectedContainer ?? undefined}
            timeRange={timeRange}
          />

          {/* Charts */}
          {metricsLoading ? (
            <div className="space-y-4">
              <SkeletonCard className="h-[350px]" />
              <SkeletonCard className="h-[350px]" />
            </div>
          ) : allMetricsEmpty ? (
            <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center">
              <Clock className="mx-auto h-10 w-10 text-muted-foreground" />
              <h4 className="mt-3 font-semibold">No Metrics Data Available</h4>
              <p className="mt-2 text-sm text-muted-foreground max-w-lg mx-auto">
                No metrics have been recorded for this container in the selected time range.
                This can happen when:
              </p>
              <ul className="mt-3 text-sm text-muted-foreground space-y-1 max-w-md mx-auto text-left list-disc list-inside">
                <li>The container was recently started and metrics collection hasn&apos;t run yet (runs every 60 seconds)</li>
                <li>The container is stopped or paused</li>
                <li>The selected time range doesn&apos;t overlap with when the container was running</li>
              </ul>
              <p className="mt-4 text-xs text-muted-foreground">
                Try selecting a wider time range or wait for the next collection cycle.
              </p>
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
                <MetricsLineChart
                  data={cpuData}
                  label="CPU Usage"
                  color="#3b82f6"
                  unit="%"
                  height={300 * zoomLevel}
                  anomalyExplanations={cpuExplanations}
                />
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
                <MetricsLineChart
                  data={memoryData}
                  label="Memory Usage"
                  color="#8b5cf6"
                  unit="%"
                  height={300 * zoomLevel}
                  anomalyExplanations={memoryExplanations}
                />
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
                <MetricsLineChart
                  data={memoryBytesData}
                  label="Memory"
                  color="#06b6d4"
                  unit=" MB"
                  height={300 * zoomLevel}
                />
              </div>
            </div>
          )}

          {/* Capacity Forecasts */}
          <div className="space-y-6">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-indigo-500" />
              <h3 className="text-lg font-semibold">Capacity Forecasts</h3>
              <span className="text-sm text-muted-foreground">(24h projection)</span>
            </div>

            {hasForecastData ? (
              <div className="grid gap-6 lg:grid-cols-2">
                {cpuForecast && !('error' in cpuForecast) && (
                  <ForecastCard forecast={cpuForecast} color="#3b82f6" label="CPU" unit="%" llmAvailable={llmAvailable} />
                )}
                {memoryForecast && !('error' in memoryForecast) && (
                  <ForecastCard forecast={memoryForecast} color="#8b5cf6" label="Memory" unit="%" llmAvailable={llmAvailable} />
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center">
                <Clock className="mx-auto h-10 w-10 text-muted-foreground" />
                <h4 className="mt-3 font-semibold">Collecting Metrics Data</h4>
                <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
                  Capacity forecasts require at least <span className="font-medium text-foreground">5 minutes</span> of
                  metrics history. For higher confidence predictions, keep the container running
                  for <span className="font-medium text-foreground">20+ minutes</span>.
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  Metrics are collected every 60 seconds. The longer the container runs, the more accurate the forecast.
                </p>
              </div>
            )}
          </div>

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

      {/* Cross-Container Correlation Insights */}
      <CorrelationInsightsPanel llmAvailable={llmAvailable} hours={24} selectedContainerId={selectedContainer} />

      {/* Forecast Overview */}
      <div className="rounded-lg border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Forecast Overview (Next 24h)</h2>
            <p className="text-sm text-muted-foreground">
              Risk-ranked capacity outlook across containers.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-red-100 px-2.5 py-1 font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
              Critical: {riskBuckets.critical}
            </span>
            <span className="rounded-full bg-amber-100 px-2.5 py-1 font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              Warning: {riskBuckets.warning}
            </span>
            <span className="rounded-full bg-emerald-100 px-2.5 py-1 font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
              Healthy: {riskBuckets.healthy}
            </span>
          </div>
        </div>

        {forecastOverviewQuery.isLoading ? (
          <div className="mt-4 space-y-2">
            <div className="h-10 animate-pulse rounded bg-muted" />
            <div className="h-10 animate-pulse rounded bg-muted" />
            <div className="h-10 animate-pulse rounded bg-muted" />
          </div>
        ) : forecastOverviewQuery.error ? (
          <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-4">
            <p className="font-medium text-destructive">Failed to load forecast overview</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {forecastOverviewQuery.error instanceof Error ? forecastOverviewQuery.error.message : 'Unexpected error'}
            </p>
          </div>
        ) : rankedForecasts.length === 0 ? (
          <div className="mt-4 rounded-md border border-dashed bg-muted/20 p-6 text-center">
            <p className="font-medium">No forecast data available</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Keep metrics collection running to build cross-container forecast insights.
            </p>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-2.5 font-medium">Rank</th>
                  <th className="px-2 py-2.5 font-medium">Container</th>
                  <th className="px-2 py-2.5 font-medium">Metric</th>
                  <th className="px-2 py-2.5 font-medium">Current</th>
                  <th className="px-2 py-2.5 font-medium">Trend</th>
                  <th className="px-2 py-2.5 font-medium">Threshold ETA</th>
                  <th className="px-2 py-2.5 font-medium">Status</th>
                  <th className="px-2 py-2.5 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rankedForecasts.map((forecast, index) => {
                  const riskLevel = getForecastRiskLevel(forecast);
                  const riskStyles: Record<ForecastRiskLevel, string> = {
                    critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
                    warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
                    healthy: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
                  };

                  return (
                    <tr key={`${forecast.containerId}-${forecast.metricType}`} className="border-b last:border-0">
                      <td className="px-2 py-2.5 text-muted-foreground">{index + 1}</td>
                      <td className="px-2 py-2.5 font-medium">{forecast.containerName}</td>
                      <td className="px-2 py-2.5 uppercase text-xs">{forecast.metricType}</td>
                      <td className="px-2 py-2.5">{forecast.currentValue.toFixed(1)}%</td>
                      <td className="px-2 py-2.5 capitalize">{forecast.trend}</td>
                      <td className="px-2 py-2.5">
                        {forecast.timeToThreshold !== null ? `~${forecast.timeToThreshold}h` : 'No breach predicted'}
                      </td>
                      <td className="px-2 py-2.5">
                        <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', riskStyles[riskLevel])}>
                          {riskLevel}
                        </span>
                      </td>
                      <td className="px-2 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => drillIntoForecast(forecast.containerId)}
                          className="rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium hover:bg-accent"
                        >
                          View Details
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Inline Chat Panel */}
      {selectedContainerData && selectedEndpoint && (
        <InlineChatPanel
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          context={{
            containerId: selectedContainerData.id,
            containerName: selectedContainerData.name,
            endpointId: selectedEndpoint,
            endpointName: endpoints?.find((ep) => ep.id === selectedEndpoint)?.name,
            timeRange,
            cpuAvg: stats.cpu.avg,
            memoryAvg: stats.memory.avg,
          }}
        />
      )}
    </div>
  );
}

function ForecastCard({
  forecast,
  color,
  label,
  unit,
  llmAvailable = false,
}: {
  forecast: CapacityForecast;
  color: string;
  label: string;
  unit: string;
  llmAvailable?: boolean;
}) {
  const { data: narrativeData, isLoading: narrativeLoading } = useAiForecastNarrative(
    forecast.containerId,
    forecast.metricType,
    llmAvailable,
  );
  const TrendIcon =
    forecast.trend === 'increasing'
      ? TrendingUp
      : forecast.trend === 'decreasing'
        ? TrendingDown
        : Minus;

  const trendColor =
    forecast.trend === 'increasing'
      ? 'text-red-500'
      : forecast.trend === 'decreasing'
        ? 'text-emerald-500'
        : 'text-muted-foreground';

  const confidenceColor =
    forecast.confidence === 'high'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
      : forecast.confidence === 'medium'
        ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';

  const chartData = forecast.forecast.map((p) => ({
    time: p.timestamp,
    actual: p.isProjected ? undefined : Math.round(p.value * 10) / 10,
    projected: p.isProjected ? Math.round(p.value * 10) / 10 : undefined,
    value: Math.round(p.value * 10) / 10,
    isProjected: p.isProjected,
  }));

  // Overlap: set the projected start point to match the last actual value
  let lastActualIdx = -1;
  for (let i = chartData.length - 1; i >= 0; i--) {
    if (chartData[i].actual !== undefined) { lastActualIdx = i; break; }
  }
  if (lastActualIdx >= 0 && lastActualIdx + 1 < chartData.length) {
    chartData[lastActualIdx].projected = chartData[lastActualIdx].actual;
  }

  // Split index where projection starts
  const projectionStartIdx = chartData.findIndex((d) => d.isProjected);

  return (
    <div className="rounded-lg border bg-card p-5 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
          <span className="font-semibold">{label} Forecast</span>
        </div>
        <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', confidenceColor)}>
          {forecast.confidence} confidence
        </span>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 mb-4 text-sm">
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">Current:</span>
          <span className="font-semibold">{forecast.currentValue.toFixed(1)}{unit}</span>
        </div>
        <div className={cn('flex items-center gap-1', trendColor)}>
          <TrendIcon className="h-4 w-4" />
          <span className="capitalize font-medium">{forecast.trend}</span>
        </div>
        {forecast.timeToThreshold && (
          <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
            <Timer className="h-4 w-4" />
            <span className="font-medium">~{forecast.timeToThreshold}h to 90%</span>
          </div>
        )}
      </div>

      {/* Chart */}
      <div className="h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id={`gradient-${label}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.2} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
              <linearGradient id={`gradient-proj-${label}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.1} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="time"
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => formatDate(v)}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              domain={[0, 100]}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              labelFormatter={(v) => formatDate(v as string)}
              formatter={(value: number, name: string) => [
                `${value}${unit}`,
                name === 'projected' ? `${label} (projected)` : label,
              ]}
            />
            <ReferenceLine y={90} stroke="#ef4444" strokeDasharray="4 4" label={{ value: '90%', position: 'right', fontSize: 10, fill: '#ef4444' }} />
            {projectionStartIdx > 0 && (
              <ReferenceLine
                x={chartData[projectionStartIdx]?.time}
                stroke="#94a3b8"
                strokeDasharray="3 3"
                label={{ value: 'Now', position: 'top', fontSize: 10, fill: '#94a3b8' }}
              />
            )}
            <Area
              type="monotone"
              dataKey="actual"
              stroke={color}
              strokeWidth={2}
              fill={`url(#gradient-${label})`}
              dot={false}
              activeDot={{ r: 3 }}
              connectNulls={false}
            />
            <Area
              type="monotone"
              dataKey="projected"
              stroke={color}
              strokeWidth={2}
              strokeDasharray="5 3"
              fill={`url(#gradient-proj-${label})`}
              dot={false}
              activeDot={{ r: 3 }}
              connectNulls={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* R² score */}
      <p className="mt-2 text-xs text-muted-foreground text-right">
        R² = {forecast.r_squared.toFixed(3)} | slope = {forecast.slope.toFixed(2)}/h
      </p>

      {/* AI Narrative */}
      {llmAvailable && (
        <div className="mt-3 rounded-md border border-border/50 bg-muted/30 px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <Bot className="h-3.5 w-3.5 text-purple-500" />
            <span className="text-xs font-medium text-muted-foreground">AI Analysis</span>
          </div>
          {narrativeLoading ? (
            <div className="h-8 animate-pulse rounded bg-muted" />
          ) : narrativeData?.narrative ? (
            <p className="text-xs leading-relaxed text-foreground/80">{narrativeData.narrative}</p>
          ) : (
            <p className="text-xs text-muted-foreground italic">Narrative unavailable</p>
          )}
        </div>
      )}
    </div>
  );
}
