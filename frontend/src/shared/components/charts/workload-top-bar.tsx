import { memo, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { useNavigate } from 'react-router-dom';

/**
 * A stacked running/stopped bar per series row.
 *
 * The prop used to be called `endpoints` while its only caller passed *stacks*,
 * and the bar click navigated to `/endpoints/:id` — a route that does not exist
 * in `router.tsx`, so on the one population that carried an id the click landed
 * on the 404. The series is now generic and each row carries its own `href`;
 * rows without one are not clickable and do not claim to be with a pointer
 * cursor.
 */
export interface WorkloadTopBarProps {
  series: Array<{
    name: string;
    running: number;
    stopped: number;
    total: number;
    /** Where this bar drills to. Omit and the bar is not interactive. */
    href?: string;
  }>;
  isLoading?: boolean;
}

interface ChartRow {
  label: string;
  running: number;
  stopped: number;
  href?: string;
}

function buildChartData(series: WorkloadTopBarProps['series']): ChartRow[] {
  if (!series || series.length === 0) return [];
  const sorted = [...series].sort((a, b) => b.total - a.total);
  const top = sorted.slice(0, 8);
  const rest = sorted.slice(8);

  const rows: ChartRow[] = top.map((item) => ({
    label: item.name,
    running: item.running,
    stopped: item.stopped,
    href: item.href,
  }));

  if (rest.length > 0) {
    rows.push({
      label: `Others (${rest.length} more)`,
      running: rest.reduce((s, ep) => s + ep.running, 0),
      stopped: rest.reduce((s, ep) => s + ep.stopped, 0),
    });
  }

  return rows;
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload) return null;
  const running = payload.find((p: any) => p.dataKey === 'running')?.value ?? 0;
  const stopped = payload.find((p: any) => p.dataKey === 'stopped')?.value ?? 0;

  return (
    <div className="rounded-xl bg-popover/95 backdrop-blur-sm border border-border px-3 py-2 shadow-lg">
      <p className="text-xs font-medium mb-1.5 text-foreground">{label}</p>
      <div className="flex items-center gap-2 text-xs">
        <div className="w-2 h-2 rounded-full bg-emerald-500" />
        <span className="text-muted-foreground">Running:</span>
        <span className="font-medium">{running}</span>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <div className="w-2 h-2 rounded-full bg-red-500" />
        <span className="text-muted-foreground">Stopped:</span>
        <span className="font-medium">{stopped}</span>
      </div>
      <div className="mt-1.5 border-t border-border pt-1.5 text-xs">
        <span className="text-muted-foreground">Total:</span>{' '}
        <span className="font-medium text-foreground">{running + stopped}</span>
      </div>
    </div>
  );
};

const CustomYAxisTick = ({ x, y, payload }: any) => {
  return (
    <text
      x={x}
      y={y}
      textAnchor="end"
      className="text-[11px] fill-muted-foreground"
      dy={4}
    >
      {payload.value}
    </text>
  );
};

const CustomXAxisTick = ({ x, y, payload }: any) => {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      className="text-[11px] fill-muted-foreground"
      dy={12}
    >
      {payload.value}
    </text>
  );
};

export const WorkloadTopBar = memo(function WorkloadTopBar({
  series,
  isLoading,
}: WorkloadTopBarProps) {
  const navigate = useNavigate();
  const chartData = useMemo(() => buildChartData(series), [series]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (series.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        No data
      </div>
    );
  }

  const rowHeight = 32;
  const chartHeight = Math.max(120, chartData.length * rowHeight + 24);

  const isNavigable = chartData.some((row) => !!row.href);

  const handleBarClick = (data: any) => {
    if (typeof data?.href === 'string' && data.href) {
      navigate(data.href);
    }
  };

  return (
    <div className="w-full h-full flex flex-col">
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 4, right: 14, left: 6, bottom: 4 }}
          barCategoryGap={6}
        >
          <defs>
            <linearGradient id="topBarRunning" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#34d399" />
              <stop offset="100%" stopColor="#10b981" />
            </linearGradient>
            <linearGradient id="topBarStopped" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#f87171" />
              <stop offset="100%" stopColor="#ef4444" />
            </linearGradient>
          </defs>

          <XAxis
            type="number"
            tick={<CustomXAxisTick />}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            tick={<CustomYAxisTick />}
            axisLine={false}
            tickLine={false}
            width={160}
            tickMargin={8}
          />
          <Tooltip content={<CustomTooltip />} cursor={false} />
          <Bar
            dataKey="running"
            name="Running"
            fill="url(#topBarRunning)"
            stackId="a"
            radius={[0, 0, 0, 0]}
            barSize={14}
            onClick={handleBarClick}
            className={isNavigable ? 'cursor-pointer' : undefined}
          />
          <Bar
            dataKey="stopped"
            name="Stopped"
            fill="url(#topBarStopped)"
            stackId="a"
            radius={[0, 4, 4, 0]}
            barSize={14}
            onClick={handleBarClick}
            className={isNavigable ? 'cursor-pointer' : undefined}
          />
        </BarChart>
      </ResponsiveContainer>

      <div className="flex justify-center gap-5 pt-2">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500" />
          <span className="text-xs text-muted-foreground">Running</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-gradient-to-r from-red-400 to-red-500" />
          <span className="text-xs text-muted-foreground">Stopped</span>
        </div>
      </div>
    </div>
  );
});

// Export for testing
export { buildChartData };
