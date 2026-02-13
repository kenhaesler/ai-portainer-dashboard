import { useMemo, useState } from 'react';
import { Cpu, HardDrive, Network } from 'lucide-react';
import { SpotlightCard } from '@/components/shared/spotlight-card';
import { useContainerMetrics, useNetworkRates } from '@/hooks/use-metrics';
import { ThemedSelect } from '@/components/shared/themed-select';
import { MetricsLineChart } from '@/components/charts/metrics-line-chart';
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

interface ContainerMetricsViewerProps {
  endpointId: number;
  containerId: string;
  containerNetworks?: string[];
  showTimeRangeSelector?: boolean;
  timeRange?: string;
  onTimeRangeChange?: (timeRange: string) => void;
}

export function ContainerMetricsViewer({
  endpointId,
  containerId,
  containerNetworks = [],
  showTimeRangeSelector = true,
  timeRange: controlledTimeRange,
  onTimeRangeChange,
}: ContainerMetricsViewerProps) {
  const [localTimeRange, setLocalTimeRange] = useState<string>('1h');
  const timeRange = controlledTimeRange ?? localTimeRange;

  const handleTimeRangeChange = (value: string) => {
    if (controlledTimeRange === undefined) {
      setLocalTimeRange(value);
    }
    onTimeRangeChange?.(value);
  };

  // Fetch metrics for selected container
  const {
    data: cpuMetrics,
    isLoading: cpuLoading
  } = useContainerMetrics(
    endpointId,
    containerId,
    'cpu',
    timeRange
  );

  const {
    data: memoryMetrics,
    isLoading: memoryLoading
  } = useContainerMetrics(
    endpointId,
    containerId,
    'memory',
    timeRange
  );
  const { data: networkRatesData, isLoading: networkRatesLoading } = useNetworkRates(endpointId);

  const networkTrafficData = useMemo(() => {
    if (!containerNetworks.length) return [];

    const rate = networkRatesData?.rates?.[containerId];
    const split = containerNetworks.length;
    const perNetworkRx = split > 0 ? (rate?.rxBytesPerSec ?? 0) / split : 0;
    const perNetworkTx = split > 0 ? (rate?.txBytesPerSec ?? 0) / split : 0;

    return containerNetworks
      .map((networkName) => ({
        network: networkName,
        rx: perNetworkRx,
        tx: perNetworkTx,
        total: perNetworkRx + perNetworkTx,
      }))
      .sort((a, b) => b.total - a.total);
  }, [containerId, containerNetworks, networkRatesData]);

  return (
    <div className="space-y-6">
      {/* Time Range Selector */}
      {showTimeRangeSelector && (
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">
            Time Range
          </label>
          <ThemedSelect
            value={timeRange}
            onValueChange={handleTimeRangeChange}
            options={[
              { value: '15m', label: 'Last 15 minutes' },
              { value: '30m', label: 'Last 30 minutes' },
              { value: '1h', label: 'Last 1 hour' },
              { value: '6h', label: 'Last 6 hours' },
              { value: '24h', label: 'Last 24 hours' },
              { value: '7d', label: 'Last 7 days' },
            ]}
          />
        </div>
      )}

      {/* Metrics Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* CPU Chart */}
        <SpotlightCard className="rounded-lg border bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Cpu className="h-5 w-5 text-blue-500" />
            <h3 className="text-lg font-semibold">CPU Usage</h3>
          </div>
          {cpuLoading ? (
            <div className="flex h-[300px] items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          ) : (
            <MetricsLineChart
              data={cpuMetrics?.data ?? []}
              label="CPU"
              color="#3b82f6"
              unit="%"
            />
          )}
        </SpotlightCard>

        {/* Memory Chart */}
        <SpotlightCard className="rounded-lg border bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <HardDrive className="h-5 w-5 text-emerald-500" />
            <h3 className="text-lg font-semibold">Memory Usage</h3>
          </div>
          {memoryLoading ? (
            <div className="flex h-[300px] items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          ) : (
            <MetricsLineChart
              data={memoryMetrics?.data ?? []}
              label="Memory"
              color="#10b981"
              unit="%"
            />
          )}
        </SpotlightCard>
      </div>

      <SpotlightCard className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Network className="h-5 w-5 text-cyan-500" />
          <h3 className="text-lg font-semibold">Network RX/TX by Network</h3>
        </div>
        {!containerNetworks.length ? (
          <div className="flex h-[300px] items-center justify-center rounded-lg border border-dashed bg-muted/20 p-6 text-center">
            <div>
              <p className="font-medium">No connected networks found for this container</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Attach the container to a network to see RX/TX distribution.
              </p>
            </div>
          </div>
        ) : networkRatesLoading ? (
          <div className="flex h-[300px] items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={networkTrafficData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                  <XAxis dataKey="network" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(value) => `${(Number(value) / (1024 * 1024)).toFixed(2)}`} />
                  <Tooltip
                    formatter={(value: number, key: string) => [
                      `${(value / (1024 * 1024)).toFixed(2)} MB/s`,
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
                Per-network values are estimated (evenly split)
              </span>
            </div>
          </div>
        )}
      </SpotlightCard>
    </div>
  );
}
