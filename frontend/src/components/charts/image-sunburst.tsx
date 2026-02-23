import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { formatBytes } from '@/lib/utils';

interface ImageData {
  name: string;
  size: number;
  registry?: string;
}

interface ImageSunburstProps {
  data: ImageData[];
}

// Soft pastel palette
const COLORS = [
  '#93c5fd', '#a5b4fc', '#c4b5fd', '#f9a8d4', '#fda4af',
  '#fcd34d', '#86efac', '#6ee7b7', '#67e8f9', '#7dd3fc',
];

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.[0]) return null;
  const { name, value } = payload[0];
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="font-medium text-foreground">{name}</p>
      <p className="text-muted-foreground">{formatBytes(value)}</p>
    </div>
  );
}

export function ImageSunburst({ data }: ImageSunburstProps) {
  if (!data.length) {
    return (
      <div className="flex h-[400px] items-center justify-center text-muted-foreground">
        No image data
      </div>
    );
  }

  // Group by registry
  const registryMap = new Map<string, number>();
  for (const img of data) {
    const registry = img.registry || 'docker.io';
    registryMap.set(registry, (registryMap.get(registry) || 0) + img.size);
  }

  const registryData = Array.from(registryMap.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  return (
    <ResponsiveContainer width="100%" height={400}>
      <PieChart>
        <Pie
          data={registryData}
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={140}
          dataKey="value"
          label={({ name, percent }) =>
            `${name} (${((percent ?? 0) * 100).toFixed(0)}%)`
          }
          labelLine={{ strokeWidth: 1, stroke: 'var(--color-muted-foreground)' }}
        >
          {registryData.map((_, index) => (
            <Cell key={index} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip content={<CustomTooltip />} />
        <Legend
          layout="horizontal"
          align="center"
          verticalAlign="bottom"
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: '12px', paddingTop: 16 }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
