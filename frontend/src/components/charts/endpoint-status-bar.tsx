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

const COLORS = {
  running: { main: '#00f5d4', glow: '#00f5d4' },
  stopped: { main: '#ff6b6b', glow: '#ff6b6b' },
  unhealthy: { main: '#ffd93d', glow: '#ffd93d' },
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload) return null;

  return (
    <div className="rounded-lg bg-black/80 backdrop-blur-md border border-white/10 px-3 py-2 shadow-2xl">
      <p className="text-[10px] uppercase tracking-wider text-white/60 mb-2">{label}</p>
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

export function EndpointStatusBar({ data }: EndpointStatusBarProps) {
  if (!data.length) {
    return (
      <div className="flex h-[300px] items-center justify-center text-muted-foreground">
        No endpoint data
      </div>
    );
  }

  const chartData = data.map(d => ({
    ...d,
    displayName: d.name.length > 15 ? d.name.slice(0, 15) + '…' : d.name,
  }));

  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={chartData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
          <defs>
            <linearGradient id="neonRunning" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.running.main} stopOpacity={1} />
              <stop offset="100%" stopColor={COLORS.running.main} stopOpacity={0.6} />
            </linearGradient>
            <linearGradient id="neonStopped" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.stopped.main} stopOpacity={1} />
              <stop offset="100%" stopColor={COLORS.stopped.main} stopOpacity={0.6} />
            </linearGradient>
            <linearGradient id="neonUnhealthy" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.unhealthy.main} stopOpacity={1} />
              <stop offset="100%" stopColor={COLORS.unhealthy.main} stopOpacity={0.6} />
            </linearGradient>
            <filter id="barGlow">
              <feGaussianBlur stdDeviation="2" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <XAxis
            dataKey="displayName"
            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            axisLine={false}
            tickLine={false}
            width={30}
          />
          <Tooltip content={<CustomTooltip />} cursor={false} />
          <Bar
            dataKey="running"
            name="Running"
            fill="url(#neonRunning)"
            stackId="a"
            radius={[0, 0, 0, 0]}
            style={{ filter: 'url(#barGlow)' }}
          />
          <Bar
            dataKey="stopped"
            name="Stopped"
            fill="url(#neonStopped)"
            stackId="a"
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="unhealthy"
            name="Unhealthy"
            fill="url(#neonUnhealthy)"
            stackId="a"
            radius={[3, 3, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>

      {/* Futuristic legend */}
      <div className="flex justify-center gap-6">
        {Object.entries({ Running: COLORS.running, Stopped: COLORS.stopped, Unhealthy: COLORS.unhealthy }).map(([name, colors]) => (
          <div key={name} className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: colors.main, boxShadow: `0 0 8px ${colors.main}` }}
            />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
