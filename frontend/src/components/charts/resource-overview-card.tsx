import { memo, useMemo } from 'react';
import { Cpu, MemoryStick } from 'lucide-react';

export interface ResourceOverviewCardProps {
  endpoints: Array<{
    name: string;
    totalCpu: number;
    totalMemory: number;
  }>;
  isLoading?: boolean;
}

interface ResourceData {
  cpuPercent: number;
  memoryPercent: number;
}

export function computeResourceAggregates(
  endpoints: ResourceOverviewCardProps['endpoints'],
): ResourceData {
  if (!endpoints || endpoints.length === 0) {
    return { cpuPercent: 0, memoryPercent: 0 };
  }

  const totalCpu = endpoints.reduce((sum, ep) => sum + (ep.totalCpu ?? 0), 0);
  const totalMemory = endpoints.reduce((sum, ep) => sum + (ep.totalMemory ?? 0), 0);
  const count = endpoints.length;

  return {
    cpuPercent: count > 0 ? Math.round((totalCpu / count) * 100) / 100 : 0,
    memoryPercent: count > 0 ? Math.round((totalMemory / count) * 100) / 100 : 0,
  };
}

function ProgressBar({ percent, variant }: { percent: number; variant: 'cpu' | 'memory' }) {
  const clamped = Math.min(100, Math.max(0, percent));
  const gradient =
    variant === 'cpu'
      ? 'from-cyan-300 to-blue-400'
      : 'from-violet-300 to-purple-400';

  return (
    <div className="h-3 w-full overflow-hidden rounded-full bg-muted/50">
      <div
        className={`h-full bg-gradient-to-r ${gradient} transition-all duration-500`}
        style={{ width: `${clamped}%` }}
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      />
    </div>
  );
}

function SingleResourceCard({
  label,
  percent,
  variant,
  icon,
}: {
  label: string;
  percent: number;
  variant: 'cpu' | 'memory';
  icon: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-background/35 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="text-muted-foreground">{icon}</div>
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
        </div>
        <span className="text-2xl font-semibold tabular-nums">{percent}%</span>
      </div>
      <ProgressBar percent={percent} variant={variant} />
    </div>
  );
}

export const ResourceOverviewCard = memo(function ResourceOverviewCard({
  endpoints,
  isLoading,
}: ResourceOverviewCardProps) {
  const data = useMemo(() => computeResourceAggregates(endpoints), [endpoints]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="h-[88px] animate-pulse rounded-xl border border-border/60 bg-muted/30" />
        <div className="h-[88px] animate-pulse rounded-xl border border-border/60 bg-muted/30" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <SingleResourceCard
        label="Overall CPU Usage"
        percent={data.cpuPercent}
        variant="cpu"
        icon={<Cpu className="h-4 w-4" />}
      />
      <SingleResourceCard
        label="Overall Memory Usage"
        percent={data.memoryPercent}
        variant="memory"
        icon={<MemoryStick className="h-4 w-4" />}
      />
    </div>
  );
});
