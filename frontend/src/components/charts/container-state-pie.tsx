import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { useEffect, useState } from 'react';

interface ContainerStatePieProps {
  running: number;
  stopped: number;
  unhealthy: number;
  paused?: number;
}

const COLORS = {
  running: '#00ffff',
  stopped: '#ff00ff',
  unhealthy: '#ffaa00',
  paused: '#8888ff',
};

export function ContainerStatePie({ running, stopped, unhealthy, paused = 0 }: ContainerStatePieProps) {
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
      <div className="flex h-[300px] items-center justify-center text-muted-foreground">
        No container data
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Starfield background */}
      <div className="absolute inset-0 overflow-hidden rounded-lg">
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute w-0.5 h-0.5 bg-white rounded-full animate-pulse"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              opacity: Math.random() * 0.5 + 0.2,
              animationDelay: `${Math.random() * 2}s`,
              animationDuration: `${Math.random() * 2 + 1}s`,
            }}
          />
        ))}
      </div>

      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <defs>
            {/* Cosmic gradients */}
            {Object.entries(COLORS).map(([key, color]) => (
              <linearGradient key={key} id={`space-${key}`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.9} />
                <stop offset="50%" stopColor={color} stopOpacity={0.6} />
                <stop offset="100%" stopColor="#000033" stopOpacity={0.8} />
              </linearGradient>
            ))}
            {/* Glow filter */}
            <filter id="spaceGlow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Outer ring - orbit track */}
          <Pie
            data={[{ value: 1 }]}
            cx="50%"
            cy="50%"
            innerRadius={105}
            outerRadius={107}
            dataKey="value"
            stroke="none"
            isAnimationActive={false}
          >
            <Cell fill="rgba(100, 150, 255, 0.2)" />
          </Pie>

          {/* Glow layer */}
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={3}
            dataKey="value"
            stroke="none"
            isAnimationActive={false}
          >
            {data.map((entry) => (
              <Cell
                key={`glow-${entry.key}`}
                fill={COLORS[entry.key]}
                style={{ filter: 'blur(12px)', opacity: 0.5 }}
              />
            ))}
          </Pie>

          {/* Main segments */}
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={65}
            outerRadius={95}
            paddingAngle={4}
            dataKey="value"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth={1}
            animationBegin={0}
            animationDuration={1200}
          >
            {data.map((entry) => (
              <Cell
                key={entry.key}
                fill={`url(#space-${entry.key})`}
              />
            ))}
          </Pie>

          {/* Inner ring decoration */}
          <Pie
            data={[{ value: 1 }]}
            cx="50%"
            cy="50%"
            innerRadius={58}
            outerRadius={60}
            dataKey="value"
            stroke="none"
            isAnimationActive={false}
          >
            <Cell fill="rgba(100, 200, 255, 0.3)" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>

      {/* Center holographic display */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="text-center relative">
          {/* Scanning line effect */}
          <div
            className="absolute inset-0 bg-gradient-to-b from-transparent via-cyan-400/20 to-transparent"
            style={{
              animation: 'scan 2s ease-in-out infinite',
              height: '100%',
            }}
          />
          <div
            className={`text-4xl font-mono font-bold tracking-wider transition-all duration-500 ${pulse ? 'text-cyan-300' : 'text-cyan-400'}`}
            style={{
              textShadow: `0 0 20px ${COLORS.running}, 0 0 40px ${COLORS.running}40`,
            }}
          >
            {total}
          </div>
          <div className="text-[9px] uppercase tracking-[0.3em] text-cyan-400/60 mt-1 font-mono">
            Units Active
          </div>
        </div>
      </div>

      {/* Futuristic legend with scan effect */}
      <div className="flex justify-center gap-5 mt-4">
        {data.map((entry, index) => (
          <div
            key={entry.key}
            className="flex items-center gap-2 px-2 py-1 rounded border border-white/5 bg-white/5 backdrop-blur-sm"
          >
            <div className="relative">
              <div
                className="w-2 h-2 rounded-full animate-pulse"
                style={{
                  backgroundColor: COLORS[entry.key],
                  boxShadow: `0 0 10px ${COLORS[entry.key]}, 0 0 20px ${COLORS[entry.key]}50`,
                  animationDelay: `${index * 0.3}s`,
                }}
              />
            </div>
            <span className="text-[10px] uppercase tracking-wider text-white/50 font-mono">{entry.name}</span>
            <span
              className="text-xs font-mono font-bold"
              style={{ color: COLORS[entry.key], textShadow: `0 0 8px ${COLORS[entry.key]}` }}
            >
              {entry.value}
            </span>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes scan {
          0%, 100% { transform: translateY(-100%); opacity: 0; }
          50% { transform: translateY(100%); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
