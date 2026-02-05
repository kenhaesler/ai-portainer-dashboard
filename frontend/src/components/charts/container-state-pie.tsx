import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

interface ContainerStatePieProps {
  running: number;
  stopped: number;
  unhealthy: number;
  paused?: number;
}

const COLORS = {
  running: { start: '#34d399', end: '#10b981' },
  stopped: { start: '#f87171', end: '#ef4444' },
  unhealthy: { start: '#fbbf24', end: '#f59e0b' },
  paused: { start: '#9ca3af', end: '#6b7280' },
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
              <linearGradient key={key} id={`gradient-${key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colors.start} stopOpacity={1} />
                <stop offset="100%" stopColor={colors.end} stopOpacity={1} />
              </linearGradient>
            ))}
          </defs>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={70}
            outerRadius={100}
            paddingAngle={3}
            dataKey="value"
            stroke="none"
            animationBegin={0}
            animationDuration={800}
          >
            {data.map((entry) => (
              <Cell
                key={entry.key}
                fill={`url(#gradient-${entry.key})`}
                className="drop-shadow-sm"
              />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>

      {/* Center label */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="text-center">
          <div className="text-3xl font-bold">{total}</div>
          <div className="text-xs text-muted-foreground">Total</div>
        </div>
      </div>

      {/* Custom legend */}
      <div className="flex justify-center gap-4 mt-2">
        {data.map((entry) => (
          <div key={entry.key} className="flex items-center gap-1.5">
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{ background: `linear-gradient(180deg, ${COLORS[entry.key].start}, ${COLORS[entry.key].end})` }}
            />
            <span className="text-xs text-muted-foreground">{entry.name}</span>
            <span className="text-xs font-medium">{entry.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
