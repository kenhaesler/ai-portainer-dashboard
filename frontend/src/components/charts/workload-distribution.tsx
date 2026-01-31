import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface WorkloadData {
  endpoint: string;
  containers: number;
  running: number;
  stopped: number;
}

interface WorkloadDistributionProps {
  data: WorkloadData[];
}

export function WorkloadDistribution({ data }: WorkloadDistributionProps) {
  if (!data.length) {
    return (
      <div className="flex h-[300px] items-center justify-center text-muted-foreground">
        No workload data
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} layout="vertical" margin={{ top: 10, right: 30, left: 80, bottom: 0 }}>
        <XAxis type="number" tick={{ fontSize: 12 }} />
        <YAxis type="category" dataKey="endpoint" tick={{ fontSize: 12 }} width={80} />
        <Tooltip />
        <Legend />
        <Bar dataKey="running" name="Running" fill="#10b981" stackId="a" />
        <Bar dataKey="stopped" name="Stopped" fill="#ef4444" stackId="a" />
      </BarChart>
    </ResponsiveContainer>
  );
}
