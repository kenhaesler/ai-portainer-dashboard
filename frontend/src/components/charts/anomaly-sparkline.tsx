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
  const { points, linePath, anomalySet } = useMemo(() => {
    if (values.length < 2) return { points: [], linePath: '', anomalySet: new Set<number>() };

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    const pts = values.map((v, i) => ({
      x: (i / (values.length - 1)) * width,
      y: height - ((v - min) / range) * height,
    }));

    const path = pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
      .join(' ');

    return { points: pts, linePath: path, anomalySet: new Set(anomalyIndices) };
  }, [values, anomalyIndices, width, height]);

  if (values.length < 2) return null;

  return (
    <svg
      width={width}
      height={height}
      className={cn('inline-block', className)}
      viewBox={`0 0 ${width} ${height}`}
    >
      <path
        d={linePath}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="text-muted-foreground"
      />
      {points.map((p, i) =>
        anomalySet.has(i) ? (
          <circle key={i} cx={p.x} cy={p.y} r={3} fill="#ef4444" />
        ) : null
      )}
    </svg>
  );
});
