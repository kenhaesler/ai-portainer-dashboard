import { memo, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ReferenceDot } from 'recharts';
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

export const MetricsLineChart = memo(function MetricsLineChart({
  data,
  label,
  color = '#3b82f6',
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

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={decimated} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
        <XAxis
          dataKey="timestamp"
          tick={{ fontSize: 11 }}
          tickFormatter={(v) => formatDate(v)}
        />
        <YAxis
          tick={{ fontSize: 11 }}
          tickFormatter={(v) => `${v}${unit}`}
        />
        <Tooltip
          labelFormatter={(v) => formatDate(v as string)}
          formatter={(value: number) => [`${value.toFixed(1)}${unit}`, label]}
        />
        <Legend />
        <Line
          type="monotone"
          dataKey="value"
          name={label}
          stroke={color}
          strokeWidth={2}
          dot={decimated.length <= 1 ? { r: 4, fill: color, stroke: color } : false}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
        />
        {anomalies.map((a, i) => (
          <ReferenceDot
            key={i}
            x={a.timestamp}
            y={a.value}
            r={5}
            fill="#ef4444"
            stroke="#ef4444"
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
});
