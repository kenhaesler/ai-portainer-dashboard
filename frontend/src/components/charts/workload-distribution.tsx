import { memo } from 'react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';

export interface WorkloadData {
  endpoint: string;
  containers: number;
  running: number;
  stopped: number;
}

interface WorkloadDistributionProps {
  data: WorkloadData[];
}

export function prepareWorkloadChartData(data: WorkloadData[]) {
  return data
    .map((entry) => ({
      ...entry,
      displayName: entry.endpoint.length > 16 ? `${entry.endpoint.slice(0, 16)}…` : entry.endpoint,
      total: entry.running + entry.stopped,
    }))
    .sort((a, b) => b.total - a.total);
}

export function prepareWorkloadAggregate(data: WorkloadData[]) {
  const endpoints = data.length;
  const totalRunning = data.reduce((sum, item) => sum + item.running, 0);
  const totalStopped = data.reduce((sum, item) => sum + item.stopped, 0);
  const totalContainers = totalRunning + totalStopped;
  const runningPct = totalContainers > 0 ? Math.round((totalRunning / totalContainers) * 100) : 0;
  const stoppedPct = totalContainers > 0 ? 100 - runningPct : 0;

  const topContributors = prepareWorkloadChartData(data)
    .slice(0, 3)
    .map((item) => ({
      endpoint: item.endpoint,
      total: item.total,
      share: totalContainers > 0 ? Math.round((item.total / totalContainers) * 100) : 0,
    }));

  return {
    endpoints,
    totalRunning,
    totalStopped,
    totalContainers,
    runningPct,
    stoppedPct,
    topContributors,
  };
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload) return null;

  const total = payload.reduce((sum: number, entry: any) => sum + (entry.value ?? 0), 0);

  return (
    <div className="rounded-xl bg-popover/95 backdrop-blur-sm border border-border px-3 py-2 shadow-lg">
      <p className="text-xs font-medium mb-1.5 text-foreground">{label}</p>
      {payload.map((entry: any) => (
        <div key={entry.name} className="flex items-center gap-2 text-xs">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: entry.fill }}
          />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-medium">{entry.value}</span>
        </div>
      ))}
      <div className="mt-1.5 border-t border-border pt-1.5 text-xs">
        <span className="text-muted-foreground">Total:</span>{' '}
        <span className="font-medium text-foreground">{total}</span>
      </div>
    </div>
  );
};

export const WorkloadDistribution = memo(function WorkloadDistribution({ data }: WorkloadDistributionProps) {
  if (!data.length) {
    return (
      <div className="flex h-[300px] items-center justify-center text-muted-foreground">
        No workload data
      </div>
    );
  }

  const chartData = prepareWorkloadChartData(data);
  const aggregate = prepareWorkloadAggregate(data);

  const rowHeight = 38;
  const chartHeight = Math.max(220, chartData.length * rowHeight + 8);

  return (
    <div className="w-full space-y-3">
      <div className="rounded-xl border border-border/60 bg-background/35 p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-border/60 bg-background/60 px-2 py-1 text-[11px] text-muted-foreground">
            {aggregate.endpoints} endpoints
          </span>
          <span className="rounded-full border border-border/60 bg-background/60 px-2 py-1 text-[11px] text-muted-foreground">
            {aggregate.totalContainers} containers
          </span>
          <span className="rounded-full border border-emerald-300/30 bg-emerald-400/10 px-2 py-1 text-[11px] text-emerald-300">
            {aggregate.runningPct}% running
          </span>
          <span className="rounded-full border border-red-300/30 bg-red-400/10 px-2 py-1 text-[11px] text-red-300">
            {aggregate.stoppedPct}% stopped
          </span>
        </div>

        <div className="flex h-3 overflow-hidden rounded-full bg-muted/50">
          <div
            className="h-full rounded-l-full bg-gradient-to-r from-emerald-300 to-emerald-400"
            style={{ width: `${aggregate.runningPct}%` }}
          />
          <div
            className="h-full rounded-r-full bg-gradient-to-r from-red-300 to-red-400"
            style={{ width: `${aggregate.stoppedPct}%` }}
          />
        </div>

        {aggregate.topContributors.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {aggregate.topContributors.map((item) => (
              <div key={item.endpoint} className="flex items-center gap-2 text-[11px]">
                <span className="w-[90px] truncate text-muted-foreground">{item.endpoint}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted/50">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-blue-400"
                    style={{ width: `${Math.max(6, item.share)}%` }}
                  />
                </div>
                <span className="w-10 text-right text-muted-foreground">{item.share}%</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="max-h-[252px] overflow-y-auto pr-2">
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 4, right: 14, left: 6, bottom: 4 }}
            barCategoryGap={10}
          >
            <defs>
              <linearGradient id="workloadGradientRunning" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#6ee7b7" />
                <stop offset="100%" stopColor="#34d399" />
              </linearGradient>
              <linearGradient id="workloadGradientStopped" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#fca5a5" />
                <stop offset="100%" stopColor="#f87171" />
              </linearGradient>
            </defs>

            <XAxis
              type="number"
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <YAxis
              type="category"
              dataKey="displayName"
              tick={{ fontSize: 11, fill: 'hsl(var(--foreground) / 0.9)' }}
              axisLine={false}
              tickLine={false}
              width={138}
              tickMargin={8}
            />
            <Tooltip content={<CustomTooltip />} cursor={false} />
            <Bar
              dataKey="running"
              name="Running"
              fill="url(#workloadGradientRunning)"
              stackId="a"
              radius={[8, 0, 0, 8]}
              minPointSize={3}
              barSize={16}
            />
            <Bar
              dataKey="stopped"
              name="Stopped"
              fill="url(#workloadGradientStopped)"
              stackId="a"
              radius={[0, 8, 8, 0]}
              minPointSize={3}
              barSize={16}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Clean legend */}
      <div className="flex justify-center gap-5">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-gradient-to-r from-emerald-300 to-emerald-400" />
          <span className="text-xs text-muted-foreground">Running</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-gradient-to-r from-red-300 to-red-400" />
          <span className="text-xs text-muted-foreground">Stopped</span>
        </div>
      </div>
    </div>
  );
});
