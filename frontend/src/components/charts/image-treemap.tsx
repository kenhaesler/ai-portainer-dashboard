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

function CustomContent(props: any) {
  const { x, y, width, height, name, size } = props;
  if (width < 40 || height < 20) return null;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="#3b82f6"
        fillOpacity={0.7 + (size / 1e9) * 0.3}
        stroke="#fff"
        strokeWidth={1}
      />
      {width > 60 && height > 30 && (
        <>
          <text
            x={x + width / 2}
            y={y + height / 2 - 6}
            textAnchor="middle"
            fill="#fff"
            fontSize={11}
          >
            {name?.length > 15 ? name.slice(0, 15) + '...' : name}
          </text>
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
        </>
      )}
    </g>
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
        <Tooltip formatter={(value: number) => formatBytes(value)} />
      </Treemap>
    </ResponsiveContainer>
  );
}
