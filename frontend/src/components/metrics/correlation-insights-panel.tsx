import { useMemo } from 'react';
import { Link2, Bot, ArrowUpDown, TrendingUp, TrendingDown } from 'lucide-react';
import { useCorrelations, useCorrelationInsights, type CorrelationPair } from '@/hooks/use-correlations';
import { cn } from '@/lib/utils';

interface CorrelationInsightsPanelProps {
  llmAvailable: boolean;
  hours?: number;
}

function strengthColor(pair: CorrelationPair): string {
  const absR = Math.abs(pair.correlation);
  if (absR >= 0.9) {
    return pair.direction === 'positive'
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-red-600 dark:text-red-400';
  }
  return pair.direction === 'positive'
    ? 'text-blue-600 dark:text-blue-400'
    : 'text-orange-600 dark:text-orange-400';
}

function strengthBg(pair: CorrelationPair): string {
  const absR = Math.abs(pair.correlation);
  if (absR >= 0.9) {
    return pair.direction === 'positive'
      ? 'bg-emerald-100 dark:bg-emerald-900/30'
      : 'bg-red-100 dark:bg-red-900/30';
  }
  return pair.direction === 'positive'
    ? 'bg-blue-100 dark:bg-blue-900/30'
    : 'bg-orange-100 dark:bg-orange-900/30';
}

function HeatmapGrid({ pairs }: { pairs: CorrelationPair[] }) {
  // Build unique container list and correlation map
  const { containers, matrix } = useMemo(() => {
    const nameSet = new Set<string>();
    for (const p of pairs) {
      nameSet.add(p.containerA.name);
      nameSet.add(p.containerB.name);
    }
    const containers = [...nameSet].sort();
    const matrix = new Map<string, number>();
    for (const p of pairs) {
      const keyAB = `${p.containerA.name}:${p.containerB.name}:${p.metricType}`;
      const keyBA = `${p.containerB.name}:${p.containerA.name}:${p.metricType}`;
      matrix.set(keyAB, p.correlation);
      matrix.set(keyBA, p.correlation);
    }
    return { containers, matrix };
  }, [pairs]);

  if (containers.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="text-xs" data-testid="correlation-heatmap">
        <thead>
          <tr>
            <th className="px-1 py-1 text-left font-normal text-muted-foreground" />
            {containers.map((name) => (
              <th key={name} className="px-1 py-1 font-normal text-muted-foreground truncate max-w-[80px]" title={name}>
                {name.length > 10 ? name.slice(0, 10) + '…' : name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {containers.map((rowName) => (
            <tr key={rowName}>
              <td className="px-1 py-1 text-muted-foreground truncate max-w-[80px] font-medium" title={rowName}>
                {rowName.length > 10 ? rowName.slice(0, 10) + '…' : rowName}
              </td>
              {containers.map((colName) => {
                if (rowName === colName) {
                  return (
                    <td key={colName} className="px-1 py-1">
                      <div className="h-6 w-6 rounded bg-muted/50 flex items-center justify-center text-[10px] text-muted-foreground">
                        —
                      </div>
                    </td>
                  );
                }
                // Check both cpu and memory
                const cpuR = matrix.get(`${rowName}:${colName}:cpu`);
                const memR = matrix.get(`${rowName}:${colName}:memory`);
                const r = cpuR ?? memR;
                if (r === undefined) {
                  return (
                    <td key={colName} className="px-1 py-1">
                      <div className="h-6 w-6 rounded bg-muted/20 flex items-center justify-center text-[10px] text-muted-foreground">
                        ·
                      </div>
                    </td>
                  );
                }
                const absR = Math.abs(r);
                const opacity = Math.max(0.3, absR);
                const bgColor = r > 0 ? `rgba(16,185,129,${opacity})` : `rgba(239,68,68,${opacity})`;
                return (
                  <td key={colName} className="px-1 py-1">
                    <div
                      className="h-6 w-6 rounded flex items-center justify-center text-[10px] font-medium text-white"
                      style={{ backgroundColor: bgColor }}
                      title={`${rowName} ↔ ${colName}: r=${r.toFixed(2)}`}
                    >
                      {r.toFixed(1)}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CorrelationInsightsPanel({ llmAvailable, hours = 24 }: CorrelationInsightsPanelProps) {
  const { data: correlationsData, isLoading: pairsLoading } = useCorrelations(hours);
  const { data: insightsData, isLoading: insightsLoading } = useCorrelationInsights(hours, llmAvailable);

  const pairs = correlationsData?.pairs ?? [];
  const insights = insightsData?.insights ?? [];
  const summary = insightsData?.summary ?? null;

  // Build a map from pair key to narrative
  const narrativeMap = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const insight of insights) {
      map.set(`${insight.containerA}:${insight.containerB}:${insight.metricType}`, insight.narrative);
    }
    return map;
  }, [insights]);

  if (pairsLoading) {
    return (
      <div className="rounded-lg border bg-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Link2 className="h-5 w-5 text-blue-500" />
          <h3 className="text-lg font-semibold">Cross-Container Correlation Insights</h3>
        </div>
        <div className="space-y-3">
          <div className="h-16 animate-pulse rounded bg-muted" />
          <div className="h-16 animate-pulse rounded bg-muted" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Link2 className="h-5 w-5 text-blue-500" />
          <div>
            <h3 className="text-lg font-semibold">Cross-Container Correlation Insights</h3>
            <p className="text-xs text-muted-foreground">
              Detected relationships (last {hours}h) — |r| ≥ 0.7
            </p>
          </div>
        </div>
        {pairs.length > 0 && (
          <span className="rounded-full border border-border/60 bg-background/50 px-2.5 py-1 text-xs text-muted-foreground">
            {pairs.length} correlated {pairs.length === 1 ? 'pair' : 'pairs'}
          </span>
        )}
      </div>

      {pairs.length === 0 ? (
        <div className="flex h-[120px] items-center justify-center rounded-lg border border-dashed bg-muted/20 p-6 text-center">
          <div>
            <ArrowUpDown className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 font-medium">No strong correlations detected</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Correlations appear when containers share workload patterns over time.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Correlation pair cards */}
          <div className="space-y-3">
            {pairs.slice(0, 10).map((pair) => {
              const narrative = narrativeMap.get(
                `${pair.containerA.name}:${pair.containerB.name}:${pair.metricType}`,
              );
              const DirectionIcon = pair.direction === 'positive' ? TrendingUp : TrendingDown;

              return (
                <div
                  key={`${pair.containerA.id}-${pair.containerB.id}-${pair.metricType}`}
                  className="rounded-md border border-border/60 bg-background/50 px-4 py-3"
                >
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{pair.containerA.name}</span>
                    <span className="text-muted-foreground">↔</span>
                    <span className="font-medium">{pair.containerB.name}</span>
                    <span className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                      strengthBg(pair),
                      strengthColor(pair),
                    )}>
                      <DirectionIcon className="h-3 w-3" />
                      r = {pair.correlation.toFixed(2)}
                    </span>
                    <span className="rounded-full border border-border/40 px-2 py-0.5 text-xs text-muted-foreground uppercase">
                      {pair.metricType}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      ({pair.sampleCount} samples)
                    </span>
                  </div>

                  {/* AI narrative */}
                  {llmAvailable && (
                    <div className="mt-2">
                      {insightsLoading ? (
                        <div className="h-5 animate-pulse rounded bg-muted" />
                      ) : narrative ? (
                        <p className="text-xs leading-relaxed text-foreground/80">
                          <Bot className="inline h-3 w-3 text-purple-500 mr-1" />
                          {narrative}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">
                          <Bot className="inline h-3 w-3 text-purple-500/50 mr-1" />
                          Insight unavailable
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Heatmap grid */}
          {pairs.length > 1 && (
            <div className="rounded-md border border-border/40 bg-muted/10 p-3">
              <h4 className="text-xs font-medium text-muted-foreground mb-2">Correlation Heatmap</h4>
              <HeatmapGrid pairs={pairs} />
            </div>
          )}

          {/* AI Summary */}
          {llmAvailable && summary && (
            <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <Bot className="h-3.5 w-3.5 text-purple-500" />
                <span className="text-xs font-medium text-muted-foreground">Fleet Summary</span>
              </div>
              <p className="text-xs leading-relaxed text-foreground/80">{summary}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
