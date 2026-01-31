import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
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
];

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

  const outerData = data.map((img) => ({
    name: img.name,
    value: img.size,
  }));

  const innerData = Array.from(registryMap.entries()).map(([name, value]) => ({
    name,
    value,
  }));

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
          label={({ name }) => name?.length > 20 ? name.slice(0, 20) + '...' : name}
        >
          {outerData.map((_, index) => (
            <Cell key={index} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(value: number) => formatBytes(value)} />
      </PieChart>
    </ResponsiveContainer>
  );
}
