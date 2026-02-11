import { memo } from 'react';
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

export const EndpointStatusBar = memo(function EndpointStatusBar({ data }: EndpointStatusBarProps) {
  if (!data.length) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        No endpoint data
      </div>
    );
  }

  const chartData = data.map(d => ({
    ...d,
    displayName: d.name.length > 15 ? d.name.slice(0, 15) + '…' : d.name,
  }));

  // For many endpoints, use horizontal bars so labels don't overlap
  const useHorizontal = chartData.length > 4;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 min-h-0">
        {useHorizontal ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 4, right: 14, left: 6, bottom: 4 }}
              barCategoryGap={8}
            >
              <defs>
                <linearGradient id="barGradientRunning" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#6ee7b7" />
                  <stop offset="100%" stopColor="#34d399" />
                </linearGradient>
                <linearGradient id="barGradientStopped" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#fca5a5" />
                  <stop offset="100%" stopColor="#f87171" />
                </linearGradient>
                <linearGradient id="barGradientUnhealthy" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#fcd34d" />
                  <stop offset="100%" stopColor="#fbbf24" />
                </linearGradient>
              </defs>
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="displayName"
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                axisLine={false}
                tickLine={false}
                width={110}
                tickMargin={6}
              />
              <Tooltip content={<CustomTooltip />} cursor={false} />
              <Bar dataKey="running" name="Running" fill="url(#barGradientRunning)" stackId="a" radius={[0, 0, 0, 0]} barSize={14} />
              <Bar dataKey="stopped" name="Stopped" fill="url(#barGradientStopped)" stackId="a" radius={[0, 0, 0, 0]} barSize={14} />
              <Bar dataKey="unhealthy" name="Unhealthy" fill="url(#barGradientUnhealthy)" stackId="a" radius={[0, 4, 4, 0]} barSize={14} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="barGradientRunning" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6ee7b7" />
                  <stop offset="100%" stopColor="#34d399" />
                </linearGradient>
                <linearGradient id="barGradientStopped" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#fca5a5" />
                  <stop offset="100%" stopColor="#f87171" />
                </linearGradient>
                <linearGradient id="barGradientUnhealthy" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#fcd34d" />
                  <stop offset="100%" stopColor="#fbbf24" />
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
              <Tooltip content={<CustomTooltip />} cursor={false} />
              <Bar dataKey="running" name="Running" fill="url(#barGradientRunning)" stackId="a" radius={[0, 0, 0, 0]} />
              <Bar dataKey="stopped" name="Stopped" fill="url(#barGradientStopped)" stackId="a" radius={[0, 0, 0, 0]} />
              <Bar dataKey="unhealthy" name="Unhealthy" fill="url(#barGradientUnhealthy)" stackId="a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Clean legend */}
      <div className="flex justify-center gap-5 pt-3">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-gradient-to-b from-emerald-300 to-emerald-400" />
          <span className="text-xs text-muted-foreground">Running</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-gradient-to-b from-red-300 to-red-400" />
          <span className="text-xs text-muted-foreground">Stopped</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-gradient-to-b from-amber-300 to-amber-400" />
          <span className="text-xs text-muted-foreground">Unhealthy</span>
        </div>
      </div>
    </div>
  );
});
