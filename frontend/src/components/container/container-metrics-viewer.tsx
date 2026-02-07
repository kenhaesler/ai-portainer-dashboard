import { useState } from 'react';
import { Cpu, HardDrive } from 'lucide-react';
import { useContainerMetrics } from '@/hooks/use-metrics';
import { ThemedSelect } from '@/components/shared/themed-select';
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
          <label className="text-sm font-medium">
            Time Range
          </label>
          <ThemedSelect
            value={timeRange}
            onValueChange={(val) => setTimeRange(val)}
            options={[
              { value: '15m', label: 'Last 15 minutes' },
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
