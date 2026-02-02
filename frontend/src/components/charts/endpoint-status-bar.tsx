import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface EndpointData {
  name: string;
  running: number;
  stopped: number;
  unhealthy: number;
}

interface EndpointStatusBarProps {
  data: EndpointData[];
}

export function EndpointStatusBar({ data }: EndpointStatusBarProps) {
  if (!data.length) {
    return (
      <div className="flex h-[300px] items-center justify-center text-muted-foreground">
        No endpoint data
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip />
        <Legend />
        <Bar dataKey="running" name="Running" fill="#10b981" stackId="a" />
        <Bar dataKey="stopped" name="Stopped" fill="#ef4444" stackId="a" />
        <Bar dataKey="unhealthy" name="Unhealthy" fill="#f59e0b" stackId="a" />
      </BarChart>
    </ResponsiveContainer>
  );
}
