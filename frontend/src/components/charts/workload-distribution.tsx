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

const COLORS = {
  running: '#00f5d4',
  stopped: '#ff6b6b',
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload) return null;

  const total = payload.reduce((sum: number, entry: any) => sum + entry.value, 0);

  return (
    <div className="rounded-lg bg-black/80 backdrop-blur-md border border-white/10 px-3 py-2 shadow-2xl">
      <p className="text-[10px] uppercase tracking-wider text-white/60 mb-2">{label}</p>
      <div className="text-xs text-white/50 mb-1.5">
        Total: <span className="font-medium text-white">{total}</span>
      </div>
      {payload.map((entry: any) => (
        <div key={entry.name} className="flex items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-2">
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: entry.fill, boxShadow: `0 0 6px ${entry.fill}` }}
            />
            <span className="text-white/70">{entry.name}</span>
          </div>
          <span className="font-medium tabular-nums" style={{ color: entry.fill }}>{entry.value}</span>
        </div>
      ))}
    </div>
  );
};

export function WorkloadDistribution({ data }: WorkloadDistributionProps) {
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
  }));

  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={240}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
        >
          <defs>
            <linearGradient id="workloadNeonRunning" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={COLORS.running} stopOpacity={0.6} />
              <stop offset="100%" stopColor={COLORS.running} stopOpacity={1} />
            </linearGradient>
            <linearGradient id="workloadNeonStopped" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={COLORS.stopped} stopOpacity={0.6} />
              <stop offset="100%" stopColor={COLORS.stopped} stopOpacity={1} />
            </linearGradient>
            <filter id="horizontalBarGlow">
              <feGaussianBlur stdDeviation="2" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <XAxis
            type="number"
            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="displayName"
            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            axisLine={false}
            tickLine={false}
            width={90}
          />
          <Tooltip content={<CustomTooltip />} cursor={false} />
          <Bar
            dataKey="running"
            name="Running"
            fill="url(#workloadNeonRunning)"
            stackId="a"
            radius={[0, 0, 0, 0]}
            style={{ filter: 'url(#horizontalBarGlow)' }}
          />
          <Bar
            dataKey="stopped"
            name="Stopped"
            fill="url(#workloadNeonStopped)"
            stackId="a"
            radius={[0, 3, 3, 0]}
          />
        </BarChart>
      </ResponsiveContainer>

      {/* Futuristic legend */}
      <div className="flex justify-center gap-6">
        {Object.entries({ Running: COLORS.running, Stopped: COLORS.stopped }).map(([name, color]) => (
          <div key={name} className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }}
            />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
