import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
import { formatBytes } from '@/lib/utils';

interface ImageData {
  name: string;
  size: number;
  children?: ImageData[];
}

interface ImageTreemapProps {
  data: ImageData[];
}

const COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
  '#14b8a6', '#a855f7', '#f43f5e', '#22c55e', '#eab308',
];

function CustomContent(props: any) {
  const { x, y, width, height, index, name, size } = props;

  // Always render the colored rect — no invisible blank cells
  const fill = COLORS[index % COLORS.length];
  const opacity = 0.6 + Math.min((size || 0) / 1e9, 1) * 0.4;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={fill}
        fillOpacity={opacity}
        stroke="#fff"
        strokeWidth={1}
      />
      {/* Show name label when cell is large enough */}
      {width > 50 && height > 24 && (
        <text
          x={x + width / 2}
          y={y + height / 2 - (height > 36 ? 6 : 0)}
          textAnchor="middle"
          dominantBaseline="central"
          fill="#fff"
          fontSize={Math.min(11, width / 8)}
        >
          {name?.length > Math.floor(width / 7)
            ? name.slice(0, Math.floor(width / 7)) + '...'
            : name}
        </text>
      )}
      {/* Show size when cell is tall enough for two lines */}
      {width > 50 && height > 36 && (
        <text
          x={x + width / 2}
          y={y + height / 2 + 10}
          textAnchor="middle"
          fill="#fff"
          fontSize={10}
          opacity={0.8}
        >
          {formatBytes(size || 0)}
        </text>
      )}
    </g>
  );
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.[0]) return null;
  const { name, size } = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="font-medium text-foreground">{name}</p>
      <p className="text-muted-foreground">{formatBytes(size)}</p>
    </div>
  );
}

export function ImageTreemap({ data }: ImageTreemapProps) {
  if (!data.length) {
    return (
      <div className="flex h-[400px] items-center justify-center text-muted-foreground">
        No image data
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={400}>
      <Treemap
        data={data}
        dataKey="size"
        aspectRatio={4 / 3}
        stroke="#fff"
        content={<CustomContent />}
      >
        <Tooltip content={<CustomTooltip />} />
      </Treemap>
    </ResponsiveContainer>
  );
}
