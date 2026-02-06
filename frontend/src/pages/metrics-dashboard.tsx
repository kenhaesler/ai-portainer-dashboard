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
  TrendingUp,
  TrendingDown,
  Minus,
  Timer,
} from 'lucide-react';
import { useEndpoints } from '@/hooks/use-endpoints';
import { useContainers } from '@/hooks/use-containers';
import { useContainerMetrics, useAnomalies } from '@/hooks/use-metrics';
import { useContainerForecast, type CapacityForecast } from '@/hooks/use-forecasts';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import { MetricsLineChart } from '@/components/charts/metrics-line-chart';
import { AnomalySparkline } from '@/components/charts/anomaly-sparkline';
import { AutoRefreshToggle } from '@/components/shared/auto-refresh-toggle';
import { RefreshButton } from '@/components/shared/refresh-button';
import { SkeletonCard } from '@/components/shared/loading-skeleton';
import { cn } from '@/lib/utils';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
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

  // Fetch capacity forecasts for selected container
  const { data: cpuForecast } = useContainerForecast(selectedContainer ?? '', 'cpu');
  const { data: memoryForecast } = useContainerForecast(selectedContainer ?? '', 'memory');

  const hasForecastData =
    (cpuForecast && !('error' in cpuForecast)) ||
    (memoryForecast && !('error' in memoryForecast));

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
                  <ForecastCard forecast={cpuForecast} color="#3b82f6" label="CPU" unit="%" />
                )}
                {memoryForecast && !('error' in memoryForecast) && (
                  <ForecastCard forecast={memoryForecast} color="#8b5cf6" label="Memory" unit="%" />
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
    </div>
  );
}

function ForecastCard({
  forecast,
  color,
  label,
  unit,
}: {
  forecast: CapacityForecast;
  color: string;
  label: string;
  unit: string;
}) {
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
    </div>
  );
}
