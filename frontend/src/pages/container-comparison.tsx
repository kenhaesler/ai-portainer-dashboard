import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Plus, X, GitCompareArrows, BarChart3, Info, Clock } from 'lucide-react';
import { useContainers, Container } from '@/hooks/use-containers';
import { useComparisonMetrics, ComparisonTarget } from '@/hooks/use-container-comparison';
import { formatDate, cn } from '@/lib/utils';
import { AutoRefreshToggle } from '@/components/shared/auto-refresh-toggle';
import { RefreshButton } from '@/components/shared/refresh-button';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import { useForceRefresh } from '@/hooks/use-force-refresh';

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];
const TIME_RANGES = ['15m', '1h', '6h', '24h', '7d'] as const;
const MAX_CONTAINERS = 4;

function ContainerSelector({
  containers,
  selected,
  onAdd,
  onRemove,
}: {
  containers: Container[];
  selected: ComparisonTarget[];
  onAdd: (c: Container) => void;
  onRemove: (containerId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const selectedIds = new Set(selected.map((s) => s.containerId));
    const lowerSearch = search.toLowerCase();
    return containers.filter(
      (c) =>
        !selectedIds.has(c.id) &&
        (c.name.toLowerCase().includes(lowerSearch) ||
          c.image.toLowerCase().includes(lowerSearch) ||
          c.endpointName.toLowerCase().includes(lowerSearch)),
    );
  }, [containers, selected, search]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {selected.map((target, i) => (
          <div
            key={target.containerId}
            className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm"
            style={{ borderColor: CHART_COLORS[i] }}
          >
            <div
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: CHART_COLORS[i] }}
            />
            <span className="font-medium">{target.name}</span>
            <button
              onClick={() => onRemove(target.containerId)}
              className="ml-1 rounded p-0.5 hover:bg-muted"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}

        {selected.length < MAX_CONTAINERS && (
          <div className="relative">
            <button
              onClick={() => setOpen(!open)}
              className="flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-1.5 text-sm text-muted-foreground hover:border-primary hover:text-foreground transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Add container
            </button>

            {open && (
              <div className="absolute left-0 top-full z-50 mt-1 w-80 rounded-lg border bg-popover shadow-lg">
                <div className="p-2">
                  <input
                    type="text"
                    placeholder="Search containers..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full rounded-md border bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary"
                    autoFocus
                  />
                </div>
                <ul className="max-h-48 overflow-y-auto p-1">
                  {filtered.length === 0 ? (
                    <li className="px-3 py-2 text-sm text-muted-foreground">
                      No containers found
                    </li>
                  ) : (
                    filtered.slice(0, 20).map((c) => (
                      <li key={c.id}>
                        <button
                          onClick={() => {
                            onAdd(c);
                            setOpen(false);
                            setSearch('');
                          }}
                          className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-accent text-left"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="truncate font-medium">{c.name}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {c.image} &middot; {c.endpointName}
                            </div>
                          </div>
                          <span
                            className={cn(
                              'shrink-0 rounded-full px-1.5 py-0.5 text-xs',
                              c.state === 'running'
                                ? 'bg-emerald-500/10 text-emerald-500'
                                : 'bg-gray-500/10 text-gray-500',
                            )}
                          >
                            {c.state}
                          </span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {selected.length < 2 && (
        <p className="text-sm text-muted-foreground flex items-center gap-1.5">
          <Info className="h-3.5 w-3.5" />
          Select at least 2 containers to compare (max {MAX_CONTAINERS})
        </p>
      )}
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
          formatter={(value: number | undefined, name: string) => {
            const target = targets.find((t) => t.containerId === name);
            return [`${(value ?? 0).toFixed(1)}${unit}`, target?.name || name];
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
            stroke={CHART_COLORS[i]}
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
                    style={{ backgroundColor: CHART_COLORS[i] }}
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
                    style={{ backgroundColor: CHART_COLORS[i] }}
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

export default function ContainerComparison() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<'metrics' | 'config' | 'summary'>('metrics');
  const [timeRange, setTimeRange] = useState<string>('1h');
  const { interval, setInterval } = useAutoRefresh(30);

  const { data: allContainers = [], isFetching, refetch } = useContainers();
  const { forceRefresh, isForceRefreshing } = useForceRefresh('containers', refetch);

  // Parse selected containers from URL params
  const selected = useMemo<ComparisonTarget[]>(() => {
    const ids = searchParams.get('containers')?.split(',').filter(Boolean) || [];
    return ids
      .map((encoded) => {
        const [endpointId, containerId] = encoded.split(':');
        const container = allContainers.find((c) => c.id === containerId);
        return container
          ? { containerId: container.id, endpointId: Number(endpointId), name: container.name }
          : null;
      })
      .filter((t): t is ComparisonTarget => t !== null)
      .slice(0, MAX_CONTAINERS);
  }, [searchParams, allContainers]);

  const selectedContainers = useMemo(
    () =>
      selected
        .map((t) => allContainers.find((c) => c.id === t.containerId))
        .filter((c): c is Container => c !== undefined),
    [selected, allContainers],
  );

  function updateUrl(targets: ComparisonTarget[]) {
    const param = targets.map((t) => `${t.endpointId}:${t.containerId}`).join(',');
    setSearchParams(param ? { containers: param } : {});
  }

  function handleAdd(c: Container) {
    const newTarget: ComparisonTarget = {
      containerId: c.id,
      endpointId: c.endpointId,
      name: c.name,
    };
    updateUrl([...selected, newTarget]);
  }

  function handleRemove(containerId: string) {
    updateUrl(selected.filter((t) => t.containerId !== containerId));
  }

  const tabs = [
    { key: 'metrics' as const, label: 'Metrics', icon: BarChart3 },
    { key: 'config' as const, label: 'Configuration', icon: GitCompareArrows },
    { key: 'summary' as const, label: 'Summary', icon: Info },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Container Comparison</h1>
          <p className="text-muted-foreground">
            Compare metrics, configuration, and status across containers
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoRefreshToggle interval={interval} onIntervalChange={setInterval} />
          <RefreshButton
            onClick={() => refetch()}
            onForceRefresh={forceRefresh}
            isLoading={isFetching || isForceRefreshing}
          />
        </div>
      </div>

      {/* Container Selector */}
      <div className="rounded-lg border bg-card p-4">
        <ContainerSelector
          containers={allContainers}
          selected={selected}
          onAdd={handleAdd}
          onRemove={handleRemove}
        />
      </div>

      {/* Tabs & Content */}
      {selected.length >= 2 && (
        <>
          <div className="flex items-center justify-between">
            <div className="flex gap-1 rounded-lg border p-1">
              {tabs.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
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
                  {TIME_RANGES.map((tr) => (
                    <button
                      key={tr}
                      onClick={() => setTimeRange(tr)}
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

          {/* Tab Content */}
          {tab === 'metrics' && (
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-lg border bg-card p-4">
                <h3 className="mb-3 text-sm font-medium">CPU Usage</h3>
                <ComparisonChart
                  targets={selected}
                  metricType="cpu"
                  timeRange={timeRange}
                  label="CPU"
                  unit="%"
                />
              </div>
              <div className="rounded-lg border bg-card p-4">
                <h3 className="mb-3 text-sm font-medium">Memory Usage</h3>
                <ComparisonChart
                  targets={selected}
                  metricType="memory"
                  timeRange={timeRange}
                  label="Memory"
                  unit="%"
                />
              </div>
            </div>
          )}

          {tab === 'config' && (
            <div className="rounded-lg border bg-card p-4">
              <h3 className="mb-3 text-sm font-medium">Label Comparison</h3>
              <ConfigDiff containers={selectedContainers} />
            </div>
          )}

          {tab === 'summary' && (
            <div className="rounded-lg border bg-card p-4">
              <h3 className="mb-3 text-sm font-medium">Status Summary</h3>
              <SummaryTable containers={selectedContainers} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
