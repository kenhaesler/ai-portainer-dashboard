import { useMemo, type ReactNode } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { type ColumnDef } from '@tanstack/react-table';
import { X, BarChart3, GitCompareArrows, Info, Clock } from 'lucide-react';
import { type Container } from '@/features/containers/hooks/use-containers';
import { useComparisonMetrics, type ComparisonTarget } from '@/features/containers/hooks/use-container-comparison';
import { DataTable } from '@/shared/components/tables/data-table';
import { formatDate, cn } from '@/shared/lib/utils';

export const COMPARISON_CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];
export const COMPARISON_TIME_RANGES = ['15m', '1h', '6h', '24h', '7d'] as const;
export type ComparisonTab = 'metrics' | 'config' | 'summary';

export interface ContainerComparisonViewProps {
  containers: Container[];
  tab: ComparisonTab;
  onTabChange: (tab: ComparisonTab) => void;
  timeRange: string;
  onTimeRangeChange: (range: string) => void;
  onRemove: (target: { endpointId: number; containerId: string }) => void;
}

// ─── Pill row (extracted from the old ContainerSelector, minus the picker) ──
//
// Visual changes from the original selector pills (intentional):
//   - Container name uses font-mono (matches the rest of the UI's
//     treatment of container identifiers, e.g. the table column).
//   - Endpoint name shown as small muted text — disambiguates the
//     same container name appearing on different endpoints.
//   - No color dot; the per-pill border-color carries the chart-line
//     mapping for that container.

function ContainerPills({
  containers,
  onRemove,
}: {
  containers: Container[];
  onRemove: (target: { endpointId: number; containerId: string }) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" data-testid="comparison-pills">
      {containers.map((c, i) => (
        <div
          key={c.id}
          className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm"
          style={{ borderColor: COMPARISON_CHART_COLORS[i % COMPARISON_CHART_COLORS.length] }}
        >
          <span className="font-mono">{c.name}</span>
          <span className="text-xs text-muted-foreground">{c.endpointName}</span>
          <button
            type="button"
            onClick={() => onRemove({ endpointId: c.endpointId, containerId: c.id })}
            aria-label={`Remove ${c.name} from comparison`}
            className="rounded-full p-0.5 text-muted-foreground hover:bg-muted"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

function ComparisonChart({
  targets,
  metricType,
  timeRange,
  label,
  unit,
}: {
  targets: ComparisonTarget[];
  metricType: string;
  timeRange: string;
  label: string;
  unit: string;
}) {
  const { data, isLoading } = useComparisonMetrics(targets, metricType, timeRange);

  // Merge all time series by timestamp
  const merged = useMemo(() => {
    const timeMap = new Map<string, Record<string, number>>();

    data.forEach(({ target, metrics }) => {
      metrics?.data.forEach((point) => {
        const existing = timeMap.get(point.timestamp) || {};
        existing[target.containerId] = point.value;
        timeMap.set(point.timestamp, existing);
      });
    });

    return Array.from(timeMap.entries())
      .map(([timestamp, values]) => ({ timestamp, ...values }))
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex h-[300px] items-center justify-center text-muted-foreground">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
      </div>
    );
  }

  if (merged.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center text-muted-foreground">
        No {label.toLowerCase()} data available for the selected time range
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={merged} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
        <XAxis
          dataKey="timestamp"
          tick={{ fontSize: 11 }}
          tickFormatter={(v) => formatDate(v)}
        />
        <YAxis
          tick={{ fontSize: 11 }}
          tickFormatter={(v) => `${v}${unit}`}
        />
        <Tooltip
          labelFormatter={(v) => formatDate(v as string)}
          formatter={(value, name) => {
            const numericValue = typeof value === 'number' ? value : Number(value ?? 0);
            const seriesName = typeof name === 'string' ? name : String(name ?? '');
            const target = targets.find((t) => t.containerId === seriesName);
            return [`${numericValue.toFixed(1)}${unit}`, target?.name || seriesName];
          }}
        />
        <Legend
          formatter={(value: string) => {
            const target = targets.find((t) => t.containerId === value);
            return target?.name || value;
          }}
        />
        {targets.map((target, i) => (
          <Line
            key={target.containerId}
            type="monotone"
            dataKey={target.containerId}
            name={target.containerId}
            stroke={COMPARISON_CHART_COLORS[i]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── Comparison matrices on the shared DataTable ────────────────────────────
//
// These two views are comparison MATRICES, not paginated lists: rows are
// metric/config KEYS and columns are the compared CONTAINERS (dynamic). To run
// them through the shared DataTable we transpose the data — one row object per
// attribute/label key, one dynamic column per container (keyed by container id)
// plus a leading "label" column. We omit `autoFit` (these are bounded matrices
// inside a comparison view, not a viewport-filling list) and pass `windowScroll`
// so every row stays visible at once, matching the original always-show-all
// behavior. Sorting is disabled on every column — reordering metric rows or
// container columns would be meaningless here.
//
// Tradeoff: DataTable renders a uniform `<tr>` and exposes no per-row className
// hook, so ConfigDiff's "values differ" highlight (previously a row-level
// `bg-yellow-500/5`) is reproduced at the cell level instead (each cell in a
// differing row carries the tint). The visual intent — flagging label rows that
// diverge across containers — is preserved.

/** A header cell carrying the chart-line color dot + the container name. */
function containerColumnHeader(container: Container, index: number): ReactNode {
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: COMPARISON_CHART_COLORS[index] }}
      />
      {container.name}
    </div>
  );
}

interface SummaryRow {
  /** Stable row identity — the attribute name. */
  attribute: string;
  /** Cell renderer per compared container, keyed by container id. */
  cells: Record<string, ReactNode>;
}

function SummaryTable({ containers }: { containers: Container[] }) {
  const rows = useMemo<SummaryRow[]>(() => {
    const cellsFor = (render: (c: Container) => ReactNode): Record<string, ReactNode> =>
      Object.fromEntries(containers.map((c) => [c.id, render(c)]));

    return [
      {
        attribute: 'State',
        cells: cellsFor((c) => (
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs font-medium',
              c.state === 'running'
                ? 'bg-emerald-500/10 text-emerald-500'
                : c.state === 'exited'
                  ? 'bg-red-500/10 text-red-500'
                  : 'bg-gray-500/10 text-gray-500',
            )}
          >
            {c.state}
          </span>
        )),
      },
      { attribute: 'Status', cells: cellsFor((c) => c.status) },
      {
        attribute: 'Image',
        cells: cellsFor((c) => <span className="font-mono text-xs">{c.image}</span>),
      },
      { attribute: 'Endpoint', cells: cellsFor((c) => c.endpointName) },
      {
        attribute: 'Health',
        cells: cellsFor((c) =>
          c.healthStatus ? (
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-xs font-medium',
                c.healthStatus === 'healthy'
                  ? 'bg-emerald-500/10 text-emerald-500'
                  : 'bg-red-500/10 text-red-500',
              )}
            >
              {c.healthStatus}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
        ),
      },
      {
        attribute: 'Networks',
        cells: cellsFor((c) =>
          c.networks.length > 0
            ? c.networks
                .map((net) => (c.networkIPs?.[net] ? `${net} (${c.networkIPs[net]})` : net))
                .join(', ')
            : '—',
        ),
      },
      {
        attribute: 'Created',
        cells: cellsFor((c) => formatDate(new Date(c.created * 1000).toISOString())),
      },
    ];
  }, [containers]);

  const columns = useMemo<ColumnDef<SummaryRow, unknown>[]>(() => {
    const attributeColumn: ColumnDef<SummaryRow, unknown> = {
      id: 'attribute',
      header: 'Attribute',
      enableSorting: false,
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.attribute}</span>,
    };

    const containerColumns: ColumnDef<SummaryRow, unknown>[] = containers.map((c, i) => ({
      id: c.id,
      header: () => containerColumnHeader(c, i),
      enableSorting: false,
      cell: ({ row }) => row.original.cells[c.id] ?? null,
    }));

    return [attributeColumn, ...containerColumns];
  }, [containers]);

  return (
    <DataTable
      columns={columns}
      data={rows}
      hideSearch
      windowScroll
      getRowId={(row) => row.attribute}
    />
  );
}

interface ConfigRow {
  /** Stable row identity — the label key. */
  label: string;
  /** Raw label value per compared container, keyed by container id. */
  values: Record<string, string>;
  /** True when every compared container shares the same value for this key. */
  allSame: boolean;
}

function ConfigDiff({ containers }: { containers: Container[] }) {
  // Collect all unique label keys
  const allLabelKeys = useMemo(
    () => Array.from(new Set(containers.flatMap((c) => Object.keys(c.labels)))).sort(),
    [containers],
  );

  const rows = useMemo<ConfigRow[]>(
    () =>
      allLabelKeys.map((key) => {
        const values = Object.fromEntries(containers.map((c) => [c.id, c.labels[key] || '']));
        const valueList = containers.map((c) => values[c.id]);
        const allSame = valueList.every((v) => v === valueList[0]);
        return { label: key, values, allSame };
      }),
    [allLabelKeys, containers],
  );

  const columns = useMemo<ColumnDef<ConfigRow, unknown>[]>(() => {
    const labelColumn: ColumnDef<ConfigRow, unknown> = {
      id: 'label',
      header: 'Label',
      enableSorting: false,
      // The "values differ" highlight lived on the row in the old markup;
      // DataTable has no per-row className hook, so it's tinted per-cell here.
      cell: ({ row }) => (
        <span
          className={cn(
            'font-mono text-xs text-muted-foreground',
            !row.original.allSame && 'bg-yellow-500/5',
          )}
        >
          {row.original.label}
        </span>
      ),
    };

    const containerColumns: ColumnDef<ConfigRow, unknown>[] = containers.map((c, i) => ({
      id: c.id,
      header: () => containerColumnHeader(c, i),
      enableSorting: false,
      cell: ({ row }) => {
        const val = row.original.values[c.id];
        const highlight = !row.original.allSame;
        return (
          <span
            className={cn(
              'font-mono text-xs',
              highlight && 'bg-yellow-500/5',
              highlight && val && 'font-medium text-yellow-600 dark:text-yellow-400',
            )}
          >
            {val || <span className="text-muted-foreground">—</span>}
          </span>
        );
      },
    }));

    return [labelColumn, ...containerColumns];
  }, [containers]);

  if (allLabelKeys.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        No labels to compare
      </div>
    );
  }

  return (
    <DataTable
      columns={columns}
      data={rows}
      hideSearch
      windowScroll
      getRowId={(row) => row.label}
    />
  );
}

// Tabs metadata
const TABS: Array<{ key: ComparisonTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: 'metrics', label: 'Metrics', icon: BarChart3 },
  { key: 'config', label: 'Configuration', icon: GitCompareArrows },
  { key: 'summary', label: 'Summary', icon: Info },
];

export function ContainerComparisonView({
  containers,
  tab,
  onTabChange,
  timeRange,
  onTimeRangeChange,
  onRemove,
}: ContainerComparisonViewProps) {
  const targets: ComparisonTarget[] = useMemo(
    () => containers.map((c) => ({ containerId: c.id, endpointId: c.endpointId, name: c.name })),
    [containers],
  );

  return (
    <div className="space-y-4">
      <ContainerPills containers={containers} onRemove={onRemove} />

      <div className="flex items-center justify-between">
        <div className="flex gap-1 rounded-lg border p-1">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => onTabChange(key)}
              aria-pressed={tab === key}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                tab === key
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {tab === 'metrics' && (
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <div className="flex gap-1 rounded-lg border p-1">
              {COMPARISON_TIME_RANGES.map((tr) => (
                <button
                  key={tr}
                  type="button"
                  onClick={() => onTimeRangeChange(tr)}
                  aria-pressed={timeRange === tr}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                    timeRange === tr
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {tr}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {tab === 'metrics' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-lg border bg-card p-4">
            <h3 className="mb-3 text-sm font-medium">CPU Usage</h3>
            <ComparisonChart targets={targets} metricType="cpu" timeRange={timeRange} label="CPU" unit="%" />
          </div>
          <div className="rounded-lg border bg-card p-4">
            <h3 className="mb-3 text-sm font-medium">Memory Usage</h3>
            <ComparisonChart targets={targets} metricType="memory" timeRange={timeRange} label="Memory" unit="%" />
          </div>
        </div>
      )}

      {tab === 'config' && (
        <div className="rounded-lg border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium">Label Comparison</h3>
          <ConfigDiff containers={containers} />
        </div>
      )}

      {tab === 'summary' && (
        <div className="rounded-lg border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium">Status Summary</h3>
          <SummaryTable containers={containers} />
        </div>
      )}
    </div>
  );
}
