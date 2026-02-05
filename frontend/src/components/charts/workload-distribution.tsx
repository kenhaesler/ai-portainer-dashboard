import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from 'recharts';

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
  running: '#00ffff',
  stopped: '#ff00ff',
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload) return null;

  const total = payload.reduce((sum: number, entry: any) => sum + entry.value, 0);

  return (
    <div className="rounded border border-fuchsia-500/30 bg-black/90 backdrop-blur-md px-3 py-2 shadow-2xl"
      style={{ boxShadow: '0 0 20px rgba(255, 0, 255, 0.2)' }}>
      <p className="text-[10px] uppercase tracking-[0.2em] text-fuchsia-400/80 mb-2 font-mono border-b border-fuchsia-500/20 pb-1">
        ◈ {label}
      </p>
      <div className="text-[10px] text-white/40 mb-1.5 font-mono">
        TOTAL UNITS: <span className="text-white font-bold">{total}</span>
      </div>
      {payload.map((entry: any) => (
        <div key={entry.name} className="flex items-center justify-between gap-6 text-xs font-mono">
          <div className="flex items-center gap-2">
            <div
              className="w-3 h-1 rounded-sm"
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
    displayName: d.endpoint.length > 10 ? d.endpoint.slice(0, 10) + '…' : d.endpoint,
    total: d.running + d.stopped,
  }));

  return (
    <div className="relative space-y-4">
      {/* Scan lines effect */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-lg">
        <div className="absolute inset-0 opacity-10" style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255, 0, 255, 0.1) 2px, rgba(255, 0, 255, 0.1) 4px)',
        }} />
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
        >
          <defs>
            <linearGradient id="spaceWorkloadRunning" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={COLORS.running} stopOpacity={0.2} />
              <stop offset="100%" stopColor={COLORS.running} stopOpacity={1} />
            </linearGradient>
            <linearGradient id="spaceWorkloadStopped" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={COLORS.stopped} stopOpacity={0.2} />
              <stop offset="100%" stopColor={COLORS.stopped} stopOpacity={1} />
            </linearGradient>
          </defs>

          <XAxis
            type="number"
            tick={{ fontSize: 9, fill: 'rgba(255, 0, 255, 0.5)', fontFamily: 'monospace' }}
            axisLine={{ stroke: 'rgba(255, 0, 255, 0.2)' }}
            tickLine={{ stroke: 'rgba(255, 0, 255, 0.2)' }}
          />
          <YAxis
            type="category"
            dataKey="displayName"
            tick={{ fontSize: 9, fill: 'rgba(255, 0, 255, 0.5)', fontFamily: 'monospace' }}
            axisLine={{ stroke: 'rgba(255, 0, 255, 0.2)' }}
            tickLine={{ stroke: 'rgba(255, 0, 255, 0.2)' }}
            width={85}
          />
          <Tooltip content={<CustomTooltip />} cursor={false} />
          <Bar
            dataKey="running"
            name="Running"
            fill="url(#spaceWorkloadRunning)"
            stackId="a"
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="stopped"
            name="Stopped"
            fill="url(#spaceWorkloadStopped)"
            stackId="a"
            radius={[0, 4, 4, 0]}
          />
        </BarChart>
      </ResponsiveContainer>

      {/* Spacecraft console legend */}
      <div className="flex justify-center gap-4">
        {Object.entries({ Running: COLORS.running, Stopped: COLORS.stopped }).map(([name, color]) => (
          <div
            key={name}
            className="flex items-center gap-2 px-3 py-1 border border-white/10 rounded-sm bg-black/40 relative overflow-hidden"
          >
            {/* Animated shine effect */}
            <div
              className="absolute inset-0 opacity-20"
              style={{
                background: `linear-gradient(90deg, transparent, ${color}40, transparent)`,
                animation: 'shine 3s infinite',
              }}
            />
            <div
              className="w-4 h-1 rounded-sm relative z-10"
              style={{ backgroundColor: color, boxShadow: `0 0 10px ${color}` }}
            />
            <span className="text-[9px] uppercase tracking-wider text-white/50 font-mono relative z-10">{name}</span>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes shine {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  );
}
