import { memo } from 'react';
import { Cpu, MemoryStick } from 'lucide-react';

export interface Endpoint {
  name: string;
  totalCpu: number;
  totalMemory: number;
}

export interface ResourceOverviewCardProps {
  cpuPercent?: number;
  memoryPercent?: number;
  endpoints?: Endpoint[];
  isLoading?: boolean;
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
  cpuPercent,
  memoryPercent,
  endpoints,
  isLoading,
}: ResourceOverviewCardProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="h-[88px] animate-pulse rounded-xl border border-border/60 bg-muted/30" />
        <div className="h-[88px] animate-pulse rounded-xl border border-border/60 bg-muted/30" />
      </div>
    );
  }

  // If endpoints data is provided, show endpoint summary
  if (endpoints && endpoints.length > 0) {
    const totalCpu = endpoints.reduce((sum, ep) => sum + ep.totalCpu, 0);
    const totalMemory = endpoints.reduce((sum, ep) => sum + ep.totalMemory, 0);
    
    return (
      <div className="space-y-3">
        <div className="text-sm font-medium text-muted-foreground">
          Fleet Resources
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-background/35 p-4">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-cyan-400" />
              <span className="text-sm font-medium text-muted-foreground">Total CPU</span>
            </div>
            <span className="text-xl font-semibold">{totalCpu.toFixed(2)}</span>
            <span className="text-xs text-muted-foreground">cores</span>
          </div>
          <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-background/35 p-4">
            <div className="flex items-center gap-2">
              <MemoryStick className="h-4 w-4 text-violet-400" />
              <span className="text-sm font-medium text-muted-foreground">Total Memory</span>
            </div>
            <span className="text-xl font-semibold">{(totalMemory / 1024 / 1024 / 1024).toFixed(2)}</span>
            <span className="text-xs text-muted-foreground">GB</span>
          </div>
        </div>
      </div>
    );
  }

  // Fall back to percentage display if cpuPercent and memoryPercent are provided
  if (cpuPercent !== undefined && memoryPercent !== undefined) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SingleResourceCard
          label="Overall CPU Usage"
          percent={cpuPercent}
          variant="cpu"
          icon={<Cpu className="h-4 w-4" />}
        />
        <SingleResourceCard
          label="Overall Memory Usage"
          percent={memoryPercent}
          variant="memory"
          icon={<MemoryStick className="h-4 w-4" />}
        />
      </div>
    );
  }

  return null;
});
