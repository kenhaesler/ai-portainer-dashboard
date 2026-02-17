interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
}

/**
 * A pure SVG mini chart component for inline sparkline visualizations.
 * Uses currentColor by default for automatic theme awareness.
 */
export function Sparkline({
  data,
  width = 96,
  height = 32,
  color = 'currentColor',
  className,
}: SparklineProps) {
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1; // avoid division by zero for flat data

  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * width;
    // Invert Y: SVG y=0 is top, so higher values should be higher on screen
    const y = height - ((value - min) / range) * height;
    return { x, y };
  });

  // Build the line path
  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ');

  // Build the fill path (close along the bottom)
  const fillPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;

  const gradientId = `sparkline-grad-${width}-${height}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      width={width}
      height={height}
      className={className}
      role="img"
      aria-label="Sparkline chart"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {/* Gradient fill under the line */}
      <path d={fillPath} fill={`url(#${gradientId})`} />
      {/* The line itself */}
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
