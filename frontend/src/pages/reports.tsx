import { useState, useMemo } from 'react';
import {
  FileBarChart,
  Download,
  Cpu,
  MemoryStick,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Server,
  Clock,
  Lightbulb,
  Building2,
  ChevronDown,
  ChevronRight,
  Box,
  Tag,
} from 'lucide-react';
import {
  useUtilizationReport,
  useTrendsReport,
} from '@/hooks/use-reports';
import type { ContainerReport } from '@/hooks/use-reports';
import { useEndpoints } from '@/hooks/use-endpoints';
import { useContainers } from '@/hooks/use-containers';
import type { Container } from '@/hooks/use-containers';
import { MetricsLineChart } from '@/components/charts/metrics-line-chart';
import { SkeletonCard } from '@/components/shared/loading-skeleton';
import { cn } from '@/lib/utils';
import { ThemedSelect } from '@/components/shared/themed-select';

const TIME_RANGES = [
  { value: '24h', label: '24 Hours' },
  { value: '7d', label: '7 Days' },
  { value: '30d', label: '30 Days' },
];

function exportReportCSV(containers: ContainerReport[], timeRange: string) {
  const escapeCsvValue = (value: string | number | null | undefined) => {
    if (value === null || value === undefined) return '';
    const raw = String(value);
    return raw.includes(',') || raw.includes('"') || raw.includes('\n')
      ? `"${raw.replace(/"/g, '""')}"`
      : raw;
  };

  const header = [
    'container_name',
    'container_id',
    'endpoint_id',
    'cpu_avg',
    'cpu_min',
    'cpu_max',
    'cpu_p50',
    'cpu_p95',
    'cpu_p99',
    'memory_avg',
    'memory_min',
    'memory_max',
    'memory_p50',
    'memory_p95',
    'memory_p99',
  ].join(',');

  const rows = containers.map((c) =>
    [
      escapeCsvValue(c.container_name),
      escapeCsvValue(c.container_id),
      escapeCsvValue(c.endpoint_id),
      escapeCsvValue(c.cpu?.avg),
      escapeCsvValue(c.cpu?.min),
      escapeCsvValue(c.cpu?.max),
      escapeCsvValue(c.cpu?.p50),
      escapeCsvValue(c.cpu?.p95),
      escapeCsvValue(c.cpu?.p99),
      escapeCsvValue(c.memory?.avg),
      escapeCsvValue(c.memory?.min),
      escapeCsvValue(c.memory?.max),
      escapeCsvValue(c.memory?.p50),
      escapeCsvValue(c.memory?.p95),
      escapeCsvValue(c.memory?.p99),
    ].join(','),
  );

  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  try {
    a.href = url;
    a.download = `resource-report-${timeRange}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
  } finally {
    if (a.parentNode) {
      a.parentNode.removeChild(a);
    }
    URL.revokeObjectURL(url);
  }
}

function StatCard({
  label,
  value,
  unit,
  icon: Icon,
  trend,
}: {
  label: string;
  value: number;
  unit: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: 'up' | 'down' | 'neutral';
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <p className="text-2xl font-bold">{value.toFixed(1)}</p>
        <span className="text-sm text-muted-foreground">{unit}</span>
      </div>
      {trend && trend !== 'neutral' && (
        <div className={cn('mt-1 flex items-center gap-1 text-xs', trend === 'up' ? 'text-red-500' : 'text-green-500')}>
          {trend === 'up' ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          <span>{trend === 'up' ? 'Increasing' : 'Decreasing'}</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stack naming convention parser
// Format: <department>_<dienststelle>_<stackname>-<prod|test>
// The -prod/-test suffix is optional.
// ---------------------------------------------------------------------------

export interface ParsedStack {
  department: string;
  dienststelle: string;
  stackName: string;
  environment: 'prod' | 'test' | null;
  raw: string;
}

export function parseStackName(raw: string): ParsedStack | null {
  if (!raw) return null;

  const parts = raw.split('_');
  if (parts.length < 2) return null; // doesn't follow convention

  const department = parts[0];
  const dienststelle = parts[1];

  // Everything after the second _ is the stack name (may contain more underscores)
  let stackPart = parts.slice(2).join('_');
  let environment: 'prod' | 'test' | null = null;

  // Check for -prod or -test suffix
  if (stackPart.endsWith('-prod')) {
    environment = 'prod';
    stackPart = stackPart.slice(0, -5);
  } else if (stackPart.endsWith('-test')) {
    environment = 'test';
    stackPart = stackPart.slice(0, -5);
  }

  return {
    department,
    dienststelle,
    stackName: stackPart || dienststelle, // fallback if no third segment
    environment,
    raw,
  };
}

interface ContainerWithStack extends Container {
  parsedStack: ParsedStack | null;
}

interface DienststelleGroup {
  dienststelle: string;
  departments: string[];
  containers: ContainerWithStack[];
}

function groupContainersByDienststelle(
  containers: Container[] | undefined,
): DienststelleGroup[] {
  const safeContainers = Array.isArray(containers) ? containers : [];

  const groups = new Map<string, {
    departments: Set<string>;
    containers: ContainerWithStack[];
  }>();

  for (const c of safeContainers) {
    const stackLabel = c.labels?.['com.docker.compose.project'] ?? '';
    const parsed = parseStackName(stackLabel);
    const key = parsed?.dienststelle ?? 'Standalone';

    if (!groups.has(key)) {
      groups.set(key, { departments: new Set(), containers: [] });
    }
    const group = groups.get(key)!;
    if (parsed?.department) group.departments.add(parsed.department);
    group.containers.push({ ...c, parsedStack: parsed });
  }

  return Array.from(groups.entries())
    .map(([dienststelle, { departments, containers: cs }]) => ({
      dienststelle,
      departments: Array.from(departments).sort(),
      containers: cs,
    }))
    .sort((a, b) => {
      // "Standalone" goes last
      if (a.dienststelle === 'Standalone') return 1;
      if (b.dienststelle === 'Standalone') return -1;
      return a.dienststelle.localeCompare(b.dienststelle);
    });
}

export function DienststellenOverview({
  containers,
}: {
  containers: Container[] | undefined;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const groups = useMemo(
    () => groupContainersByDienststelle(containers),
    [containers],
  );

  const totalDienststellen = groups.filter((g) => g.dienststelle !== 'Standalone').length;
  const totalContainers = groups.reduce((sum, g) => sum + g.containers.length, 0);
  const uniqueDepartments = new Set(groups.flatMap((g) => g.departments));

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!containers || containers.length === 0) return null;

  return (
    <div className="space-y-4">
      {/* Dienststellen KPIs */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Total Dienststellen</p>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="mt-2 text-2xl font-bold">{totalDienststellen}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Total Containers</p>
            <Box className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="mt-2 text-2xl font-bold">{totalContainers}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Departments</p>
            <Tag className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="mt-2 text-2xl font-bold">{uniqueDepartments.size}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Avg Containers / Dienststelle</p>
            <Server className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="mt-2 text-2xl font-bold">
            {totalDienststellen > 0 ? (totalContainers / totalDienststellen).toFixed(1) : '0'}
          </p>
        </div>
      </div>

      {/* Grouped table */}
      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            <h3 className="text-lg font-semibold">Containers per Dienststelle</h3>
          </div>
          <span className="text-sm text-muted-foreground">
            {totalDienststellen} Dienststelle{totalDienststellen !== 1 ? 'n' : ''}
          </span>
        </div>
        <div className="divide-y">
          {groups.map(({ dienststelle, departments, containers: grpContainers }) => {
            const isExpanded = expandedIds.has(dienststelle);
            const running = grpContainers.filter((c) => c.state === 'running').length;
            const stopped = grpContainers.filter((c) => c.state === 'stopped').length;
            const other = grpContainers.length - running - stopped;
            const envCounts = { prod: 0, test: 0 };
            for (const c of grpContainers) {
              if (c.parsedStack?.environment === 'prod') envCounts.prod++;
              if (c.parsedStack?.environment === 'test') envCounts.test++;
            }

            return (
              <div key={dienststelle}>
                <button
                  type="button"
                  onClick={() => toggleExpand(dienststelle)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
                >
                  {isExpanded
                    ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{dienststelle}</span>
                      {departments.map((dept) => (
                        <span key={dept} className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
                          {dept}
                        </span>
                      ))}
                      {envCounts.prod > 0 && (
                        <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                          prod
                        </span>
                      )}
                      {envCounts.test > 0 && (
                        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                          test
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                    <span className="text-emerald-600 dark:text-emerald-400">{running} running</span>
                    {stopped > 0 && <span className="text-red-500">{stopped} stopped</span>}
                    {other > 0 && <span>{other} other</span>}
                    <span className="font-medium text-foreground">{grpContainers.length} total</span>
                  </div>
                </button>
                {isExpanded && grpContainers.length > 0 && (
                  <div className="border-t bg-muted/10">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30 text-left">
                          <th className="px-4 py-2 pl-12 font-medium">Container</th>
                          <th className="px-4 py-2 font-medium">Stack</th>
                          <th className="px-4 py-2 font-medium">Env</th>
                          <th className="px-4 py-2 font-medium">Image</th>
                          <th className="px-4 py-2 font-medium">State</th>
                        </tr>
                      </thead>
                      <tbody>
                        {grpContainers
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((c) => (
                            <tr key={c.id} className="border-b last:border-0 hover:bg-muted/20">
                              <td className="px-4 py-2 pl-12 font-medium truncate max-w-[200px]" title={c.name}>
                                {c.name}
                              </td>
                              <td className="px-4 py-2 text-muted-foreground truncate max-w-[150px]" title={c.parsedStack?.raw}>
                                {c.parsedStack?.stackName ?? '—'}
                              </td>
                              <td className="px-4 py-2">
                                {c.parsedStack?.environment && (
                                  <span className={cn(
                                    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                                    c.parsedStack.environment === 'prod' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
                                    c.parsedStack.environment === 'test' && 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
                                  )}>
                                    {c.parsedStack.environment}
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2 text-muted-foreground truncate max-w-[250px]" title={c.image}>
                                {c.image}
                              </td>
                              <td className="px-4 py-2">
                                <span className={cn(
                                  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                                  c.state === 'running' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
                                  c.state === 'stopped' && 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
                                  c.state === 'paused' && 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
                                  c.state !== 'running' && c.state !== 'stopped' && c.state !== 'paused' && 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
                                )}>
                                  {c.state}
                                </span>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {isExpanded && grpContainers.length === 0 && (
                  <div className="border-t bg-muted/10 px-4 py-3 pl-12 text-sm text-muted-foreground italic">
                    No containers on this Dienststelle
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const [timeRange, setTimeRange] = useState('24h');
  const [selectedEndpoint, setSelectedEndpoint] = useState<number | undefined>();
  const [sortField, setSortField] = useState<'name' | 'cpu' | 'memory'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const { data: endpoints } = useEndpoints();
  const { data: allContainers } = useContainers();
  const {
    data: report,
    isLoading: reportLoading,
  } = useUtilizationReport(timeRange, selectedEndpoint);
  const {
    data: trends,
    isLoading: trendsLoading,
  } = useTrendsReport(timeRange, selectedEndpoint);

  // Sort containers
  const sortedContainers = useMemo(() => {
    if (!report?.containers) return [];
    return [...report.containers].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') {
        cmp = a.container_name.localeCompare(b.container_name);
      } else if (sortField === 'cpu') {
        cmp = (a.cpu?.avg ?? 0) - (b.cpu?.avg ?? 0);
      } else {
        cmp = (a.memory?.avg ?? 0) - (b.memory?.avg ?? 0);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [report?.containers, sortField, sortDir]);

  // Trend chart data
  const cpuTrendData = useMemo(() => {
    if (!trends?.trends.cpu) return [];
    return trends.trends.cpu.map((p) => ({
      timestamp: p.hour,
      value: p.avg,
      isAnomaly: false,
    }));
  }, [trends]);

  const memTrendData = useMemo(() => {
    if (!trends?.trends.memory) return [];
    return trends.trends.memory.map((p) => ({
      timestamp: p.hour,
      value: p.avg,
      isAnomaly: false,
    }));
  }, [trends]);

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const isLoading = reportLoading || trendsLoading;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Resource Reports</h1>
          <p className="text-muted-foreground">
            Utilization analysis, trends, and right-sizing recommendations
          </p>
        </div>
        <button
          onClick={() => report && exportReportCSV(report.containers, timeRange)}
          disabled={!report?.containers.length}
          className="flex items-center gap-2 rounded-md border bg-card px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-card p-4">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-muted-foreground" />
          <ThemedSelect
            value={selectedEndpoint != null ? String(selectedEndpoint) : '__all__'}
            onValueChange={(val) => setSelectedEndpoint(val === '__all__' ? undefined : Number(val))}
            options={[
              { value: '__all__', label: 'All endpoints' },
              ...(endpoints?.map((ep) => ({ value: String(ep.id), label: ep.name })) ?? []),
            ]}
            className="text-sm"
          />
        </div>

        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <div className="flex rounded-md border border-input overflow-hidden">
            {TIME_RANGES.map((range) => (
              <button
                key={range.value}
                onClick={() => setTimeRange(range.value)}
                className={cn(
                  'px-3 py-1.5 text-sm font-medium transition-colors',
                  timeRange === range.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background hover:bg-muted',
                )}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Dienststellen Overview */}
      <DienststellenOverview containers={allContainers} />

      {isLoading && (
        <div className="grid gap-4 md:grid-cols-4">
          <SkeletonCard className="h-24" />
          <SkeletonCard className="h-24" />
          <SkeletonCard className="h-24" />
          <SkeletonCard className="h-24" />
        </div>
      )}

      {/* Fleet Summary KPIs */}
      {report && (
        <div className="grid gap-4 md:grid-cols-5">
          <StatCard
            label="Containers"
            value={report.fleetSummary.totalContainers}
            unit=""
            icon={FileBarChart}
          />
          <StatCard
            label="Avg CPU"
            value={report.fleetSummary.avgCpu}
            unit="%"
            icon={Cpu}
          />
          <StatCard
            label="Max CPU"
            value={report.fleetSummary.maxCpu}
            unit="%"
            icon={Cpu}
            trend={report.fleetSummary.maxCpu > 90 ? 'up' : 'neutral'}
          />
          <StatCard
            label="Avg Memory"
            value={report.fleetSummary.avgMemory}
            unit="%"
            icon={MemoryStick}
          />
          <StatCard
            label="Max Memory"
            value={report.fleetSummary.maxMemory}
            unit="%"
            icon={MemoryStick}
            trend={report.fleetSummary.maxMemory > 90 ? 'up' : 'neutral'}
          />
        </div>
      )}

      {/* Trend Charts */}
      {trends && (cpuTrendData.length > 0 || memTrendData.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-lg border bg-card p-6">
            <div className="flex items-center gap-2 mb-4">
              <Cpu className="h-5 w-5 text-blue-500" />
              <h3 className="text-lg font-semibold">CPU Trend (Fleet Avg)</h3>
            </div>
            <div style={{ height: 250 }}>
              {cpuTrendData.length > 0 ? (
                <MetricsLineChart
                  data={cpuTrendData}
                  label="CPU %"
                  color="#3b82f6"
                  unit="%"
                />
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  No CPU data for this period
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg border bg-card p-6">
            <div className="flex items-center gap-2 mb-4">
              <MemoryStick className="h-5 w-5 text-purple-500" />
              <h3 className="text-lg font-semibold">Memory Trend (Fleet Avg)</h3>
            </div>
            <div style={{ height: 250 }}>
              {memTrendData.length > 0 ? (
                <MetricsLineChart
                  data={memTrendData}
                  label="Memory %"
                  color="#8b5cf6"
                  unit="%"
                />
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  No memory data for this period
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Recommendations */}
      {report && report.recommendations.length > 0 && (
        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Lightbulb className="h-5 w-5 text-amber-500" />
            <h3 className="text-lg font-semibold">Right-Sizing Recommendations</h3>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-200">
              {report.recommendations.length}
            </span>
          </div>
          <div className="space-y-3">
            {report.recommendations.map((rec) => (
              <div key={rec.container_id} className="rounded-md border p-3">
                <p className="font-medium text-sm">{rec.container_name}</p>
                <ul className="mt-1 space-y-1">
                  {rec.issues.map((issue, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500" />
                      {issue}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Container Utilization Table */}
      {report && report.containers.length > 0 && (
        <div className="rounded-lg border bg-card">
          <div className="p-4 border-b">
            <h3 className="text-lg font-semibold">Container Utilization</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th
                    className="px-4 py-3 font-medium cursor-pointer hover:text-foreground"
                    onClick={() => handleSort('name')}
                  >
                    Container {sortField === 'name' && (sortDir === 'asc' ? '↑' : '↓')}
                  </th>
                  <th
                    className="px-4 py-3 font-medium cursor-pointer hover:text-foreground text-right"
                    onClick={() => handleSort('cpu')}
                  >
                    CPU Avg {sortField === 'cpu' && (sortDir === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-4 py-3 font-medium text-right">CPU p95</th>
                  <th className="px-4 py-3 font-medium text-right">CPU Max</th>
                  <th
                    className="px-4 py-3 font-medium cursor-pointer hover:text-foreground text-right"
                    onClick={() => handleSort('memory')}
                  >
                    Mem Avg {sortField === 'memory' && (sortDir === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-4 py-3 font-medium text-right">Mem p95</th>
                  <th className="px-4 py-3 font-medium text-right">Mem Max</th>
                  <th className="px-4 py-3 font-medium text-right">Samples</th>
                </tr>
              </thead>
              <tbody>
                {sortedContainers.map((c) => (
                  <tr key={c.container_id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium truncate max-w-[200px]" title={c.container_name}>
                      {c.container_name}
                    </td>
                    <td className={cn('px-4 py-3 text-right', (c.cpu?.avg ?? 0) > 80 && 'text-red-500 font-medium')}>
                      {c.cpu ? `${c.cpu.avg.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {c.cpu ? `${c.cpu.p95.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {c.cpu ? `${c.cpu.max.toFixed(1)}%` : '—'}
                    </td>
                    <td className={cn('px-4 py-3 text-right', (c.memory?.avg ?? 0) > 85 && 'text-red-500 font-medium')}>
                      {c.memory ? `${c.memory.avg.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {c.memory ? `${c.memory.p95.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {c.memory ? `${c.memory.max.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {c.cpu?.samples ?? c.memory?.samples ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty State */}
      {report && report.containers.length === 0 && !isLoading && (
        <div className="rounded-lg border border-dashed bg-muted/20 p-12 text-center">
          <FileBarChart className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-semibold">No Data Available</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            No metrics found for the selected time range. Metrics are collected every 60 seconds from monitored containers.
          </p>
        </div>
      )}
    </div>
  );
}
