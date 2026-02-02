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

export function MetricsLineChart({
  data,
  label,
  color = '#3b82f6',
  unit = '%',
  anomalyThreshold,
}: MetricsLineChartProps) {
  if (!data.length) {
    return (
      <div className="flex h-[300px] items-center justify-center text-muted-foreground">
        No metrics data
      </div>
    );
  }

  const anomalies = data.filter((d) => d.isAnomaly);

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
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
          dot={false}
          activeDot={{ r: 4 }}
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
}
