import { memo, useMemo } from 'react';
import { Link2, Bot, ArrowUpDown, TrendingUp, TrendingDown, Info } from 'lucide-react';
import {
  useCorrelations,
  useCorrelationInsights,
  correlationPairKey,
  type CorrelationPair,
} from '@/features/observability/hooks/use-correlations';
import { cn } from '@/shared/lib/utils';
import { SpotlightCard } from '@/shared/components/data-display/spotlight-card';
import { EmptyState } from '@/shared/components/feedback/empty-state';

interface CorrelationInsightsPanelProps {
  llmAvailable: boolean;
  hours?: number;
  selectedContainerId?: string | null;
}

/**
 * Badge colour keyed to |r| — never to its sign.
 *
 * This palette reads green as "healthy" and red as "error", so painting
 * `r = -0.99` red asserted that the pair was broken. A strong negative
 * correlation is neither bad news nor good news, only strong. Colour now
 * carries strength alone: direction is on the TrendingUp/TrendingDown glyph
 * inside the same badge, and the sign is printed in the coefficient beside it.
 */
function strengthClasses(pair: CorrelationPair): string {
  return Math.abs(pair.correlation) >= 0.9
    ? 'bg-primary/15 text-primary'
    : 'bg-muted text-muted-foreground';
}

const AXIS_LABEL_BOUNDARIES = new Set(['-', '_', '.']);

/**
 * Longest prefix shared by every label, trimmed back to a `-`/`_`/`.` boundary
 * so a word is never cut in half. Empty when the labels share nothing useful
 * (fewer than two labels, no common prefix, or one label *is* the prefix).
 */
export function commonAxisPrefix(names: string[]): string {
  if (names.length < 2) return '';
  let prefix = names[0];
  for (const name of names.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < name.length && prefix[i] === name[i]) i += 1;
    prefix = prefix.slice(0, i);
    if (!prefix) return '';
  }
  let boundary = -1;
  for (let i = prefix.length - 1; i >= 0; i -= 1) {
    if (AXIS_LABEL_BOUNDARIES.has(prefix[i])) {
      boundary = i;
      break;
    }
  }
  if (boundary < 0) return '';
  const trimmed = prefix.slice(0, boundary + 1);
  // Stripping must leave every label with something to read.
  return names.every((name) => name.length > trimmed.length) ? trimmed : '';
}

/**
 * Axis labels for the heatmap, shortened without deleting what distinguishes
 * them. Every container in a compose fleet shares a project prefix, so the old
 * `slice(0, 10) + '…'` turned six of twelve columns into "container-…". Strip
 * the shared prefix first, then — if a name is still too long — drop characters
 * from the LEFT and keep the tail, which is where the instance number lives.
 * The full name stays in the cell's `title`.
 */
export function shortenAxisLabels(names: string[], maxLength = 12): Map<string, string> {
  const prefix = commonAxisPrefix(names);
  const labels = new Map<string, string>();
  for (const name of names) {
    const stripped = prefix ? name.slice(prefix.length) : name;
    labels.set(
      name,
      stripped.length > maxLength ? `…${stripped.slice(stripped.length - maxLength)}` : stripped,
    );
  }
  return labels;
}

/**
 * Cell fill keyed to |r| on a single ramp of the theme's primary token. It used
 * to be green for a positive r and red for a negative one — status colours for
 * a non-status quantity. The signed value is printed in the cell, so the fill
 * only needs to carry strength.
 */
function heatmapCellStyle(r: number): { backgroundColor: string } {
  const absR = Math.min(1, Math.abs(r));
  const mix = Math.round(8 + absR * 37);
  return { backgroundColor: `color-mix(in srgb, var(--color-primary) ${mix}%, transparent)` };
}

function HeatmapGrid({ pairs }: { pairs: CorrelationPair[] }) {
  // Build unique container list and correlation map
  const { containers, matrix, labels, strippedPrefix } = useMemo(() => {
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
    return {
      containers,
      matrix,
      labels: shortenAxisLabels(containers),
      strippedPrefix: commonAxisPrefix(containers),
    };
  }, [pairs]);

  if (containers.length === 0) return null;

  return (
    <div className="space-y-2">
      {strippedPrefix && (
        <p className="text-[11px] text-muted-foreground" data-testid="heatmap-prefix-note">
          Shared prefix <span className="font-mono">{strippedPrefix}</span> removed from axis labels.
        </p>
      )}
      <div className="overflow-x-auto">
      <table className="text-xs" data-testid="correlation-heatmap">
        <thead>
          <tr>
            <th className="px-1 py-1 text-left font-normal text-muted-foreground" />
            {containers.map((name) => (
              <th key={name} className="px-1 py-1 font-normal text-muted-foreground whitespace-nowrap" title={name}>
                {labels.get(name)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {containers.map((rowName) => (
            <tr key={rowName}>
              <td className="px-1 py-1 text-muted-foreground whitespace-nowrap font-medium" title={rowName}>
                {labels.get(rowName)}
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
                return (
                  <td key={colName} className="px-1 py-1">
                    <div
                      className="h-6 w-6 rounded flex items-center justify-center text-[10px] font-medium text-foreground"
                      style={heatmapCellStyle(r)}
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
    </div>
  );
}

export const CorrelationInsightsPanel = memo(function CorrelationInsightsPanel({ llmAvailable, hours = 24, selectedContainerId }: CorrelationInsightsPanelProps) {
  const { data: correlationsData, isLoading: pairsLoading } = useCorrelations(hours);
  const { data: insightsData, isLoading: insightsLoading } = useCorrelationInsights(hours, llmAvailable);

  const allPairs = correlationsData?.pairs ?? [];
  const insights = insightsData?.insights ?? [];

  // Filter to pairs involving the selected container (if any)
  const pairs = useMemo(() => {
    if (!selectedContainerId) return allPairs;
    return allPairs.filter(
      (p) => p.containerA.id === selectedContainerId || p.containerB.id === selectedContainerId,
    );
  }, [allPairs, selectedContainerId]);
  const summary = insightsData?.summary ?? null;
  const narrativeStatus = insightsData?.narrativeStatus ?? 'ok';
  const narrativeUnavailableReason = insightsData?.narrativeUnavailableReason ?? null;

  // Keyed by the server's `pairKey`, not by array position. Both sides slice
  // their own top-10 — the server from the unfiltered list, this panel from a
  // list that may be filtered to one container — so position is not a safe
  // join key and silently mismatched narratives were possible.
  const narrativeMap = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const insight of insights) {
      // Prefer the server-supplied key — it is what stops this list and the
      // route's own top-N from drifting apart when a container filter is
      // active. Fall back to deriving it so a payload from an older backend
      // degrades to "narratives still shown" rather than "every narrative
      // silently missing".
      const key =
        insight.pairKey ??
        correlationPairKey(insight.containerA, insight.containerB, insight.metricType);
      map.set(key, insight.narrative);
    }
    return map;
  }, [insights]);

  if (pairsLoading) {
    return (
      <SpotlightCard>
      <div className="rounded-lg border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Link2 className="h-5 w-5 text-blue-500" />
          <h3 className="text-lg font-semibold">Cross-Container Correlation Insights</h3>
        </div>
        <div className="space-y-3">
          <div className="h-16 animate-pulse rounded bg-muted" />
          <div className="h-16 animate-pulse rounded bg-muted" />
        </div>
      </div>
      </SpotlightCard>
    );
  }

  return (
    <SpotlightCard>
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Link2 className="h-5 w-5 text-blue-500" />
          <div>
            <h3 className="text-lg font-semibold">Cross-Container Correlation Insights</h3>
            <p className="text-xs text-muted-foreground">
              {selectedContainerId
                ? `Relationships for selected container (last ${hours}h) — |r| ≥ 0.7`
                : `Detected relationships (last ${hours}h) — |r| ≥ 0.7`}
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
        <EmptyState
          icon={ArrowUpDown}
          title="No strong correlations detected"
          description="Correlations appear when containers share workload patterns over time."
        />
      ) : (
        <div className="space-y-4">
          {/* Why the narratives are missing — said once, above the list, rather
              than as an italic failure repeated on every row. The correlation
              values are computed from metrics and stand on their own, so the
              panel stays useful when the model does not answer. */}
          {llmAvailable && !insightsLoading && narrativeUnavailableReason && (
            <div
              role="status"
              data-testid="narrative-unavailable-reason"
              data-narrative-status={narrativeStatus}
              className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
            >
              <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />
              <span>{narrativeUnavailableReason}</span>
            </div>
          )}

          {/* Correlation pair cards */}
          <div className="space-y-3">
            {pairs.slice(0, 10).map((pair) => {
              const narrative = narrativeMap.get(
                correlationPairKey(pair.containerA.name, pair.containerB.name, pair.metricType),
              );
              const DirectionIcon = pair.direction === 'positive' ? TrendingUp : TrendingDown;

              return (
                <div
                  key={`${pair.containerA.id}-${pair.containerB.id}-${pair.metricType}`}
                  className="rounded-md border border-border/60 bg-background/50 px-4 py-3"
                >
                  {/* Two deliberate lines — the pair, then its measurements.
                      As one flex-wrap run of six children this collapsed to
                      three ragged lines at tablet width, where the persistent
                      sidebar takes ~28% of the viewport. */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <span className="font-medium break-all">{pair.containerA.name}</span>
                    <span className="text-muted-foreground" aria-hidden>↔</span>
                    <span className="font-medium break-all">{pair.containerB.name}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                      strengthClasses(pair),
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

                  {/* AI narrative — omitted entirely when absent. A row with no
                      narrative shows the correlation alone; the banner above
                      already explains why, once. */}
                  {llmAvailable && (insightsLoading || narrative) && (
                    <div className="mt-2">
                      {insightsLoading ? (
                        <div className="h-5 animate-pulse rounded bg-muted" />
                      ) : (
                        <p className="text-xs leading-relaxed text-foreground/80">
                          <Bot className="inline h-3 w-3 text-purple-500 mr-1" />
                          {narrative}
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
    </SpotlightCard>
  );
});
