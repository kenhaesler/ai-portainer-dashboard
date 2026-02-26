import { memo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { useEffect, useState } from 'react';

interface ContainerStatePieProps {
  running: number;
  stopped: number;
  unhealthy: number;
  paused?: number;
}

const COLORS = {
  running: { main: '#34d399', light: '#6ee7b7' },
  stopped: { main: '#f87171', light: '#fca5a5' },
  unhealthy: { main: '#fbbf24', light: '#fcd34d' },
  paused: { main: '#9ca3af', light: '#d1d5db' },
};

export const ContainerStatePie = memo(function ContainerStatePie({ running, stopped, unhealthy, paused = 0 }: ContainerStatePieProps) {
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setPulse(p => !p), 2000);
    return () => clearInterval(interval);
  }, []);

  const data = [
    { name: 'Running', value: running, key: 'running' as const },
    { name: 'Stopped', value: stopped, key: 'stopped' as const },
    { name: 'Unhealthy', value: unhealthy, key: 'unhealthy' as const },
    ...(paused > 0 ? [{ name: 'Paused', value: paused, key: 'paused' as const }] : []),
  ].filter((d) => d.value > 0);

  const total = running + stopped + unhealthy + paused;

  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        No container data
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Chart area — center label is scoped to this wrapper */}
      <div className="relative flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <defs>
              {Object.entries(COLORS).map(([key, colors]) => (
                <linearGradient key={key} id={`gradient-${key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colors.light} stopOpacity={1} />
                  <stop offset="100%" stopColor={colors.main} stopOpacity={1} />
                </linearGradient>
              ))}
            </defs>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius="55%"
              outerRadius="78%"
              paddingAngle={data.length > 1 ? 3 : 0}
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

        {/* Center label — scoped to chart area only */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <div
              className={`text-4xl font-semibold transition-all duration-700 ${pulse ? 'scale-105 opacity-100' : 'scale-100 opacity-90'}`}
            >
              {total}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">Total</div>
          </div>
        </div>
      </div>

      {/* Clean legend */}
      <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 pt-3">
        {data.map((entry, index) => (
          <div key={entry.key} className="flex items-center gap-2">
            <div
              className={`w-2.5 h-2.5 rounded-full transition-transform duration-700 ${pulse ? 'scale-110' : 'scale-100'}`}
              style={{
                background: `linear-gradient(180deg, ${COLORS[entry.key].light}, ${COLORS[entry.key].main})`,
                transitionDelay: `${index * 100}ms`,
              }}
            />
            <span className="text-xs text-muted-foreground">{entry.name}</span>
            <span className="text-xs font-medium">{entry.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
});
