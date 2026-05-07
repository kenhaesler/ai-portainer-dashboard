import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { X, BarChart3, GitCompareArrows, Info, Clock } from 'lucide-react';
import { type Container } from '@/features/containers/hooks/use-containers';
import { useComparisonMetrics, type ComparisonTarget } from '@/features/containers/hooks/use-container-comparison';
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

function SummaryTable({ containers }: { containers: Container[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="pb-2 pr-4 font-medium text-muted-foreground">Attribute</th>
            {containers.map((c, i) => (
              <th key={c.id} className="pb-2 pr-4 font-medium">
                <div className="flex items-center gap-2">
                  <div
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: COMPARISON_CHART_COLORS[i] }}
                  />
                  {c.name}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          <tr>
            <td className="py-2 pr-4 text-muted-foreground">State</td>
            {containers.map((c) => (
              <td key={c.id} className="py-2 pr-4">
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
              </td>
            ))}
          </tr>
          <tr>
            <td className="py-2 pr-4 text-muted-foreground">Status</td>
            {containers.map((c) => (
              <td key={c.id} className="py-2 pr-4">{c.status}</td>
            ))}
          </tr>
          <tr>
            <td className="py-2 pr-4 text-muted-foreground">Image</td>
            {containers.map((c) => (
              <td key={c.id} className="py-2 pr-4">
                <span className="font-mono text-xs">{c.image}</span>
              </td>
            ))}
          </tr>
          <tr>
            <td className="py-2 pr-4 text-muted-foreground">Endpoint</td>
            {containers.map((c) => (
              <td key={c.id} className="py-2 pr-4">{c.endpointName}</td>
            ))}
          </tr>
          <tr>
            <td className="py-2 pr-4 text-muted-foreground">Health</td>
            {containers.map((c) => (
              <td key={c.id} className="py-2 pr-4">
                {c.healthStatus ? (
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
                )}
              </td>
            ))}
          </tr>
          <tr>
            <td className="py-2 pr-4 text-muted-foreground">Networks</td>
            {containers.map((c) => (
              <td key={c.id} className="py-2 pr-4">
                {c.networks.length > 0
                  ? c.networks
                      .map((net) =>
                        c.networkIPs?.[net] ? `${net} (${c.networkIPs[net]})` : net,
                      )
                      .join(', ')
                  : '—'}
              </td>
            ))}
          </tr>
          <tr>
            <td className="py-2 pr-4 text-muted-foreground">Created</td>
            {containers.map((c) => (
              <td key={c.id} className="py-2 pr-4">
                {formatDate(new Date(c.created * 1000).toISOString())}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ConfigDiff({ containers }: { containers: Container[] }) {
  // Collect all unique label keys
  const allLabelKeys = Array.from(
    new Set(containers.flatMap((c) => Object.keys(c.labels))),
  ).sort();

  if (allLabelKeys.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        No labels to compare
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="pb-2 pr-4 font-medium text-muted-foreground">Label</th>
            {containers.map((c, i) => (
              <th key={c.id} className="pb-2 pr-4 font-medium">
                <div className="flex items-center gap-2">
                  <div
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: COMPARISON_CHART_COLORS[i] }}
                  />
                  {c.name}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {allLabelKeys.map((key) => {
            const values = containers.map((c) => c.labels[key] || '');
            const allSame = values.every((v) => v === values[0]);

            return (
              <tr key={key} className={allSame ? '' : 'bg-yellow-500/5'}>
                <td className="py-1.5 pr-4 font-mono text-xs text-muted-foreground">
                  {key}
                </td>
                {values.map((val, i) => (
                  <td
                    key={containers[i].id}
                    className={cn(
                      'py-1.5 pr-4 font-mono text-xs',
                      !allSame && val ? 'text-yellow-600 dark:text-yellow-400 font-medium' : '',
                    )}
                  >
                    {val || <span className="text-muted-foreground">—</span>}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
