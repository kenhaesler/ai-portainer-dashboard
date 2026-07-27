import { useState, useMemo, useEffect, useCallback } from 'react';
import { type ColumnDef, type SortingState } from '@tanstack/react-table';
import {
  FileBarChart,
  Download,
  FileText,
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
} from 'lucide-react';
import {
  useUtilizationReport,
  useTrendsReport,
} from '@/features/observability/hooks/use-reports';
import type { ContainerReport } from '@/features/observability/hooks/use-reports';
import { useEndpoints } from '@/features/containers/hooks/use-endpoints';
import { useContainers } from '@/features/containers/hooks/use-containers';
import type { Container } from '@/features/containers/hooks/use-containers';
import { MetricsLineChart } from '@/shared/components/charts/metrics-line-chart';
import { DataTable } from '@/shared/components/tables/data-table';
import { SkeletonKpi } from '@/shared/components/feedback/skeleton';
import { EmptyState } from '@/shared/components/feedback/empty-state';
import { PageHeader } from '@/shared/components/layout/page-header';
import { cn } from '@/shared/lib/utils';
import { ThemedSelect } from '@/shared/components/ui/themed-select';
import { SpotlightCard } from '@/shared/components/data-display/spotlight-card';
import { exportToCsv } from '@/shared/lib/csv-export';
// Only the lightweight theme metadata is imported statically; the jsPDF-backed
// export module is loaded via dynamic import() inside handleExportPdf (#1507)
// so /reports does not ship the PDF machinery until Export PDF is clicked.
import {
  MANAGEMENT_PDF_THEMES,
  type ManagementPdfTheme,
} from '@/features/observability/lib/management-pdf-themes';

/**
 * Display names for the right-sizing rule metrics.
 *
 * The statement was assembled with `rule.metric.toUpperCase()`, so it read
 * "MEMORY p95 below 20% — consider reducing memory limits": the metric shouted
 * in the first two words and spoken normally four words later, in one sentence.
 */
/**
 * Scope line for the page header.
 *
 * The KPI row averages over running containers while the table below lists
 * every container observed in the window, so the page could lead with
 * "7 containers" above 25 rows and a rule reading "25 containers: CPU p95
 * below 10%". State the split only when the two actually differ — on a fleet
 * where everything is up, "12 of 12 running" is noise.
 */
export function reportScopeSubtitle(
  report: { fleetSummary: { totalContainers: number; totalObserved?: number } },
  timeRange: string,
): string {
  const running = report.fleetSummary.totalContainers;
  const observed = report.fleetSummary.totalObserved ?? running;
  const window = TIME_RANGES.find((r) => r.value === timeRange)?.label.toLowerCase() ?? timeRange;
  const noun = observed === 1 ? 'container' : 'containers';

  return observed === running
    ? `${observed} ${noun} over the last ${window}`
    : `${running} of ${observed} ${noun} running, over the last ${window}`;
}

const METRIC_DISPLAY_LABELS: Record<string, string> = {
  cpu: 'CPU',
  memory: 'Memory',
  memory_bytes: 'Memory',
};

const TIME_RANGES = [
  { value: '24h', label: '24 Hours' },
  { value: '7d', label: '7 Days' },
  { value: '30d', label: '30 Days' },
];
const DEFAULT_PDF_TIME_RANGE = '7d';
/**
 * CPU% here follows Docker's `docker stats` convention — 100% is one core — so
 * a bare "Avg CPU 0.5 %" is ambiguous without it. `/metrics` was given the same
 * denominator treatment for exactly this reason (#1429); it can name the core
 * count because it queries per-container metadata, which a fleet-wide roll-up
 * has no single answer for.
 */
const CPU_DENOMINATOR_LABEL = '100% = one core';
/** How many container names to spell out under a right-sizing rule before "and N more". */
const RULE_CONTAINER_PREVIEW = 6;

/**
 * `recommendationSummary` from `GET /api/reports/utilization` — the per-rule
 * rollup that lets this page state a rule once instead of repeating byte-
 * identical advice per container.
 *
 * Declared here rather than in `use-reports.ts` only because that hook is owned
 * by another workstream this pass; it belongs on `UtilizationReport`.
 */
interface RightSizingRuleSummary {
  id: string;
  metric: string;
  statistic: string;
  comparison: string;
  threshold: number;
  unit: string;
  recommendation: string;
  /** Every container the rule fired on. Uncapped — count with this. */
  container_count: number;
  /** A sample of the names, capped server-side; may be shorter than the count. */
  container_names: string[];
  names_truncated?: boolean;
}

/** One rendered line: the rule, and the containers it matched. */
interface RightSizingGroup {
  id: string;
  statement: string;
  containerNames: string[];
  /**
   * The real total. Kept separate from `containerNames.length` because the
   * backend caps the name list — counting the array would quietly under-report
   * exactly the large fleet the cap exists for.
   */
  containerCount: number;
  /** True when `containerNames` is a sample rather than the whole list. */
  truncated: boolean;
}
const PDF_BRANDING_STORAGE_KEY = 'reports-management-pdf-branding-v1';
const PDF_BRAND_PROFILES = [
  { value: 'management', label: 'Management (Recommended)', theme: 'ocean', reportTitle: 'Management Resource Report' },
  { value: 'board', label: 'Board Summary', theme: 'slate', reportTitle: 'Board Infrastructure Summary' },
  { value: 'operations', label: 'Operations Review', theme: 'forest', reportTitle: 'Operations Weekly Service Report' },
  { value: 'custom', label: 'Custom', theme: null, reportTitle: null },
] as const;
type PdfBrandProfile = (typeof PDF_BRAND_PROFILES)[number]['value'];

function StatCard({
  label,
  value,
  unit,
  icon: Icon,
  trend,
  decimals,
  sublabel,
}: {
  label: string;
  value: number;
  unit: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: 'up' | 'down' | 'neutral';
  /**
   * Digits after the decimal point. Every stat used to go through the same
   * `toFixed(1)`, which is why a COUNT of containers rendered as "13.0".
   * Defaults to 1 for measured percentages; pass 0 for counts.
   */
  decimals?: number;
  /** The denominator, where the number alone is ambiguous (see CPU). */
  sublabel?: string;
}) {
  return (
    <SpotlightCard className="h-full">
      <div className="h-full rounded-lg border bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="mt-2 flex items-baseline gap-1">
          <p className="text-3xl font-bold tracking-tight">{value.toFixed(decimals ?? 1)}</p>
          <span className="text-sm text-muted-foreground">{unit}</span>
        </div>
        {sublabel && <p className="mt-1 text-xs text-muted-foreground">{sublabel}</p>}
        {trend && trend !== 'neutral' && (
          <div className={cn('mt-1 flex items-center gap-1 text-xs', trend === 'up' ? 'text-red-500' : 'text-green-500')}>
            {trend === 'up' ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            <span>{trend === 'up' ? 'Increasing' : 'Decreasing'}</span>
          </div>
        )}
      </div>
    </SpotlightCard>
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

/**
 * Grouped view of the customer stack-naming convention
 * `<department>_<office>_<stackname>-<prod|test>`.
 *
 * It renders **only when at least one stack actually parses**. Before that gate
 * existed this block owned the whole fold on every fleet that does not use the
 * convention, and showed three permanent zeroes as the first thing an operator
 * saw. The parser's field names keep the original German (`dienststelle`) —
 * they are the data contract, including the CSV column — but nothing on screen
 * does: an English UI does not get to render one untranslated label beside an
 * English one for the same concept.
 */
export function StackTaxonomyOverview({
  containers,
}: {
  containers: Container[] | undefined;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const groups = useMemo(
    () => groupContainersByDienststelle(containers),
    [containers],
  );

  const dienststelleColumns = useMemo<ColumnDef<ContainerWithStack, unknown>[]>(() => [
    {
      accessorKey: 'name',
      enableSorting: false,
      header: () => <span className="pl-8">Container</span>,
      cell: ({ row }) => (
        <span className="block pl-8 font-medium truncate max-w-[200px]" title={row.original.name}>
          {row.original.name}
        </span>
      ),
    },
    {
      id: 'stack',
      header: 'Stack',
      cell: ({ row }) => (
        <span
          className="block text-muted-foreground truncate max-w-[150px]"
          title={row.original.parsedStack?.raw}
        >
          {row.original.parsedStack?.stackName ?? '—'}
        </span>
      ),
    },
    {
      id: 'env',
      header: 'Env',
      cell: ({ row }) => {
        const env = row.original.parsedStack?.environment;
        if (!env) return null;
        return (
          <span className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
            env === 'prod' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
            env === 'test' && 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
          )}>
            {env}
          </span>
        );
      },
    },
    {
      accessorKey: 'image',
      enableSorting: false,
      header: 'Image',
      cell: ({ row }) => (
        <span className="block text-muted-foreground truncate max-w-[250px]" title={row.original.image}>
          {row.original.image}
        </span>
      ),
    },
    {
      accessorKey: 'state',
      enableSorting: false,
      header: 'State',
      cell: ({ row }) => {
        const state = row.original.state;
        return (
          <span className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
            state === 'running' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
            state === 'stopped' && 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
            state === 'paused' && 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
            state !== 'running' && state !== 'stopped' && state !== 'paused' && 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
          )}>
            {state}
          </span>
        );
      },
    },
  ], []);

  const totalOffices = groups.filter((g) => g.dienststelle !== 'Standalone').length;
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
  // Nothing parsed: the convention is not in use here, so this whole block is
  // noise. Do not render zeroes for a taxonomy this fleet does not have.
  if (totalOffices === 0) return null;

  return (
    <div className="space-y-4">
      {/*
        The four KPI tiles that stood here restated the counts now carried in
        this panel's own header line, and one of them ("Total Containers 13")
        duplicated the fleet KPI row 400px below.
      */}
      <SpotlightCard>
      <div className="rounded-lg border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 p-4 border-b">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            <h3 className="text-lg font-semibold">Containers by office</h3>
          </div>
          <span className="text-sm text-muted-foreground">
            {totalOffices} office{totalOffices !== 1 ? 's' : ''}
            {' · '}
            {uniqueDepartments.size} department{uniqueDepartments.size !== 1 ? 's' : ''}
            {' · '}
            {totalContainers} container{totalContainers !== 1 ? 's' : ''}
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
                  <div className="border-t bg-muted/10 p-2">
                    <DataTable
                      columns={dienststelleColumns}
                      data={[...grpContainers].sort((a, b) => a.name.localeCompare(b.name))}
                      hideSearch
                      windowScroll
                      getRowId={(c) => c.id}
                    />
                  </div>
                )}
                {isExpanded && grpContainers.length === 0 && (
                  <div className="border-t bg-muted/10 px-4 py-3 pl-12 text-sm text-muted-foreground italic">
                    No containers in this office
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      </SpotlightCard>
    </div>
  );
}

export default function ReportsPage() {
  const [timeRange, setTimeRange] = useState('24h');
  const [excludeInfrastructure, setExcludeInfrastructure] = useState(true);
  const [pdfTimeRange, setPdfTimeRange] = useState(DEFAULT_PDF_TIME_RANGE);
  // Same polarity and same words as the page filter above. The panel used to
  // say **Include** infrastructure services 40px from a page filter that said
  // **Exclude** them, so checking both produced the opposite of what an
  // operator expected in the PDF.
  const [pdfExcludeInfrastructure, setPdfExcludeInfrastructure] = useState(true);
  const [pdfBrandProfile, setPdfBrandProfile] = useState<PdfBrandProfile>('management');
  const [pdfTheme, setPdfTheme] = useState<ManagementPdfTheme>('ocean');
  const [pdfReportTitle, setPdfReportTitle] = useState('Management Resource Report');
  const [pdfLogoDataUrl, setPdfLogoDataUrl] = useState<string>();
  const [pdfLogoError, setPdfLogoError] = useState<string | null>(null);
  const [pdfExportError, setPdfExportError] = useState<string | null>(null);
  const [pdfExportSuccess, setPdfExportSuccess] = useState<string | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [showPdfOptions, setShowPdfOptions] = useState(false);
  const [selectedEndpoint, setSelectedEndpoint] = useState<number | undefined>();
  // One ordering, shared by the Application and Infrastructure tables. This
  // replaces a bespoke ('name' | 'cpu' | 'memory') + direction pair that only
  // covered three of the eight columns.
  const [sorting, setSorting] = useState<SortingState>([{ id: 'container_name', desc: false }]);

  const { data: endpoints } = useEndpoints();
  const { data: allContainers } = useContainers();
  const {
    data: report,
    isLoading: reportLoading,
  } = useUtilizationReport(timeRange, selectedEndpoint, undefined, excludeInfrastructure);
  const {
    data: trends,
    isLoading: trendsLoading,
  } = useTrendsReport(timeRange, selectedEndpoint, undefined, excludeInfrastructure);
  const {
    data: pdfReport,
    isLoading: pdfReportLoading,
  } = useUtilizationReport(pdfTimeRange, selectedEndpoint, undefined, pdfExcludeInfrastructure);
  const {
    data: pdfTrends,
    isLoading: pdfTrendsLoading,
  } = useTrendsReport(pdfTimeRange, selectedEndpoint, undefined, pdfExcludeInfrastructure);

  // Ordering is DataTable's now (see `containerColumns`), so this only splits
  // the rows into the two tables. Sorting here as well would fight it — and
  // the old comparator coerced a missing reading to 0, which sorted a
  // container with no data as the quietest in the fleet.
  const sortedContainers = useMemo(
    () => report?.containers ?? [],
    [report?.containers],
  );

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

  /**
   * "Right-Sizing Recommendations 15" used to list 15 containers, 14 of them
   * carrying byte-identical advice from four fixed thresholds — one fact
   * rendered fifteen times over ~1000px of scroll. Prefer the backend rollup;
   * fall back to grouping the legacy per-container `issues` strings so the
   * collapse still holds against an older backend.
   */
  const rightSizingGroups = useMemo<RightSizingGroup[]>(() => {
    const supplied = (report as (typeof report & { recommendationSummary?: RightSizingRuleSummary[] }) | undefined)
      ?.recommendationSummary;
    if (supplied?.length) {
      return supplied.map((rule) => ({
        id: rule.id,
        statement: `${METRIC_DISPLAY_LABELS[rule.metric] ?? rule.metric} ${rule.statistic} ${rule.comparison} ${rule.threshold}${rule.unit === 'percent' ? '%' : ''} — ${rule.recommendation}`,
        containerNames: rule.container_names,
        containerCount: rule.container_count,
        truncated: !!rule.names_truncated,
      }));
    }

    const byIssue = new Map<string, string[]>();
    for (const rec of report?.recommendations ?? []) {
      for (const issue of rec.issues) {
        const names = byIssue.get(issue) ?? [];
        names.push(rec.container_name);
        byIssue.set(issue, names);
      }
    }
    return Array.from(byIssue.entries()).map(([issue, containerNames]) => ({
      id: issue,
      statement: issue,
      containerNames,
      // The legacy path derives the list itself, so it is complete by
      // construction and its length is the count.
      containerCount: containerNames.length,
      truncated: false,
    }));
  }, [report]);

  const allContainersById = useMemo(() => {
    const byId = new Map<string, Container>();
    for (const container of allContainers ?? []) {
      byId.set(container.id, container);
    }
    return byId;
  }, [allContainers]);

  const exportRows = useMemo<Record<string, unknown>[]>(() => {
    if (!report?.containers?.length) return [];

    return report.containers.map((container) => {
      const metadata = allContainersById.get(container.container_id);
      const stack = metadata?.labels?.['com.docker.compose.project'] ?? '';
      const parsedStack = parseStackName(stack);
      return {
        container_name: container.container_name,
        endpoint_name: metadata?.endpointName ?? '',
        state: metadata?.state ?? '',
        stack,
        created_at: metadata ? new Date(metadata.created * 1000).toISOString() : '',
        dienststelle: parsedStack?.dienststelle ?? 'Standalone',
        service_type: container.service_type,
      };
    });
  }, [allContainersById, report?.containers]);

  const reusePrimaryReportForPdf = pdfTimeRange === timeRange
    && (pdfExcludeInfrastructure === excludeInfrastructure);
  const effectivePdfReport = reusePrimaryReportForPdf ? report : pdfReport;
  const effectivePdfTrends = reusePrimaryReportForPdf ? trends : pdfTrends;

  const filteredPdfContainers = useMemo(() => {
    return effectivePdfReport?.containers ?? [];
  }, [
    effectivePdfReport?.containers,
  ]);

  const filteredPdfRecommendations = useMemo(() => {
    return effectivePdfReport?.recommendations ?? [];
  }, [
    effectivePdfReport?.recommendations,
  ]);

  const handleExportCsv = () => {
    if (!exportRows.length) return;
    const scope = selectedEndpoint != null ? `endpoint-${selectedEndpoint}` : 'all-endpoints';
    const date = new Date().toISOString().slice(0, 10);
    exportToCsv(exportRows, `resource-report-${timeRange}-${scope}-${date}.csv`);
  };

  // The panel opens on the filter the operator is already looking at, then lets
  // them override it for the PDF alone. Its subtitle claimed scope was
  // inherited while time range and infrastructure silently reset.
  const handleOpenPdfOptions = () => {
    setPdfTimeRange(timeRange);
    setPdfExcludeInfrastructure(excludeInfrastructure);
    setPdfExportError(null);
    setPdfExportSuccess(null);
    setShowPdfOptions(true);
  };

  const handleExportPdf = async () => {
    const scope = selectedEndpoint != null ? `endpoint-${selectedEndpoint}` : 'all-endpoints';
    const scopeLabel = selectedEndpoint != null
      ? (endpoints?.find((endpoint) => endpoint.id === selectedEndpoint)?.name ?? `Endpoint ${selectedEndpoint}`)
      : 'All endpoints';
    const date = new Date();
    setPdfExportError(null);
    setPdfExportSuccess(null);
    setIsGeneratingPdf(true);
    try {
      const { exportManagementPdf } = await import('@/features/observability/lib/management-pdf-export');
      const filename = `management-report-${pdfTimeRange}-${scope}-${date.toISOString().slice(0, 10)}.pdf`;
      const baseInput = {
        generatedAt: date,
        timeRange: pdfTimeRange,
        scopeLabel,
        includeInfrastructure: !pdfExcludeInfrastructure,
        containers: effectivePdfReport ? filteredPdfContainers : [],
        recommendations: effectivePdfReport ? filteredPdfRecommendations : [],
        trends: effectivePdfTrends?.trends,
        theme: pdfTheme,
        reportTitle: pdfReportTitle,
      };

      try {
        await exportManagementPdf({
          ...baseInput,
          logoDataUrl: pdfLogoDataUrl,
        }, filename);
      } catch (errorWithLogo) {
        if (!pdfLogoDataUrl) throw errorWithLogo;
        await exportManagementPdf({
          ...baseInput,
          logoDataUrl: undefined,
        }, filename);
        setPdfLogoDataUrl(undefined);
        setPdfExportSuccess(`PDF generated without logo: ${filename}`);
        return;
      }

      setPdfExportSuccess(`PDF generated: ${filename}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPdfExportError(`PDF generation failed. ${message || 'Try again without logo.'}`);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const isLoading = reportLoading || trendsLoading;
  const isPdfLoading = pdfReportLoading || pdfTrendsLoading;
  const applicationContainers = useMemo(
    () => sortedContainers.filter((container) => container.service_type === 'application'),
    [sortedContainers],
  );
  const infrastructureContainers = useMemo(
    () => sortedContainers.filter((container) => container.service_type === 'infrastructure'),
    [sortedContainers],
  );

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PDF_BRANDING_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        profile?: PdfBrandProfile;
        theme?: ManagementPdfTheme;
        reportTitle?: string;
        logoDataUrl?: string;
      };
      if (parsed.profile && PDF_BRAND_PROFILES.some((profile) => profile.value === parsed.profile)) {
        setPdfBrandProfile(parsed.profile);
      }
      if (parsed.theme && MANAGEMENT_PDF_THEMES.some((theme) => theme.value === parsed.theme)) {
        setPdfTheme(parsed.theme);
      }
      if (parsed.reportTitle) setPdfReportTitle(parsed.reportTitle);
      if (parsed.logoDataUrl) setPdfLogoDataUrl(parsed.logoDataUrl);
    } catch {
      // Ignore malformed local data and use defaults.
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      PDF_BRANDING_STORAGE_KEY,
      JSON.stringify({
        profile: pdfBrandProfile,
        theme: pdfTheme,
        reportTitle: pdfReportTitle,
        logoDataUrl: pdfLogoDataUrl,
      }),
    );
  }, [pdfBrandProfile, pdfTheme, pdfReportTitle, pdfLogoDataUrl]);

  const handlePdfLogoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setPdfLogoError('Please upload an image file.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setPdfLogoError('Logo must be 2MB or smaller.');
      return;
    }

    const reader = new FileReader();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('Failed reading file'));
      reader.readAsDataURL(file);
    }).catch(() => '');

    if (!dataUrl) {
      setPdfLogoError('Could not process logo file.');
      return;
    }
    setPdfLogoError(null);
    setPdfLogoDataUrl(dataUrl);
  };

  const handlePdfBrandProfileChange = (profile: PdfBrandProfile) => {
    setPdfBrandProfile(profile);
    const selected = PDF_BRAND_PROFILES.find((item) => item.value === profile);
    if (!selected || profile === 'custom') return;
    setPdfTheme(selected.theme as ManagementPdfTheme);
    setPdfReportTitle(selected.reportTitle as string);
  };

  // Every column is a real, sortable DataTable column.
  //
  // These were `enableSorting: false` with hand-rolled `<span onClick>`
  // headers, because the Application and Infrastructure tables must sort
  // together and DataTable owned its sort state privately. The cost was
  // severe: `aria-sort` was null on all eight headers, none was tabbable, and
  // five of the eight looked identical to the sortable ones while doing
  // nothing at all. DataTable now accepts controlled sort state, so the two
  // tables share an ordering *and* get real <button> headers, aria-sort and
  // keyboard operation.
  //
  // `sortUndefined: 'last'` keeps containers with no reading for a metric at
  // the bottom either way, rather than letting a missing value sort as 0 and
  // masquerade as the quietest container in the fleet.
  const containerColumns = useMemo<ColumnDef<ContainerReport, unknown>[]>(() => [
    {
      accessorKey: 'container_name',
      header: 'Container',
      sortUndefined: 'last',
      cell: ({ row }) => (
        <span className="block font-medium truncate max-w-[200px]" title={row.original.container_name}>
          {row.original.container_name}
        </span>
      ),
    },
    {
      id: 'cpu_avg',
      accessorFn: (row) => row.cpu?.avg,
      header: () => <span className="block w-full text-right">CPU Avg</span>,
      sortUndefined: 'last',
      cell: ({ row }) => (
        <span className={cn('block text-right', (row.original.cpu?.avg ?? 0) > 80 && 'text-red-500 font-medium')}>
          {row.original.cpu ? `${row.original.cpu.avg.toFixed(1)}%` : '—'}
        </span>
      ),
    },
    {
      id: 'cpu_p95',
      accessorFn: (row) => row.cpu?.p95 ?? undefined,
      header: () => <span className="block w-full text-right">CPU p95</span>,
      sortUndefined: 'last',
      cell: ({ row }) => (
        <span className="block text-right">
          {row.original.cpu?.p95 != null ? `${row.original.cpu.p95.toFixed(1)}%` : '—'}
        </span>
      ),
    },
    {
      id: 'cpu_max',
      accessorFn: (row) => row.cpu?.max,
      header: () => <span className="block w-full text-right">CPU Max</span>,
      sortUndefined: 'last',
      cell: ({ row }) => (
        <span className="block text-right">
          {row.original.cpu ? `${row.original.cpu.max.toFixed(1)}%` : '—'}
        </span>
      ),
    },
    {
      id: 'mem_avg',
      accessorFn: (row) => row.memory?.avg,
      header: () => <span className="block w-full text-right">Mem Avg</span>,
      sortUndefined: 'last',
      cell: ({ row }) => (
        <span className={cn('block text-right', (row.original.memory?.avg ?? 0) > 85 && 'text-red-500 font-medium')}>
          {row.original.memory ? `${row.original.memory.avg.toFixed(1)}%` : '—'}
        </span>
      ),
    },
    {
      id: 'mem_p95',
      accessorFn: (row) => row.memory?.p95 ?? undefined,
      header: () => <span className="block w-full text-right">Mem p95</span>,
      sortUndefined: 'last',
      cell: ({ row }) => (
        <span className="block text-right">
          {row.original.memory?.p95 != null ? `${row.original.memory.p95.toFixed(1)}%` : '—'}
        </span>
      ),
    },
    {
      id: 'mem_max',
      accessorFn: (row) => row.memory?.max,
      header: () => <span className="block w-full text-right">Mem Max</span>,
      sortUndefined: 'last',
      cell: ({ row }) => (
        <span className="block text-right">
          {row.original.memory ? `${row.original.memory.max.toFixed(1)}%` : '—'}
        </span>
      ),
    },
    {
      id: 'samples',
      accessorFn: (row) => row.cpu?.samples ?? row.memory?.samples ?? 0,
      header: () => <span className="block w-full text-right">Samples</span>,
      sortUndefined: 'last',
      cell: ({ row }) => (
        <span className="block text-right text-muted-foreground">
          {row.original.cpu?.samples ?? row.original.memory?.samples ?? 0}
        </span>
      ),
    },
  ], []);

  const renderContainerTable = (containers: ContainerReport[]) => (
    <div className="p-2">
      {/* An empty p95 column has to say why. Percentiles need individual
          samples, so above 6h they cannot be computed over the same rows as
          avg/min/max — and printing both together produced rows where p95
          exceeded max. The dash is deliberate; the note is what makes it
          readable as "not computed" rather than "no data". */}
      {report?.aggregateSource && !report.aggregateSource.percentilesAvailable && (
        <p className="mb-3 text-xs text-muted-foreground" data-testid="percentile-basis-note">
          {report.aggregateSource.percentileNote}
        </p>
      )}
      <DataTable
        columns={containerColumns}
        data={containers}
        hideSearch
        windowScroll
        getRowId={(c) => c.container_id}
        sorting={sorting}
        onSortingChange={setSorting}
      />
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        subtitle={report ? reportScopeSubtitle(report, timeRange) : undefined}
        actions={(
          <>
            <button
              onClick={handleOpenPdfOptions}
              className="flex items-center gap-2 rounded-md border bg-card px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              <FileText className="h-4 w-4" />
              Export PDF report
            </button>
            <button
              onClick={handleExportCsv}
              disabled={!exportRows.length}
              className="flex items-center gap-2 rounded-md border bg-card px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
          </>
        )}
      />

      {/* Controls */}
      <SpotlightCard>
      <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-card p-6 shadow-sm">
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

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={excludeInfrastructure}
            onChange={(event) => setExcludeInfrastructure(event.target.checked)}
          />
          Exclude infrastructure services
        </label>
      </div>
      </SpotlightCard>

      {showPdfOptions && (
        <SpotlightCard>
        <div className="relative z-20 space-y-4 rounded-lg border bg-card p-6 shadow-sm pointer-events-auto">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Management PDF Export</h2>
              <p className="text-sm text-muted-foreground">
                Starts from the filters on this page — endpoint scope, time range and
                infrastructure. Change them here to affect the PDF only.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Time range</span>
              <div className="flex rounded-md border border-input overflow-hidden">
                {TIME_RANGES.map((range) => (
                  <button
                    key={`pdf-${range.value}`}
                    type="button"
                    onClick={() => setPdfTimeRange(range.value)}
                    className={cn(
                      'px-3 py-1.5 text-sm font-medium transition-colors',
                      pdfTimeRange === range.value
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-background hover:bg-muted',
                    )}
                  >
                    {range.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={pdfExcludeInfrastructure}
                onChange={(event) => setPdfExcludeInfrastructure(event.target.checked)}
              />
              Exclude infrastructure services
            </label>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm">
              Brand profile
              <select
                value={pdfBrandProfile}
                onChange={(event) => handlePdfBrandProfileChange(event.target.value as PdfBrandProfile)}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {PDF_BRAND_PROFILES.map((profile) => (
                  <option key={profile.value} value={profile.value}>{profile.label}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-2 text-sm">
              PDF color theme
              <select
                value={pdfTheme}
                onChange={(event) => {
                  setPdfBrandProfile('custom');
                  setPdfTheme(event.target.value as ManagementPdfTheme);
                }}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {MANAGEMENT_PDF_THEMES.map((theme) => (
                  <option key={theme.value} value={theme.value}>{theme.label}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm">
              Report title
              <input
                type="text"
                value={pdfReportTitle}
                onChange={(event) => {
                  setPdfBrandProfile('custom');
                  setPdfReportTitle(event.target.value);
                }}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Management Resource Report"
              />
            </label>

            <div className="space-y-2 text-sm">
              <label className="flex flex-col gap-2">
                Report logo (optional)
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePdfLogoChange}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border file:bg-card file:px-2 file:py-1"
                />
              </label>
              {pdfLogoError && <p className="text-xs text-destructive">{pdfLogoError}</p>}
              {pdfLogoDataUrl && (
                <div className="flex items-center gap-3">
                  <img src={pdfLogoDataUrl} alt="PDF logo preview" className="h-10 max-w-[140px] rounded border object-contain bg-white" />
                  <button
                    type="button"
                    onClick={() => setPdfLogoDataUrl(undefined)}
                    className="rounded-md border bg-card px-2 py-1 text-xs hover:bg-muted"
                  >
                    Remove logo
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={isGeneratingPdf}
              className="flex items-center gap-2 rounded-md border bg-card px-4 py-2 text-sm font-medium hover:bg-muted cursor-pointer opacity-100 pointer-events-auto"
            >
              <FileText className="h-4 w-4" />
              {isGeneratingPdf ? 'Generating PDF...' : 'Generate PDF'}
            </button>
            <button
              type="button"
              onClick={() => setShowPdfOptions(false)}
              className="rounded-md border bg-card px-4 py-2 text-sm font-medium hover:bg-muted cursor-pointer"
            >
              Cancel
            </button>
            {isPdfLoading && (
              <span className="text-sm text-muted-foreground">Loading report data...</span>
            )}
            {pdfExportError && (
              <span className="text-sm text-destructive">{pdfExportError}</span>
            )}
            {pdfExportSuccess && (
              <span className="text-sm text-green-600">{pdfExportSuccess}</span>
            )}
          </div>
        </div>
        </SpotlightCard>
      )}

      {/* Stack taxonomy (renders only when the naming convention is in use) */}
      <StackTaxonomyOverview containers={allContainers} />

      {isLoading && (
        <div className="grid gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-lg border bg-card p-6 shadow-sm">
              <SkeletonKpi />
            </div>
          ))}
        </div>
      )}

      {/* Fleet Summary KPIs */}
      {report && (
        <div className="grid gap-4 md:grid-cols-5">
          <StatCard
            label="Containers"
            value={report.fleetSummary.totalContainers}
            unit=""
            decimals={0}
            icon={FileBarChart}
          />
          <StatCard
            label="Avg CPU"
            value={report.fleetSummary.avgCpu}
            unit="%"
            icon={Cpu}
            sublabel={CPU_DENOMINATOR_LABEL}
          />
          <StatCard
            label="Max CPU"
            value={report.fleetSummary.maxCpu}
            unit="%"
            icon={Cpu}
            sublabel={CPU_DENOMINATOR_LABEL}
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
          <SpotlightCard>
          <div className="rounded-lg border bg-card p-6 shadow-sm">
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
          </SpotlightCard>

          <SpotlightCard>
          <div className="rounded-lg border bg-card p-6 shadow-sm">
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
          </SpotlightCard>
        </div>
      )}

      {/* Right-sizing rules */}
      {rightSizingGroups.length > 0 && (
        <SpotlightCard>
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <Lightbulb className="h-5 w-5 text-amber-500" />
            <h3 className="text-lg font-semibold">Right-sizing rules</h3>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-200">
              {rightSizingGroups.length}
            </span>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            Fixed utilization thresholds, evaluated per container. One line per rule that fired —
            every container a rule matched gets the same advice, so it is stated once.
          </p>
          <div className="space-y-3">
            {rightSizingGroups.map((group) => (
              <div key={group.id} className="rounded-md border p-3" data-testid="right-sizing-rule">
                <div className="flex items-start gap-2 text-sm">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500" />
                  <p>
                    <span className="font-medium">
                      {group.containerCount} container
                      {group.containerCount !== 1 ? 's' : ''}
                    </span>
                    {': '}
                    {group.statement}
                  </p>
                </div>
                <p
                  className="mt-1 pl-5 text-xs text-muted-foreground break-words"
                  title={
                    group.truncated
                      ? `${group.containerNames.join(', ')} (first ${group.containerNames.length} of ${group.containerCount})`
                      : group.containerNames.join(', ')
                  }
                >
                  {group.containerNames.slice(0, RULE_CONTAINER_PREVIEW).join(', ')}
                  {group.containerCount > RULE_CONTAINER_PREVIEW
                    && ` and ${group.containerCount - RULE_CONTAINER_PREVIEW} more`}
                </p>
              </div>
            ))}
          </div>
        </div>
        </SpotlightCard>
      )}

      {/* Container Utilization Table */}
      {report && report.containers.length > 0 && (
        <div className="space-y-4">
          <SpotlightCard>
          <div className="rounded-lg border bg-card shadow-sm">
            <div className="p-4 border-b">
              <h3 className="text-lg font-semibold">Application Services</h3>
            </div>
            {applicationContainers.length > 0 ? (
              renderContainerTable(applicationContainers)
            ) : (
              <div className="p-4 text-sm text-muted-foreground">No application services for the selected scope.</div>
            )}
          </div>
          </SpotlightCard>

          {infrastructureContainers.length > 0 && (
            <SpotlightCard>
            <div className="rounded-lg border bg-card shadow-sm">
              <div className="p-4 border-b">
                <h3 className="text-lg font-semibold">Infrastructure Services</h3>
              </div>
              {renderContainerTable(infrastructureContainers)}
            </div>
            </SpotlightCard>
          )}
        </div>
      )}

      {/* Empty State */}
      {report && report.containers.length === 0 && !isLoading && (
        <EmptyState
          icon={FileBarChart}
          title="No data available"
          description="No metrics found for the selected time range. Metrics are collected every 60 seconds from monitored containers."
        />
      )}
    </div>
  );
}
