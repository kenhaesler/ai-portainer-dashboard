import { memo, useMemo } from 'react';
import { cn } from '@/shared/lib/utils';

interface KpiSparklineProps {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
  /** CSS color or CSS variable for the line/gradient (defaults to chart-1 color) */
  color?: string;
}

/**
 * Tiny SVG sparkline with smooth bezier curve and gradient fill.
 * Designed for inline use in KPI cards (60×20px default).
 */
export const KpiSparkline = memo(function KpiSparkline({
  values,
  width = 60,
  height = 20,
  className,
  color,
}: KpiSparklineProps) {
  const gradientId = useMemo(() => `sparkline-grad-${Math.random().toString(36).slice(2, 8)}`, []);

  const { linePath, areaPath } = useMemo(() => {
    if (values.length < 2) return { linePath: '', areaPath: '' };

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const padding = 1; // Small padding so line doesn't clip edges

    const points = values.map((v, i) => ({
      x: (i / (values.length - 1)) * width,
      y: padding + (height - 2 * padding) - ((v - min) / range) * (height - 2 * padding),
    }));

    // Build smooth cubic bezier path
    let line = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const cpx = (prev.x + curr.x) / 2;
      line += ` C ${cpx} ${prev.y}, ${cpx} ${curr.y}, ${curr.x} ${curr.y}`;
    }

    // Close area path along bottom
    const lastPoint = points[points.length - 1];
    const area = `${line} L ${lastPoint.x} ${height} L ${points[0].x} ${height} Z`;

    return { linePath: line, areaPath: area };
  }, [values, width, height]);

  if (values.length < 2) return null;

  const strokeColor = color || 'var(--color-chart-1)';

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('inline-block shrink-0', className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} stopOpacity={0.3} />
          <stop offset="100%" stopColor={strokeColor} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path d={linePath} fill="none" stroke={strokeColor} strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
});
