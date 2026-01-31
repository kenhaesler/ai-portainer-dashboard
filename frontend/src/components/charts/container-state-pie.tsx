import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface ContainerStatePieProps {
  running: number;
  stopped: number;
  unhealthy: number;
  paused?: number;
}

const COLORS = {
  running: '#10b981',
  stopped: '#ef4444',
  unhealthy: '#f59e0b',
  paused: '#6b7280',
};

export function ContainerStatePie({ running, stopped, unhealthy, paused = 0 }: ContainerStatePieProps) {
  const data = [
    { name: 'Running', value: running, color: COLORS.running },
    { name: 'Stopped', value: stopped, color: COLORS.stopped },
    { name: 'Unhealthy', value: unhealthy, color: COLORS.unhealthy },
    ...(paused > 0 ? [{ name: 'Paused', value: paused, color: COLORS.paused }] : []),
  ].filter((d) => d.value > 0);

  if (data.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center text-muted-foreground">
        No container data
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={100}
          paddingAngle={2}
          dataKey="value"
          label={({ name, value }) => `${name}: ${value}`}
        >
          {data.map((entry, index) => (
            <Cell key={index} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}
