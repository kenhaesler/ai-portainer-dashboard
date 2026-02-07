import { memo, useMemo } from 'react';
import { AreaChart, Area, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ReferenceDot } from 'recharts';
import { formatDate } from '@/lib/utils';

interface MetricPoint {
  timestamp: string;
  value: number;
  isAnomaly?: boolean;
}

interface MetricsLineChartProps {
  data: MetricPoint[];
  label: string;
  color?: string;
  unit?: string;
  anomalyThreshold?: number;
}

/** Max points to render before decimating (keeps chart performant) */
const MAX_CHART_POINTS = 200;

/**
 * Downsample data using largest-triangle-three-buckets (LTTB-like) algorithm.
 * Preserves visual shape while reducing SVG path complexity.
 */
function decimateData(data: MetricPoint[], maxPoints: number): MetricPoint[] {
  if (data.length <= maxPoints) return data;

  const result: MetricPoint[] = [data[0]];
  const bucketSize = (data.length - 2) / (maxPoints - 2);

  for (let i = 1; i < maxPoints - 1; i++) {
    const start = Math.floor((i - 1) * bucketSize) + 1;
    const end = Math.min(Math.floor(i * bucketSize) + 1, data.length - 1);

    let maxArea = -1;
    let maxAreaIdx = start;
    const prevPoint = result[result.length - 1];

    for (let j = start; j < end; j++) {
      const area = Math.abs(
        (j - (result.length - 1)) * (prevPoint.value - data[j].value) -
        (result.length - 1 - j) * (prevPoint.value - data[j].value)
      );
      if (area > maxArea) {
        maxArea = area;
        maxAreaIdx = j;
      }
    }
    result.push(data[maxAreaIdx]);
  }

  result.push(data[data.length - 1]);
  return result;
}

const CustomTooltip = ({ active, payload, label, unit, name }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-lg border border-white/20 bg-background/60 p-2 shadow-lg backdrop-blur-sm">
        <p className="label text-sm text-foreground">{`${formatDate(label)}`}</p>
        <p className="intro text-sm text-foreground">{`${name}: ${payload[0].value.toFixed(1)}${unit}`}</p>
        {payload[0].payload.isAnomaly && (
          <p className="text-sm font-bold text-red-500">Anomaly Detected</p>
        )}
      </div>
    );
  }
  return null;
};


export const MetricsLineChart = memo(function MetricsLineChart({
  data,
  label,
  color = 'hsl(var(--primary))',
  unit = '%',
}: MetricsLineChartProps) {
  const decimated = useMemo(() => decimateData(data, MAX_CHART_POINTS), [data]);
  const anomalies = useMemo(() => data.filter((d) => d.isAnomaly), [data]);

  if (!data.length) {
    return (
      <div className="flex h-[300px] items-center justify-center text-muted-foreground">
        No metrics data
      </div>
    );
  }

  const gradientId = `color-${label.replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={decimated} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.4}/>
            <stop offset="95%" stopColor={color} stopOpacity={0}/>
          </linearGradient>
        </defs>
        <XAxis
          dataKey="timestamp"
          tick={{ fontSize: 11 }}
          stroke="hsl(var(--muted-foreground))"
          tickFormatter={(v) => formatDate(v)}
        />
        <YAxis
          tick={{ fontSize: 11 }}
          stroke="hsl(var(--muted-foreground))"
          tickFormatter={(v) => `${v}${unit}`}
        />
        <Tooltip
          content={<CustomTooltip unit={unit} name={label} />}
        />
        <Legend />
        <Area
          type="monotone"
          dataKey="value"
          name={label}
          stroke={color}
          strokeWidth={2}
          fillOpacity={1}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2 }}
          isAnimationActive
        />
        {anomalies.map((a, i) => (
          <ReferenceDot
            key={i}
            x={a.timestamp}
            y={a.value}
            r={5}
            fill="hsl(var(--destructive))"
            stroke="hsl(var(--destructive-foreground))"
            strokeWidth={1}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
});
