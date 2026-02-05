import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

interface ContainerStatePieProps {
  running: number;
  stopped: number;
  unhealthy: number;
  paused?: number;
}

const COLORS = {
  running: { main: '#00f5d4', glow: '#00f5d480' },
  stopped: { main: '#ff6b6b', glow: '#ff6b6b80' },
  unhealthy: { main: '#ffd93d', glow: '#ffd93d80' },
  paused: { main: '#a8a8a8', glow: '#a8a8a880' },
};

export function ContainerStatePie({ running, stopped, unhealthy, paused = 0 }: ContainerStatePieProps) {
  const data = [
    { name: 'Running', value: running, key: 'running' as const },
    { name: 'Stopped', value: stopped, key: 'stopped' as const },
    { name: 'Unhealthy', value: unhealthy, key: 'unhealthy' as const },
    ...(paused > 0 ? [{ name: 'Paused', value: paused, key: 'paused' as const }] : []),
  ].filter((d) => d.value > 0);

  const total = running + stopped + unhealthy + paused;

  if (data.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center text-muted-foreground">
        No container data
      </div>
    );
  }

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <defs>
            {Object.entries(COLORS).map(([key, colors]) => (
              <filter key={`glow-${key}`} id={`glow-${key}`} x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                <feMerge>
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            ))}
          </defs>
          {/* Glow layer */}
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={65}
            outerRadius={95}
            paddingAngle={4}
            dataKey="value"
            stroke="none"
            isAnimationActive={false}
          >
            {data.map((entry) => (
              <Cell
                key={`glow-${entry.key}`}
                fill={COLORS[entry.key].glow}
                style={{ filter: `blur(8px)` }}
              />
            ))}
          </Pie>
          {/* Main layer */}
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={70}
            outerRadius={90}
            paddingAngle={4}
            dataKey="value"
            stroke="none"
            animationBegin={0}
            animationDuration={1000}
            animationEasing="ease-out"
          >
            {data.map((entry) => (
              <Cell
                key={entry.key}
                fill={COLORS[entry.key].main}
              />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>

      {/* Center label with glow */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="text-center">
          <div className="text-4xl font-light tracking-tight" style={{ textShadow: '0 0 20px rgba(255,255,255,0.3)' }}>
            {total}
          </div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mt-1">Containers</div>
        </div>
      </div>

      {/* Futuristic legend */}
      <div className="flex justify-center gap-6 mt-4">
        {data.map((entry) => (
          <div key={entry.key} className="flex items-center gap-2 group">
            <div className="relative">
              <div
                className="w-2 h-2 rounded-full"
                style={{
                  backgroundColor: COLORS[entry.key].main,
                  boxShadow: `0 0 8px ${COLORS[entry.key].main}`
                }}
              />
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xs text-muted-foreground uppercase tracking-wide">{entry.name}</span>
              <span className="text-sm font-medium" style={{ color: COLORS[entry.key].main }}>{entry.value}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
