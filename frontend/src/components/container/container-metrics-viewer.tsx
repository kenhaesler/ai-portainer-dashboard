import { useState } from 'react';
import { Cpu, HardDrive } from 'lucide-react';
import { useContainerMetrics } from '@/hooks/use-metrics';
import { MetricsLineChart } from '@/components/charts/metrics-line-chart';

interface ContainerMetricsViewerProps {
  endpointId: number;
  containerId: string;
  showTimeRangeSelector?: boolean;
}

export function ContainerMetricsViewer({
  endpointId,
  containerId,
  showTimeRangeSelector = true,
}: ContainerMetricsViewerProps) {
  const [timeRange, setTimeRange] = useState<string>('1h');

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

  return (
    <div className="space-y-6">
      {/* Time Range Selector */}
      {showTimeRangeSelector && (
        <div className="flex items-center gap-2">
          <label htmlFor="time-range" className="text-sm font-medium">
            Time Range
          </label>
          <select
            id="time-range"
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="15m">Last 15 minutes</option>
            <option value="1h">Last 1 hour</option>
            <option value="6h">Last 6 hours</option>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
          </select>
        </div>
      )}

      {/* Metrics Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* CPU Chart */}
        <div className="rounded-lg border bg-card p-6 shadow-sm">
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
        </div>

        {/* Memory Chart */}
        <div className="rounded-lg border bg-card p-6 shadow-sm">
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
        </div>
      </div>
    </div>
  );
}
