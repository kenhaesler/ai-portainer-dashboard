import { memo, useMemo } from 'react';
import { cn } from '@/lib/utils';

interface AnomalySparklineProps {
  values: number[];
  anomalyIndices?: number[];
  width?: number;
  height?: number;
  className?: string;
}

export const AnomalySparkline = memo(function AnomalySparkline({
  values,
  anomalyIndices = [],
  width = 120,
  height = 30,
  className,
}: AnomalySparklineProps) {
  const gradientId = useMemo(() => `anomaly-spark-grad-${Math.random().toString(36).slice(2, 8)}`, []);
  const { points, linePath, areaPath, anomalySet } = useMemo(() => {
    if (values.length < 2) return { points: [], linePath: '', areaPath: '', anomalySet: new Set() };

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const padding = 2; // Padding for anomaly dots

    const pts = values.map((v, i) => ({
      x: (i / (values.length - 1)) * width,
      y: padding + (height - 2 * padding) - ((v - min) / range) * (height - 2 * padding),
    }));

    // Build smooth cubic bezier path
    let line = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      const cpx = (prev.x + curr.x) / 2;
      line += ` C ${cpx} ${prev.y}, ${cpx} ${curr.y}, ${curr.x} ${curr.y}`;
    }

    const lastPoint = pts[pts.length - 1];
    const area = `${line} L ${lastPoint.x} ${height} L ${pts[0].x} ${height} Z`;

    return { points: pts, linePath: line, areaPath: area, anomalySet: new Set(anomalyIndices) };
  }, [values, anomalyIndices, width, height]);

  if (values.length < 2) return null;

  return (
    <svg
      width={width}
      height={height}
      className={cn('inline-block text-muted-foreground', className)}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity={0.3} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path
        d={linePath}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      {points.map((p, i) =>
        anomalySet.has(i) ? (
          <circle key={i} cx={p.x} cy={p.y} r={2.5} fill="hsl(var(--destructive))" />
        ) : null
      )}
    </svg>
  );
});
