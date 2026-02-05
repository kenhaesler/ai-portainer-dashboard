import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine } from 'recharts';

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
  running: '#00ffff',
  stopped: '#ff00ff',
  unhealthy: '#ffaa00',
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload) return null;

  return (
    <div className="rounded border border-cyan-500/30 bg-black/90 backdrop-blur-md px-3 py-2 shadow-2xl"
      style={{ boxShadow: '0 0 20px rgba(0, 255, 255, 0.2)' }}>
      <p className="text-[10px] uppercase tracking-[0.2em] text-cyan-400/80 mb-2 font-mono border-b border-cyan-500/20 pb-1">
        ◆ {label}
      </p>
      {payload.map((entry: any, index: number) => (
        <div key={entry.name} className="flex items-center justify-between gap-6 text-xs font-mono">
          <div className="flex items-center gap-2">
            <div
              className="w-1 h-3 rounded-sm"
              style={{ backgroundColor: entry.fill, boxShadow: `0 0 8px ${entry.fill}` }}
            />
            <span className="text-white/60 uppercase text-[10px]">{entry.name}</span>
          </div>
          <span
            className="font-bold tabular-nums"
            style={{ color: entry.fill, textShadow: `0 0 10px ${entry.fill}` }}
          >
            {entry.value}
          </span>
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
    displayName: d.name.length > 12 ? d.name.slice(0, 12) + '…' : d.name,
  }));

  const maxValue = Math.max(...data.map(d => d.running + d.stopped + d.unhealthy));

  return (
    <div className="relative space-y-4">
      {/* Grid overlay effect */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-lg opacity-20">
        <div className="absolute inset-0" style={{
          backgroundImage: `
            linear-gradient(rgba(0, 255, 255, 0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0, 255, 255, 0.1) 1px, transparent 1px)
          `,
          backgroundSize: '20px 20px',
        }} />
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={chartData} margin={{ top: 15, right: 10, left: -15, bottom: 0 }}>
          <defs>
            <linearGradient id="spaceBarRunning" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.running} stopOpacity={1} />
              <stop offset="100%" stopColor={COLORS.running} stopOpacity={0.3} />
            </linearGradient>
            <linearGradient id="spaceBarStopped" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.stopped} stopOpacity={1} />
              <stop offset="100%" stopColor={COLORS.stopped} stopOpacity={0.3} />
            </linearGradient>
            <linearGradient id="spaceBarUnhealthy" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.unhealthy} stopOpacity={1} />
              <stop offset="100%" stopColor={COLORS.unhealthy} stopOpacity={0.3} />
            </linearGradient>
            <filter id="spaceBarGlow">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Reference lines for radar effect */}
          {[0.25, 0.5, 0.75].map((ratio) => (
            <ReferenceLine
              key={ratio}
              y={Math.round(maxValue * ratio)}
              stroke="rgba(0, 255, 255, 0.1)"
              strokeDasharray="3 3"
            />
          ))}

          <XAxis
            dataKey="displayName"
            tick={{ fontSize: 9, fill: 'rgba(0, 255, 255, 0.5)', fontFamily: 'monospace' }}
            axisLine={{ stroke: 'rgba(0, 255, 255, 0.2)' }}
            tickLine={{ stroke: 'rgba(0, 255, 255, 0.2)' }}
          />
          <YAxis
            tick={{ fontSize: 9, fill: 'rgba(0, 255, 255, 0.5)', fontFamily: 'monospace' }}
            axisLine={{ stroke: 'rgba(0, 255, 255, 0.2)' }}
            tickLine={{ stroke: 'rgba(0, 255, 255, 0.2)' }}
            width={30}
          />
          <Tooltip content={<CustomTooltip />} cursor={false} />
          <Bar
            dataKey="running"
            name="Running"
            fill="url(#spaceBarRunning)"
            stackId="a"
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="stopped"
            name="Stopped"
            fill="url(#spaceBarStopped)"
            stackId="a"
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="unhealthy"
            name="Unhealthy"
            fill="url(#spaceBarUnhealthy)"
            stackId="a"
            radius={[2, 2, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>

      {/* Space station style legend */}
      <div className="flex justify-center gap-4">
        {Object.entries({ Running: COLORS.running, Stopped: COLORS.stopped, Unhealthy: COLORS.unhealthy }).map(([name, color]) => (
          <div
            key={name}
            className="flex items-center gap-2 px-2 py-0.5 border border-white/10 rounded bg-black/30"
          >
            <div className="flex items-center gap-1">
              <div className="w-0.5 h-3 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }} />
              <div className="w-0.5 h-2 rounded-full opacity-50" style={{ backgroundColor: color }} />
            </div>
            <span className="text-[9px] uppercase tracking-wider text-white/40 font-mono">{name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
