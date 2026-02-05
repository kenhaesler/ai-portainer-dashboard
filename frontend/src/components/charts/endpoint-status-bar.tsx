import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';

interface EndpointData {
  name: string;
  running: number;
  stopped: number;
  unhealthy: number;
}

interface EndpointStatusBarProps {
  data: EndpointData[];
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

export function EndpointStatusBar({ data }: EndpointStatusBarProps) {
  if (!data.length) {
    return (
      <div className="flex h-[300px] items-center justify-center text-muted-foreground">
        No endpoint data
      </div>
    );
  }

  // Truncate endpoint names for display
  const chartData = data.map(d => ({
    ...d,
    displayName: d.name.length > 15 ? d.name.slice(0, 15) + '…' : d.name,
  }));

  return (
    <div className="space-y-3">
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id="barGradientRunning" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" />
              <stop offset="100%" stopColor="#10b981" />
            </linearGradient>
            <linearGradient id="barGradientStopped" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f87171" />
              <stop offset="100%" stopColor="#ef4444" />
            </linearGradient>
            <linearGradient id="barGradientUnhealthy" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fbbf24" />
              <stop offset="100%" stopColor="#f59e0b" />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="displayName"
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
            axisLine={false}
            tickLine={false}
            width={30}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.3 }} />
          <Bar
            dataKey="running"
            name="Running"
            fill="url(#barGradientRunning)"
            stackId="a"
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="stopped"
            name="Stopped"
            fill="url(#barGradientStopped)"
            stackId="a"
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="unhealthy"
            name="Unhealthy"
            fill="url(#barGradientUnhealthy)"
            stackId="a"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>

      {/* Custom legend */}
      <div className="flex justify-center gap-4">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-gradient-to-b from-emerald-400 to-emerald-500" />
          <span className="text-xs text-muted-foreground">Running</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-gradient-to-b from-red-400 to-red-500" />
          <span className="text-xs text-muted-foreground">Stopped</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-gradient-to-b from-amber-400 to-amber-500" />
          <span className="text-xs text-muted-foreground">Unhealthy</span>
        </div>
      </div>
    </div>
  );
}
