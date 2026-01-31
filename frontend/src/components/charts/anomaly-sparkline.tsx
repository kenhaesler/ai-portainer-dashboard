import { cn } from '@/lib/utils';

interface AnomalySparklineProps {
  values: number[];
  anomalyIndices?: number[];
  width?: number;
  height?: number;
  className?: string;
}

export function AnomalySparkline({
  values,
  anomalyIndices = [],
  width = 120,
  height = 30,
  className,
}: AnomalySparklineProps) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values.map((v, i) => ({
    x: (i / (values.length - 1)) * width,
    y: height - ((v - min) / range) * height,
  }));

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ');

  const anomalySet = new Set(anomalyIndices);

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
}
