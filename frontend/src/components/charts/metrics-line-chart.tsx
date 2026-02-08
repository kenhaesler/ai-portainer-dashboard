import { memo, useMemo, useState, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ReferenceDot } from 'recharts';
import { Bot, X, AlertTriangle, Lightbulb } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type { AnomalyExplanation } from '@/hooks/use-metrics';

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
  height?: number;
  anomalyThreshold?: number;
  anomalyExplanations?: AnomalyExplanation[];
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

/** Find the best anomaly explanation for a given timestamp.
 *  Prefers a close timestamp match (within 5 min), but falls back to the
 *  most recent explanation so every anomaly dot can show AI context. */
function findExplanation(
  timestamp: string,
  explanations: AnomalyExplanation[],
): AnomalyExplanation | undefined {
  if (explanations.length === 0) return undefined;

  const t = new Date(timestamp).getTime();
  let closest: AnomalyExplanation | undefined;
  let closestDist = Infinity;

  for (const e of explanations) {
    const dist = Math.abs(new Date(e.timestamp).getTime() - t);
    if (dist < closestDist && dist < 5 * 60 * 1000) {
      closestDist = dist;
      closest = e;
    }
  }

  // Fall back to the most recent explanation (already sorted DESC from API)
  return closest ?? explanations[0];
}

const CustomTooltip = ({ active, payload, label, unit, name }: any) => {
  if (active && payload && payload.length) {
    const isAnomaly = payload[0].payload.isAnomaly;
    return (
      <div className={cn(
        'rounded-xl border px-3 py-2 shadow-xl backdrop-blur-md',
        isAnomaly
          ? 'border-red-500/30 bg-red-950/60'
          : 'border-white/20 bg-background/70',
      )}>
        <p className="text-xs text-muted-foreground">{formatDate(label)}</p>
        <p className="mt-0.5 text-sm font-medium text-foreground">
          {name}: <span className={isAnomaly ? 'text-red-400' : ''}>{payload[0].value.toFixed(1)}{unit}</span>
        </p>
        {isAnomaly && (
          <p className="mt-1 text-xs font-medium text-red-400">
            Click dot for details
          </p>
        )}
      </div>
    );
  }
  return null;
};

/** Clickable anomaly dot with pulsing glow animation */
function ClickableAnomalyDot(props: any) {
  const { cx = 0, cy = 0, onClick } = props;
  return (
    <g data-testid="anomaly-dot" onClick={onClick} style={{ cursor: 'pointer' }}>
      {/* Outer pulse ring */}
      <circle cx={cx} cy={cy} r={12} fill="none" stroke="hsl(var(--destructive))" strokeWidth={1.5} opacity={0.4}>
        <animate attributeName="r" from="6" to="14" dur="1.5s" repeatCount="indefinite" />
        <animate attributeName="opacity" from="0.6" to="0" dur="1.5s" repeatCount="indefinite" />
      </circle>
      {/* Glow */}
      <circle cx={cx} cy={cy} r={8} fill="hsl(var(--destructive))" opacity={0.15} />
      {/* Core dot */}
      <circle
        cx={cx}
        cy={cy}
        r={5}
        fill="hsl(var(--destructive))"
        stroke="white"
        strokeWidth={1.5}
      />
      {/* Inner highlight */}
      <circle cx={cx} cy={cy} r={2} fill="white" opacity={0.5} />
    </g>
  );
}

const severityColor: Record<string, string> = {
  critical: 'text-red-500',
  warning: 'text-amber-500',
  info: 'text-blue-500',
};

const severityBg: Record<string, string> = {
  critical: 'bg-red-500/10',
  warning: 'bg-amber-500/10',
  info: 'bg-blue-500/10',
};


export const MetricsLineChart = memo(function MetricsLineChart({
  data,
  label,
  color = 'hsl(var(--primary))',
  unit = '%',
  height = 300,
  anomalyExplanations = [],
}: MetricsLineChartProps) {
  const decimated = useMemo(() => decimateData(data, MAX_CHART_POINTS), [data]);
  const anomalies = useMemo(() => data.filter((d) => d.isAnomaly), [data]);
  const [selectedAnomaly, setSelectedAnomaly] = useState<{
    point: MetricPoint;
    explanation: AnomalyExplanation | undefined;
  } | null>(null);

  const handleAnomalyClick = useCallback(
    (point: MetricPoint) => {
      const explanation = findExplanation(point.timestamp, anomalyExplanations);
      setSelectedAnomaly((prev) =>
        prev?.point.timestamp === point.timestamp ? null : { point, explanation },
      );
    },
    [anomalyExplanations],
  );

  if (!data.length) {
    return (
      <div className="flex h-[300px] items-center justify-center text-muted-foreground">
        No metrics data
      </div>
    );
  }

  const gradientId = `color-${label.replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <div className="flex gap-3">
      {/* Chart — shrinks when explanation panel is open */}
      <div className={cn('min-w-0 transition-all', selectedAnomaly ? 'flex-[3]' : 'flex-1')}>
        <ResponsiveContainer width="100%" height={height}>
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
                r={6}
                fill="hsl(var(--destructive))"
                stroke="hsl(var(--destructive-foreground))"
                strokeWidth={1.5}
                shape={<ClickableAnomalyDot onClick={() => handleAnomalyClick(a)} />}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Anomaly explanation panel — slides in from the right */}
      {selectedAnomaly && (
        <div
          className="flex-1 rounded-xl border border-white/10 bg-card/80 p-4 overflow-y-auto shadow-xl backdrop-blur-md"
          style={{ maxHeight: height }}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                selectedAnomaly.explanation?.severity === 'critical'
                  ? 'bg-red-500/15'
                  : 'bg-amber-500/15',
              )}>
                <AlertTriangle className={cn(
                  'h-4 w-4',
                  severityColor[selectedAnomaly.explanation?.severity ?? 'warning'],
                )} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">
                  {selectedAnomaly.explanation?.title ?? 'Anomaly Detected'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(selectedAnomaly.point.timestamp)} — <span className="font-medium text-foreground">{selectedAnomaly.point.value.toFixed(1)}{unit}</span>
                </p>
              </div>
            </div>
            <button
              onClick={() => setSelectedAnomaly(null)}
              className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Severity + category badges */}
          <div className="mt-2.5 flex items-center gap-2">
            <span className={cn(
              'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
              selectedAnomaly.explanation
                ? severityBg[selectedAnomaly.explanation.severity]
                : severityBg.warning,
              selectedAnomaly.explanation
                ? severityColor[selectedAnomaly.explanation.severity]
                : severityColor.warning,
            )}>
              {selectedAnomaly.explanation?.severity ?? 'warning'}
            </span>
            {selectedAnomaly.explanation?.category && (
              <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                {selectedAnomaly.explanation.category}
              </span>
            )}
          </div>

          {/* Divider */}
          <div className="my-3 border-t border-white/5" />

          {/* Content */}
          {selectedAnomaly.explanation?.aiExplanation ? (
            <div className="flex items-start gap-2.5 rounded-lg bg-purple-500/5 p-2.5">
              <Bot className="mt-0.5 h-4 w-4 shrink-0 text-purple-400" />
              <p className="text-sm leading-relaxed">
                {selectedAnomaly.explanation.aiExplanation}
              </p>
            </div>
          ) : selectedAnomaly.explanation?.description ? (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {selectedAnomaly.explanation.description}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Value exceeded the 80{unit} warning threshold.
            </p>
          )}

          {selectedAnomaly.explanation?.suggestedAction && (
            <div className="mt-3 flex items-start gap-2.5 rounded-lg bg-amber-500/5 p-2.5">
              <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <p className="text-sm text-muted-foreground">
                {selectedAnomaly.explanation.suggestedAction}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
