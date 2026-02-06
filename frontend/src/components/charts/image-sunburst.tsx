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

const COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
  '#14b8a6', '#a855f7', '#f43f5e', '#22c55e', '#eab308',
  '#0ea5e9', '#d946ef', '#64748b', '#fb923c', '#4ade80',
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

  // Sort outer data by size descending, take top 15, group rest as "Other"
  const sorted = [...data].sort((a, b) => b.size - a.size);
  const topImages = sorted.slice(0, 15);
  const restSize = sorted.slice(15).reduce((sum, img) => sum + img.size, 0);

  const outerData = topImages.map((img) => ({
    name: img.name,
    value: img.size,
  }));
  if (restSize > 0) {
    outerData.push({ name: `Other (${sorted.length - 15})`, value: restSize });
  }

  const innerData = Array.from(registryMap.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  return (
    <ResponsiveContainer width="100%" height={400}>
      <PieChart>
        <Pie
          data={innerData}
          cx="50%"
          cy="50%"
          innerRadius={30}
          outerRadius={70}
          dataKey="value"
          label={false}
        >
          {innerData.map((_, index) => (
            <Cell key={index} fill={COLORS[index % COLORS.length]} opacity={0.7} />
          ))}
        </Pie>
        <Pie
          data={outerData}
          cx="50%"
          cy="50%"
          innerRadius={80}
          outerRadius={140}
          dataKey="value"
          label={false}
        >
          {outerData.map((_, index) => (
            <Cell key={index} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip content={<CustomTooltip />} />
        <Legend
          layout="vertical"
          align="right"
          verticalAlign="middle"
          iconType="circle"
          iconSize={8}
          formatter={(value: string) =>
            value.length > 25 ? value.slice(0, 25) + '...' : value
          }
          wrapperStyle={{ fontSize: '11px', maxHeight: 350, overflowY: 'auto' }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
