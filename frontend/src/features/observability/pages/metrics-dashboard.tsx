import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type ColumnDef } from '@tanstack/react-table';
import {
  AlertTriangle,
  Bot,
  Cpu,
  MemoryStick,
  Network,
  Download,
  Clock,
  Search,
  Server,
  Box,
  ShieldCheck,
  TrendingUp,
  TrendingDown,
  Minus,
  Timer,
} from 'lucide-react';
import { ThemedSelect } from '@/shared/components/ui/themed-select';
import { useEndpoints } from '@/features/containers/hooks/use-endpoints';
import { useContainers } from '@/features/containers/hooks/use-containers';
import { useStacks } from '@/features/containers/hooks/use-stacks';
import { useContainerMetrics, useAnomalies, useNetworkRates, useAnomalyExplanations, useContainerMetricsMeta } from '@/features/observability/hooks/use-metrics';
import { useHeaderContextStore } from '@/stores/header-context-store';
import { useContainerForecast, useForecasts, useAiForecastNarrative, type CapacityForecast } from '@/features/observability/hooks/use-forecasts';
import { useAutoRefresh } from '@/shared/hooks/use-auto-refresh';
import { MetricsLineChart } from '@/shared/components/charts/metrics-line-chart';
import { AnomalySparkline } from '@/shared/components/charts/anomaly-sparkline';
import { NetworkTrafficTooltip } from '@/shared/components/charts/network-traffic-tooltip';
import { RefreshControls } from '@/shared/components/ui/refresh-controls';
import { PageHeader } from '@/shared/components/layout/page-header';
import { DataFreshness } from '@/shared/components/feedback/data-freshness';
import { EmptyState } from '@/shared/components/feedback/empty-state';
import { SkeletonText, SkeletonChart, SkeletonTableRow } from '@/shared/components/feedback/skeleton';
import { DataTable } from '@/shared/components/tables/data-table';
import { SpotlightCard } from '@/shared/components/data-display/spotlight-card';
import { useLlmModels } from '@/features/ai-intelligence/hooks/use-llm-models';
import { cn } from '@/shared/lib/utils';
import { buildStackGroupedContainerOptions, NO_STACK_LABEL, resolveContainerStackName } from '@/features/containers/lib/container-stack-grouping';
import { decimateTimeSeries } from '@/features/observability/lib/metrics-decimation';
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
import { formatDate } from '@/shared/lib/utils';

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

const LazyAiMetricsSummary = lazy(() =>
  import('@/features/ai-intelligence/components/metrics/ai-metrics-summary').then((module) => ({ default: module.AiMetricsSummary })),
);
const LazyCorrelationInsightsPanel = lazy(() =>
  import('@/features/ai-intelligence/components/metrics/correlation-insights-panel').then((module) => ({ default: module.CorrelationInsightsPanel })),
);
// Lazy like its siblings above (#1507): the panel statically pulls in the
// react-markdown + highlight.js chunk (~326KB raw), which should load on first
// chat open instead of on every /metrics visit.
const LazyInlineChatPanel = lazy(() =>
  import('@/features/ai-intelligence/components/metrics/inline-chat-panel').then((module) => ({ default: module.InlineChatPanel })),
);
const DEFAULT_MAX_POINTS = 240;

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb.toFixed(1);
}

// Compact MB/GB formatter for the memory denominator label. Intentionally simpler
// than shared/lib/utils.ts:formatBytes — whole-MB rounding, no sub-MB units — to keep
// the "used / limit" label terse.
function formatMemSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

/**
 * The last endpoint/container the operator looked at.
 *
 * The page's whole subject sat behind two clicks on every visit, and in a
 * one-endpoint fleet the first of those clicks had exactly one answer. This is
 * re-validated against the live container list before it is applied, so a
 * container that has since been removed falls back to the empty state rather
 * than selecting something that no longer exists.
 */
const LAST_SELECTION_KEY = 'metrics-dashboard:last-selection';

export interface MetricsSelection {
  endpointId: number;
  containerId: string;
}

export function readLastSelection(): MetricsSelection | null {
  try {
    const raw = localStorage.getItem(LAST_SELECTION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MetricsSelection>;
    if (typeof parsed?.endpointId !== 'number' || typeof parsed?.containerId !== 'string') {
      return null;
    }
    return { endpointId: parsed.endpointId, containerId: parsed.containerId };
  } catch {
    return null;
  }
}

function writeLastSelection(selection: MetricsSelection): void {
  try {
    localStorage.setItem(LAST_SELECTION_KEY, JSON.stringify(selection));
  } catch {
    // Ignore storage errors (private mode, quota).
  }
}

/**
 * Docker reports the host's total RAM as a container's `limit` when no explicit
 * cap is set, so "limit == host total" is the signal for an unconstrained
 * container rather than a missing reading.
 */
function resolveMemoryLimit(
  limitBytes: number | null | undefined,
  hostTotalBytes: number | null | undefined,
): { limit: number; isHostTotal: boolean } | null {
  if (limitBytes == null) return null;
  return {
    limit: limitBytes,
    isHostTotal: hostTotalBytes != null && limitBytes >= hostTotalBytes * 0.99,
  };
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

/**
 * An ETA is only shown when the fit behind it supports one.
 *
 * `capacity-forecaster.ts` computes `(90 - currentValue) / slope` from an OLS
 * fit with no goodness-of-fit gate, so a weak fit over a past spike yields a
 * hard "breach in ~1h" — the live fleet's top-ranked risk was a container at
 * **0.0% CPU** projected to breach within the hour. The backend already
 * returns `confidence` and `r_squared`; the fleet table rendered neither, so
 * the two fields that would let an operator discount the row were dropped at
 * the render boundary while the ETA they qualify was kept.
 */
export function hasReportableEta(forecast: Pick<CapacityForecast, 'timeToThreshold' | 'confidence'>): boolean {
  return forecast.timeToThreshold !== null && forecast.confidence !== 'low';
}

export function getForecastRiskLevel(forecast: CapacityForecast): ForecastRiskLevel {
  const eta = hasReportableEta(forecast) ? forecast.timeToThreshold : null;
  if (eta !== null && eta <= 2) {
    return 'critical';
  }
  if (
    (eta !== null && eta <= 6)
    || (forecast.trend === 'increasing' && forecast.currentValue >= 75)
  ) {
    return 'warning';
  }
  return 'healthy';
}

/**
 * Rank for the "Risk-ranked" fleet table.
 *
 * The two branches previously used incompatible scales: `200 - eta * 20` for
 * rows with an ETA (120 at 4h) against `120 + currentValue` for rows without
 * (130.7 for a healthy container idling at 10.7%). Every projected breach more
 * than four hours out was therefore buried below rows the same table labelled
 * Healthy — a table that inverted its own severity column. The old ETA branch
 * also clamped at 0, so a 10h breach sank beneath everything.
 *
 * The bands below cannot overlap: any row with a reportable ETA outranks every
 * row without one, and within each band sooner/larger ranks higher.
 */
const ETA_BAND_FLOOR = 500;
const MAX_RANKED_ETA_HOURS = 24;

export function getForecastRiskScore(forecast: CapacityForecast): number {
  if (hasReportableEta(forecast)) {
    const hours = Math.min(Math.max(forecast.timeToThreshold!, 0), MAX_RANKED_ETA_HOURS);
    // 1000 down to 760 — always clear of the no-ETA band below.
    return 1000 - (hours / MAX_RANKED_ETA_HOURS) * 240;
  }
  // Ceiling here is 400, comfortably under ETA_BAND_FLOOR.
  if (forecast.trend === 'increasing') return 300 + Math.min(forecast.currentValue, 100);
  if (forecast.trend === 'stable') return 150 + Math.min(forecast.currentValue, 100) / 2;
  return Math.min(forecast.currentValue, 100) / 2;
}

export { ETA_BAND_FLOOR as FORECAST_ETA_BAND_FLOOR };

const RISK_BADGE_STYLES: Record<ForecastRiskLevel, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  healthy: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
};

// Risk-rank position is computed once from the pre-sorted ranking so it stays
// stable when the DataTable re-sorts rows by a different column.
type RankedForecast = CapacityForecast & { rank: number };

export default function MetricsDashboardPage() {
  const navigate = useNavigate();
  const [selectedEndpoint, setSelectedEndpoint] = useState<number | null>(null);
  const [selectedStack, setSelectedStack] = useState<string | null>(null);
  const [selectedContainer, setSelectedContainer] = useState<string | null>(null);
  const [containerQuery, setContainerQuery] = useState('');
  const [timeRange, setTimeRange] = useState('1h');
  const [chatOpen, setChatOpen] = useState(false);
  const [showSecondaryPanels, setShowSecondaryPanels] = useState(false);

  // Check if LLM is available (hide Ask AI button when the LLM endpoint is unreachable)
  const { data: llmModels } = useLlmModels();
  const llmAvailable = (llmModels?.models?.length ?? 0) > 0;

  // Fetch endpoints
  const { data: endpoints, isLoading: endpointsLoading, isPending: endpointsPending } = useEndpoints();

  // Fetch containers
  const containersQuery = useContainers();
  const { data: allContainers, isLoading: containersLoading, isPending: containersPending, refetch, isFetching } = containersQuery;
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
  const searchedContainers = useMemo(() => {
    const q = containerQuery.trim().toLowerCase();
    if (!q) return filteredContainers;
    return filteredContainers.filter((container) => {
      const stack = resolveContainerStackName(container, stackNamesForEndpoint) ?? NO_STACK_LABEL;
      return container.name.toLowerCase().includes(q) || stack.toLowerCase().includes(q);
    });
  }, [filteredContainers, containerQuery, stackNamesForEndpoint]);
  const groupedContainerOptions = useMemo(
    () => buildStackGroupedContainerOptions(searchedContainers, stackNamesForEndpoint),
    [searchedContainers, stackNamesForEndpoint],
  );
  // Get selected container details
  const selectedContainerData = useMemo(() => {
    if (!allContainers || !selectedContainer) return null;
    return allContainers.find((c) => c.id === selectedContainer);
  }, [allContainers, selectedContainer]);

  const setMetricsContainerName = useHeaderContextStore((s) => s.setMetricsContainerName);
  const clearMetricsContainerName = useHeaderContextStore((s) => s.clearMetricsContainerName);

  // Feed the selected container name to the shared header; clear on deselect/unmount.
  useEffect(() => {
    if (selectedContainerData?.name) {
      setMetricsContainerName(selectedContainerData.name);
    } else {
      clearMetricsContainerName();
    }
  }, [selectedContainerData, setMetricsContainerName, clearMetricsContainerName]);

  // Also clear on page unmount in case a container is still selected.
  useEffect(() => () => clearMetricsContainerName(), [clearMetricsContainerName]);

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
  const cpuQuery = useContainerMetrics(
    selectedEndpoint ?? undefined,
    selectedContainer ?? undefined,
    'cpu',
    timeRange
  );
  const { data: cpuMetrics, isLoading: cpuLoading, isError: cpuError } = cpuQuery;

  const memoryQuery = useContainerMetrics(
    selectedEndpoint ?? undefined,
    selectedContainer ?? undefined,
    'memory',
    timeRange
  );
  const { data: memoryMetrics, isLoading: memoryLoading, isError: memoryError } = memoryQuery;

  const memoryBytesQuery = useContainerMetrics(
    selectedEndpoint ?? undefined,
    selectedContainer ?? undefined,
    'memory_bytes',
    timeRange
  );
  const { data: memoryBytesMetrics, isLoading: memoryBytesLoading } = memoryBytesQuery;

  const { data: containerMeta } = useContainerMetricsMeta(
    selectedEndpoint ?? undefined,
    selectedContainer ?? undefined,
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

  // The refresh dropdown now schedules the fetches it advertises. It used to be
  // read once and passed to `<RefreshControls>` and nowhere else — the control
  // rendered a pulsing "live" dot over a timer that did not exist. The
  // page-specific `storageKey` is the other half: with one shared key this page
  // asked for `useAutoRefresh(0)` and opened showing "Every 30s" because a
  // different page had stored 30.
  const handleTick = useCallback(() => {
    refetch?.();
    cpuQuery.refetch?.();
    memoryQuery.refetch?.();
    memoryBytesQuery.refetch?.();
    forecastOverviewQuery.refetch?.();
  }, [refetch, cpuQuery, memoryQuery, memoryBytesQuery, forecastOverviewQuery]);
  const { interval, setRefreshInterval } = useAutoRefresh(0, {
    onTick: handleTick,
    storageKey: 'metrics',
  });

  // Second signal for a stalled poll: the newest fetch time of what is on
  // screen. Without it a frozen page and a healthy one look identical.
  const lastUpdated = useMemo(() => {
    const stamps = [
      containersQuery.dataUpdatedAt,
      cpuQuery.dataUpdatedAt,
      memoryQuery.dataUpdatedAt,
    ].filter((t): t is number => typeof t === 'number' && t > 0);
    return stamps.length > 0 ? Math.max(...stamps) : null;
  }, [containersQuery.dataUpdatedAt, cpuQuery.dataUpdatedAt, memoryQuery.dataUpdatedAt]);

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
    const source = cpuMetrics.data.map((d) => ({
      timestamp: d.timestamp,
      value: d.value,
      isAnomaly: d.value > 80,
    }));
    return decimateTimeSeries(source, DEFAULT_MAX_POINTS);
  }, [cpuMetrics]);

  const memoryData = useMemo(() => {
    if (!memoryMetrics?.data) return [];
    const source = memoryMetrics.data.map((d) => ({
      timestamp: d.timestamp,
      value: d.value,
      isAnomaly: d.value > 80,
    }));
    return decimateTimeSeries(source, DEFAULT_MAX_POINTS);
  }, [memoryMetrics]);

  const memoryBytesData = useMemo(() => {
    if (!memoryBytesMetrics?.data) return [];
    const source = memoryBytesMetrics.data.map((d) => ({
      timestamp: d.timestamp,
      value: d.value / (1024 * 1024), // Convert to MB
      isAnomaly: false,
    }));
    return decimateTimeSeries(source, DEFAULT_MAX_POINTS);
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

  const selectedEndpointData = useMemo(
    () => endpoints?.find((ep) => ep.id === selectedEndpoint) ?? null,
    [endpoints, selectedEndpoint],
  );

  const cpuCoresLabel = useMemo(() => {
    const cores = containerMeta?.onlineCpus ?? selectedEndpointData?.totalCpu ?? null;
    if (!cores) return null;
    const used = stats.cpu.avg / 100;
    return `≈${used.toFixed(1)} of ${cores} core${cores === 1 ? '' : 's'} (max ${cores * 100}%)`;
  }, [containerMeta, selectedEndpointData, stats.cpu.avg]);

  const memoryDenominatorLabel = useMemo(() => {
    const resolved = resolveMemoryLimit(
      containerMeta?.memoryLimitBytes,
      selectedEndpointData?.totalMemory,
    );
    // Numerator matches the "Avg Memory %" headline above this label: use the
    // range-average used bytes (memoryBytesData is in MB → ×1MiB) when the series
    // has data, falling back to the live `/meta` sample only when it's empty.
    const avgUsedBytes = memoryBytesData.length > 0
      ? stats.memoryBytes.avg * 1024 * 1024
      : null;
    const used = avgUsedBytes ?? containerMeta?.usedBytes ?? null;
    if (resolved == null || used == null) return null;
    return resolved.isHostTotal
      ? `${formatMemSize(used)} / ${formatMemSize(resolved.limit)} host (no limit set)`
      : `${formatMemSize(used)} / ${formatMemSize(resolved.limit)} limit`;
  }, [containerMeta, selectedEndpointData, stats.memoryBytes.avg, memoryBytesData]);

  // The reasoning behind each percentage used to live in a native `title=` on
  // the KPI sub-label: no keyboard access, no touch access, ~1s hover delay, and
  // this page ships on phones. It is now a persistent caption under the chart —
  // where the axis it explains is actually read.
  const cpuAxisNote = useMemo(() => {
    const cores = containerMeta?.onlineCpus ?? selectedEndpointData?.totalCpu ?? null;
    const convention = 'Docker stats convention: 100% = one full CPU core.';
    return cores
      ? `${convention} ${cores} core${cores === 1 ? '' : 's'} online, so this axis reaches ${cores * 100}%.`
      : `${convention} On a multi-core host the axis can exceed 100%.`;
  }, [containerMeta, selectedEndpointData]);

  const memoryAxisNote = useMemo(() => {
    const resolved = resolveMemoryLimit(
      containerMeta?.memoryLimitBytes,
      selectedEndpointData?.totalMemory,
    );
    const formula = 'Memory % = (usage − cache) ÷ limit.';
    if (resolved == null) return formula;
    return resolved.isHostTotal
      ? `${formula} No limit set, so the denominator is the host's ${formatMemSize(resolved.limit)} of RAM.`
      : `${formula} Limit: ${formatMemSize(resolved.limit)}.`;
  }, [containerMeta, selectedEndpointData]);

  const rankedForecasts = useMemo<RankedForecast[]>(() => {
    const forecasts = forecastOverviewQuery.data ?? [];
    return [...forecasts]
      .sort((a, b) => getForecastRiskScore(b) - getForecastRiskScore(a))
      .map((forecast, index) => ({ ...forecast, rank: index + 1 }));
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

  const allForecastsHealthy =
    rankedForecasts.length > 0 && riskBuckets.critical === 0 && riskBuckets.warning === 0;

  // State the basis of the ordering rather than letting "Rank 1" imply a
  // projected breach. With no `timeToThreshold` anywhere, `getForecastRiskScore`
  // falls back to trend bucket plus current value — which is how a container
  // sitting at 19.5% memory ended up ranked first.
  const forecastRankBasisNote = useMemo(() => {
    if (rankedForecasts.length === 0) return null;
    if (rankedForecasts.every((forecast) => !hasReportableEta(forecast))) {
      return 'No series has a projected breach time the fit supports, so rank orders by trend, then by current value.';
    }
    const weak = rankedForecasts.filter(
      (forecast) => forecast.timeToThreshold !== null && !hasReportableEta(forecast),
    ).length;
    return weak > 0
      ? `${weak} projected breach${weak === 1 ? '' : 'es'} came from a low-confidence fit and are ranked as unprojected.`
      : null;
  }, [rankedForecasts]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setShowSecondaryPanels(true), 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

  // Open on something. This page's subject is one container's series, and it
  // opened on an empty state behind two dropdowns — the first of which, in a
  // one-endpoint fleet, has exactly one answer. Runs once, and only while the
  // operator has not already chosen.
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (autoSelectedRef.current) return;
    if (!endpoints || !allContainers) return;
    if (selectedEndpoint !== null) {
      autoSelectedRef.current = true;
      return;
    }
    autoSelectedRef.current = true;

    const last = readLastSelection();
    const restored = last
      ? allContainers.find((c) => c.id === last.containerId && c.endpointId === last.endpointId)
      : undefined;
    if (restored && endpoints.some((ep) => ep.id === restored.endpointId)) {
      setSelectedEndpoint(restored.endpointId);
      setSelectedContainer(restored.id);
      return;
    }
    if (endpoints.length === 1) {
      setSelectedEndpoint(endpoints[0].id);
    }
  }, [endpoints, allContainers, selectedEndpoint]);

  useEffect(() => {
    if (selectedEndpoint === null || !selectedContainer) return;
    writeLastSelection({ endpointId: selectedEndpoint, containerId: selectedContainer });
  }, [selectedEndpoint, selectedContainer]);

  // Handle endpoint change
  const handleEndpointChange = (endpointId: number) => {
    setSelectedEndpoint(endpointId);
    setSelectedStack(null);
    setSelectedContainer(null);
    setContainerQuery('');
  };

  // Manual refresh and a scheduled tick do the same work — a "Refresh" that
  // reloaded only the container list while the charts stayed put would be the
  // same broken promise the dropdown used to make.
  const handleRefresh = handleTick;

  const drillIntoForecast = useCallback((containerId: string) => {
    const match = allContainers?.find((container) => container.id === containerId);
    if (match) {
      setSelectedEndpoint(match.endpointId);
      setSelectedContainer(match.id);
    }
  }, [allContainers]);

  const forecastColumns = useMemo<ColumnDef<RankedForecast, unknown>[]>(() => [
    {
      accessorKey: 'rank',
      header: 'Rank',
      cell: ({ getValue }) => <span className="text-muted-foreground">{getValue<number>()}</span>,
    },
    {
      accessorKey: 'containerName',
      header: 'Container',
      cell: ({ getValue }) => <span className="font-medium">{getValue<string>()}</span>,
    },
    {
      accessorKey: 'metricType',
      header: 'Metric',
      cell: ({ getValue }) => <span className="uppercase text-xs">{getValue<string>()}</span>,
    },
    {
      accessorKey: 'currentValue',
      header: 'Current',
      cell: ({ getValue }) => `${getValue<number>().toFixed(1)}%`,
    },
    {
      accessorKey: 'trend',
      header: 'Trend',
      cell: ({ getValue }) => <span className="capitalize">{getValue<string>()}</span>,
    },
    {
      accessorKey: 'timeToThreshold',
      header: 'Threshold ETA',
      cell: ({ row }) => {
        // A low-confidence fit produces an ETA the data does not support —
        // the fleet's top-ranked risk was a container at 0.0% CPU projected
        // to breach in an hour. Say the fit is too weak rather than printing
        // an hour count, and never say "no breach predicted" when the truth
        // is that nothing could be predicted at all.
        if (row.original.timeToThreshold === null) return 'No breach predicted';
        if (!hasReportableEta(row.original)) {
          return <span className="text-muted-foreground">Fit too weak to project</span>;
        }
        return `~${row.original.timeToThreshold}h`;
      },
    },
    {
      accessorKey: 'confidence',
      header: 'Confidence',
      cell: ({ row }) => (
        <span
          className="capitalize text-muted-foreground"
          title={`R² = ${row.original.r_squared.toFixed(2)} · slope = ${row.original.slope.toFixed(3)}/h`}
        >
          {row.original.confidence}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      enableSorting: false,
      cell: ({ row }) => {
        const riskLevel = getForecastRiskLevel(row.original);
        return (
          <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize', RISK_BADGE_STYLES[riskLevel])}>
            {riskLevel}
          </span>
        );
      },
    },
    {
      id: 'action',
      header: () => <span className="block text-right">Action</span>,
      enableSorting: false,
      cell: ({ row }) => (
        <div className="text-right">
          <button
            type="button"
            onClick={() => drillIntoForecast(row.original.containerId)}
            className="rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium hover:bg-accent"
          >
            View Details
          </button>
        </div>
      ),
    },
  ], [drillIntoForecast]);

  // Treat both isLoading and isPending-without-data as "loading" to avoid
  // rendering a blank page during SPA navigation before data arrives.
  const isLoading = endpointsLoading || containersLoading || (endpointsPending && !endpoints) || (containersPending && !allContainers);
  const hasSelection = selectedEndpoint && selectedContainer;
  const metricsLoading = cpuLoading || memoryLoading || memoryBytesLoading;
  const allMetricsEmpty = !metricsLoading && hasSelection
    && cpuData.length === 0 && memoryData.length === 0 && memoryBytesData.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Metrics Dashboard"
        subtitle="CPU/memory time series with anomaly detection"
        actions={
          <>
            {hasSelection && llmAvailable && (
              <button
                onClick={() => setChatOpen(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition-all hover:shadow-md"
              >
                <Bot className="h-4 w-4" />
                Ask AI
              </button>
            )}
            <DataFreshness lastUpdated={lastUpdated} onRefresh={handleRefresh} />
            <RefreshControls interval={interval} onIntervalChange={setRefreshInterval} onRefresh={handleRefresh} isLoading={isFetching} />
          </>
        }
      />

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

        {/* Stack Selector */}
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
              setContainerQuery('');
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

        {/* Container Selector + its own filter.
            The filter used to be a full-width, card-backed search pill sitting
            above this select — wider and higher contrast than the control it
            narrows, and easily read as a page-wide search when it only ever
            filtered this dropdown's options. It is now a compact field attached
            to the select, sized and styled to match it. */}
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
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={containerQuery}
              onChange={(event) => setContainerQuery(event.target.value)}
              placeholder="Filter"
              aria-label="Search containers"
              disabled={!selectedEndpoint || containersLoading}
              className={cn(
                'h-9 w-28 rounded-md border border-input bg-background pl-7 pr-2 text-[16px] sm:text-sm shadow-xs',
                'placeholder:text-muted-foreground/70',
                'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            />
          </div>
          {containerQuery.trim() !== '' && (
            <span className="text-xs text-muted-foreground" data-testid="container-filter-count">
              {searchedContainers.length} of {filteredContainers.length}
            </span>
          )}
        </div>

        {/* Time Range Selector — the only zoom a time series has. A separate
            magnifier pair used to sit at the end of this row scaling the chart's
            pixel height; it promised a time-window change this control already
            makes, so it is gone rather than relabelled. */}
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
      </div>

      {hasSelection && (
        <SpotlightCard>
        <div className="rounded-lg border bg-card p-6 shadow-sm">
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
            <EmptyState
              icon={Network}
              title="No connected networks found"
              description="Select a different container or check container network attachments."
            />
          ) : (
            <div className="space-y-3">
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={networkTrafficData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                    <XAxis dataKey="network" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => formatBytes(Number(value))} />
                    <Tooltip
                      cursor={{ fill: 'transparent' }}
                      content={
                        <NetworkTrafficTooltip
                          formatValue={(value) => `${formatBytes(value)} MB/s`}
                        />
                      }
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
        </SpotlightCard>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="space-y-4">
          <SkeletonChart size="lg" />
          <SkeletonChart size="lg" />
        </div>
      )}

      {/* No Selection State */}
      {!isLoading && !hasSelection && (
        <EmptyState
          icon={Server}
          title="Select a container"
          description="Choose an endpoint and container to view metrics."
        />
      )}

      {/* Metrics Content */}
      {hasSelection && (
        <>
          {/* Container Info & Stats */}
          {selectedContainerData && (
            <div className="grid gap-4 md:grid-cols-3" data-testid="metrics-kpi-grid">
              <SpotlightCard>
                <div className="rounded-lg border bg-card p-6 shadow-sm">
                  <p className="text-sm font-medium text-muted-foreground">Avg CPU</p>
                  <p className="mt-2 text-3xl font-bold tracking-tight">{stats.cpu.avg.toFixed(1)}%</p>
                  {cpuCoresLabel && (
                    <p className="text-xs text-muted-foreground mt-1">{cpuCoresLabel}</p>
                  )}
                  <AnomalySparkline
                    values={cpuData.map((d) => d.value)}
                    anomalyIndices={cpuAnomalyIndices}
                    className="mt-2"
                  />
                </div>
              </SpotlightCard>
              <SpotlightCard>
                <div className="rounded-lg border bg-card p-6 shadow-sm">
                  <p className="text-sm font-medium text-muted-foreground">Avg Memory</p>
                  <p className="mt-2 text-3xl font-bold tracking-tight">{stats.memory.avg.toFixed(1)}%</p>
                  {memoryDenominatorLabel && (
                    <p className="text-xs text-muted-foreground mt-1">{memoryDenominatorLabel}</p>
                  )}
                  <AnomalySparkline
                    values={memoryData.map((d) => d.value)}
                    anomalyIndices={memoryAnomalyIndices}
                    className="mt-2"
                  />
                </div>
              </SpotlightCard>
              <SpotlightCard>
                <div className="rounded-lg border bg-card p-6 shadow-sm">
                  <p className="text-sm font-medium text-muted-foreground">Peak Memory</p>
                  <p className="mt-2 text-3xl font-bold tracking-tight">{stats.memoryBytes.max.toFixed(1)} MB</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Min: {stats.memoryBytes.min.toFixed(1)} MB
                  </p>
                </div>
              </SpotlightCard>
            </div>
          )}

          {/* AI Summary */}
          {showSecondaryPanels ? (
            <Suspense fallback={<SkeletonText lines={2} />}>
              <LazyAiMetricsSummary
                endpointId={selectedEndpoint ?? undefined}
                containerId={selectedContainer ?? undefined}
                timeRange={timeRange}
              />
            </Suspense>
          ) : (
            <SkeletonText lines={2} />
          )}

          {/* Charts */}
          {metricsLoading ? (
            <div className="space-y-4">
              <SkeletonChart size="lg" />
              <SkeletonChart size="lg" />
            </div>
          ) : allMetricsEmpty ? (
            <EmptyState
              icon={Clock}
              title="No metrics data available"
              description="No metrics have been recorded for this container in the selected time range. Containers record metrics every 60 seconds — try a wider time range or wait for collection."
            />
          ) : (
            <div className="grid gap-6 lg:grid-cols-2" data-testid="metrics-charts-grid">
              {/* CPU Chart */}
              <SpotlightCard>
              <div className="rounded-lg border bg-card p-6 shadow-sm">
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
                  height={300}
                  anomalyExplanations={cpuExplanations}
                />
                <p className="mt-2 text-xs text-muted-foreground" data-testid="cpu-axis-note">
                  {cpuAxisNote}
                </p>
                {cpuError && (
                  <div className="mt-4 flex items-center gap-2 text-sm text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                    Failed to load CPU metrics
                  </div>
                )}
              </div>
              </SpotlightCard>

              {/* Memory Chart */}
              <SpotlightCard>
              <div className="rounded-lg border bg-card p-6 shadow-sm">
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
                  height={300}
                  anomalyExplanations={memoryExplanations}
                />
                <p className="mt-2 text-xs text-muted-foreground" data-testid="memory-axis-note">
                  {memoryAxisNote}
                </p>
                {memoryError && (
                  <div className="mt-4 flex items-center gap-2 text-sm text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                    Failed to load memory metrics
                  </div>
                )}
              </div>
              </SpotlightCard>

              {/* Memory Bytes Chart */}
              <SpotlightCard>
              <div className="rounded-lg border bg-card p-6 shadow-sm">
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
                  height={300}
                />
                <p className="mt-2 text-xs text-muted-foreground" data-testid="memory-bytes-axis-note">
                  Resident memory in MB — the numerator of the percentage beside it.
                </p>
              </div>
              </SpotlightCard>
            </div>
          )}

          {/* Capacity Forecasts */}
          <div className="space-y-6">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-indigo-500" />
              {/* Same horizon as the fleet-wide section below, so it is named
                  the same way; scope is what differs and scope is what the
                  headings now carry. */}
              <h3 className="text-lg font-semibold">Capacity Forecast — This Container (Next 24h)</h3>
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
              <EmptyState
                variant="not-configured"
                icon={Clock}
                title="Collecting metrics data"
                description="Capacity forecasts require at least 5 minutes of metrics history. For higher confidence predictions, keep the container running for 20+ minutes."
              />
            )}
          </div>

          {/* Anomaly Summary */}
          {anomaliesData && (
            <SpotlightCard>
            <div className="rounded-lg border bg-card p-6 shadow-sm">
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
            </SpotlightCard>
          )}
        </>
      )}

      {/* Cross-Container Correlation Insights */}
      {showSecondaryPanels ? (
        <Suspense fallback={<SkeletonChart size="md" />}>
          <LazyCorrelationInsightsPanel llmAvailable={llmAvailable} hours={24} selectedContainerId={selectedContainer} />
        </Suspense>
      ) : (
        <SkeletonChart size="md" />
      )}

      {/* Forecast Overview */}
      <SpotlightCard>
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Capacity Forecast — Fleet (Next 24h)</h2>
            <p className="text-sm text-muted-foreground">
              Risk-ranked capacity outlook across containers.
            </p>
          </div>
          {/* Zero buckets are not news. The row used to read
              "Critical: 0  Warning: 0  Healthy: 20" above a table whose every
              row said the same thing. */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {riskBuckets.critical > 0 && (
              <span className="rounded-full bg-red-100 px-2.5 py-1 font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                Critical: {riskBuckets.critical}
              </span>
            )}
            {riskBuckets.warning > 0 && (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                Warning: {riskBuckets.warning}
              </span>
            )}
            {riskBuckets.healthy > 0 && (
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                Healthy: {riskBuckets.healthy}
              </span>
            )}
          </div>
        </div>

        {forecastOverviewQuery.isLoading ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <tbody>
                <SkeletonTableRow columns={8} />
                <SkeletonTableRow columns={8} />
                <SkeletonTableRow columns={8} />
              </tbody>
            </table>
          </div>
        ) : forecastOverviewQuery.error ? (
          <EmptyState
            variant="error"
            icon={AlertTriangle}
            title="Failed to load forecast overview"
            description={forecastOverviewQuery.error instanceof Error ? forecastOverviewQuery.error.message : 'Try again in a moment.'}
          />
        ) : rankedForecasts.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="No forecast data available"
            description="Keep metrics collection running to build cross-container forecast insights."
          />
        ) : allForecastsHealthy ? (
          /* One sentence, because that is the entire content. This was eight
             columns and two pages of pagination whose every row read
             "No breach predicted / healthy" — the table is still one click
             away, and it comes back automatically the moment a row is not
             healthy. */
          <div className="mt-4" data-testid="forecast-overview-all-clear">
            <div className="flex items-start gap-2 text-sm">
              <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
              <p>
                No capacity breaches projected in the next 24h
                {' '}
                <span className="text-muted-foreground">
                  ({rankedForecasts.length} container/metric series checked)
                </span>
              </p>
            </div>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                Show all {rankedForecasts.length} series
              </summary>
              <div className="mt-3">
                {forecastRankBasisNote && (
                  <p className="mb-2 text-xs text-muted-foreground">{forecastRankBasisNote}</p>
                )}
                <DataTable
                  columns={forecastColumns}
                  data={rankedForecasts}
                  getRowId={(forecast) => `${forecast.containerId}-${forecast.metricType}`}
                  hideSearch
                  minTableWidth={880}
                />
              </div>
            </details>
          </div>
        ) : (
          <div className="mt-4">
            {forecastRankBasisNote && (
              <p className="mb-2 text-xs text-muted-foreground">{forecastRankBasisNote}</p>
            )}
            <DataTable
              columns={forecastColumns}
              data={rankedForecasts}
              getRowId={(forecast) => `${forecast.containerId}-${forecast.metricType}`}
              hideSearch
              minTableWidth={880}
            />
          </div>
        )}
      </div>
      </SpotlightCard>

      {/* Inline Chat Panel — mounted only when open so the markdown/highlight
          chunk is fetched on first use. Fallback is null: the panel is a fixed
          overlay that renders null while closed, so nothing should flash. */}
      {selectedContainerData && selectedEndpoint && chatOpen && (
        <Suspense fallback={null}>
        <LazyInlineChatPanel
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
        </Suspense>
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
    <SpotlightCard>
    <div className="rounded-lg border bg-card p-6 shadow-sm">
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
              formatter={(value, name) => {
                const numericValue = typeof value === 'number' ? value : Number(value ?? 0);
                const seriesName = typeof name === 'string' ? name : String(name ?? '');
                return [
                  `${numericValue}${unit}`,
                  seriesName === 'projected' ? `${label} (projected)` : label,
                ];
              }}
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
    </SpotlightCard>
  );
}
