import { memo } from 'react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';

interface WorkloadData {
  endpoint: string;
  containers: number;
  running: number;
  stopped: number;
}

interface WorkloadDistributionProps {
  data: WorkloadData[];
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload) return null;

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

  const chartData = data.map(d => ({
    ...d,
    displayName: d.endpoint.length > 12 ? d.endpoint.slice(0, 12) + '…' : d.endpoint,
    total: d.running + d.stopped,
  }));

  return (
    <div className="space-y-3">
      <ResponsiveContainer width="100%" height={240}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
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
          />
          <YAxis
            type="category"
            dataKey="displayName"
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            axisLine={false}
            tickLine={false}
            width={90}
          />
          <Tooltip content={<CustomTooltip />} cursor={false} />
          <Bar
            dataKey="running"
            name="Running"
            fill="url(#workloadGradientRunning)"
            stackId="a"
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="stopped"
            name="Stopped"
            fill="url(#workloadGradientStopped)"
            stackId="a"
            radius={[0, 4, 4, 0]}
          />
        </BarChart>
      </ResponsiveContainer>

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
