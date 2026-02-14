import { memo, useMemo } from 'react';

export interface FleetSummaryCardProps {
  endpoints: Array<{
    name: string;
    running: number;
    stopped: number;
    total: number;
  }>;
  totalContainers: number;
  isLoading?: boolean;
}

interface FleetSummary {
  totalEndpoints: number;
  totalContainers: number;
  runningPct: number;
  stoppedPct: number;
  topContributors: Array<{ name: string; total: number; share: number }>;
}

export function computeFleetSummary(
  endpoints: FleetSummaryCardProps['endpoints'],
  totalContainers: number,
): FleetSummary {
  const totalRunning = endpoints.reduce((s, ep) => s + ep.running, 0);
  const total = totalContainers || endpoints.reduce((s, ep) => s + ep.total, 0);
  const runningPct = total > 0 ? Math.round((totalRunning / total) * 100) : 0;
  const stoppedPct = total > 0 ? 100 - runningPct : 0;

  const sorted = [...endpoints].sort((a, b) => b.total - a.total);
  const topContributors = sorted.slice(0, 3).map((ep) => ({
    name: ep.name,
    total: ep.total,
    share: total > 0 ? Math.round((ep.total / total) * 100) : 0,
  }));

  return {
    totalEndpoints: endpoints.length,
    totalContainers: total,
    runningPct,
    stoppedPct,
    topContributors,
  };
}

export const FleetSummaryCard = memo(function FleetSummaryCard({
  endpoints,
  totalContainers,
  isLoading,
}: FleetSummaryCardProps) {
  const summary = useMemo(
    () => computeFleetSummary(endpoints, totalContainers),
    [endpoints, totalContainers],
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stat pills */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-border/60 bg-background/35 p-3 text-center">
          <div className="text-2xl font-semibold">{summary.totalEndpoints}</div>
          <div className="text-[11px] text-muted-foreground">Endpoints</div>
        </div>
        <div className="rounded-xl border border-border/60 bg-background/35 p-3 text-center">
          <div className="text-2xl font-semibold">{summary.totalContainers}</div>
          <div className="text-[11px] text-muted-foreground">Containers</div>
        </div>
      </div>

      {/* Running / Stopped bar */}
      <div>
        <div className="mb-1.5 flex justify-between text-[11px]">
          <span className="text-emerald-400">{summary.runningPct}% running</span>
          <span className="text-red-400">{summary.stoppedPct}% stopped</span>
        </div>
        <div className="flex h-3 overflow-hidden rounded-full bg-muted/50">
          <div
            className="h-full bg-gradient-to-r from-emerald-300 to-emerald-400 transition-all duration-500"
            style={{ width: `${summary.runningPct}%` }}
          />
          <div
            className="h-full bg-gradient-to-r from-red-300 to-red-400 transition-all duration-500"
            style={{ width: `${summary.stoppedPct}%` }}
          />
        </div>
      </div>

      {/* Top 3 contributors */}
      {summary.topContributors.length > 0 && (
        <div>
          <h4 className="mb-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            Top Contributors
          </h4>
          <div className="space-y-2">
            {summary.topContributors.map((item) => (
              <div key={item.name} className="flex items-center gap-2 text-[11px]">
                <span className="w-[100px] truncate text-muted-foreground" title={item.name}>
                  {item.name}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted/50">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-blue-400"
                    style={{ width: `${Math.max(6, item.share)}%` }}
                  />
                </div>
                <span className="w-14 text-right text-muted-foreground">
                  {item.total} ({item.share}%)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
