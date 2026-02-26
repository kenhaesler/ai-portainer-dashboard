import { useState, useMemo, useEffect } from 'react';
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
import { exportToCsv } from '@/lib/csv-export';
import {
  MANAGEMENT_PDF_THEMES,
  exportManagementPdf,
  type ManagementPdfTheme,
} from '@/lib/management-pdf-export';

const TIME_RANGES = [
  { value: '24h', label: '24 Hours' },
  { value: '7d', label: '7 Days' },
  { value: '30d', label: '30 Days' },
];
const DEFAULT_PDF_TIME_RANGE = '7d';
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
  const [excludeInfrastructure, setExcludeInfrastructure] = useState(true);
  const [pdfTimeRange, setPdfTimeRange] = useState(DEFAULT_PDF_TIME_RANGE);
  const [pdfIncludeInfrastructure, setPdfIncludeInfrastructure] = useState(false);
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
  const [sortField, setSortField] = useState<'name' | 'cpu' | 'memory'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

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
  } = useUtilizationReport(pdfTimeRange, selectedEndpoint, undefined, !pdfIncludeInfrastructure);
  const {
    data: pdfTrends,
    isLoading: pdfTrendsLoading,
  } = useTrendsReport(pdfTimeRange, selectedEndpoint, undefined, !pdfIncludeInfrastructure);

  // Sort containers
  const sortedContainers = useMemo(() => {
    if (!report?.containers) return [];
    return [...report.containers].sort((a, b) => {
      let cmp: number;
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
    && (!pdfIncludeInfrastructure === excludeInfrastructure);
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

  const handleOpenPdfOptions = () => {
    setPdfTimeRange(DEFAULT_PDF_TIME_RANGE);
    setPdfIncludeInfrastructure(false);
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
      const filename = `management-report-${pdfTimeRange}-${scope}-${date.toISOString().slice(0, 10)}.pdf`;
      const baseInput = {
        generatedAt: date,
        timeRange: pdfTimeRange,
        scopeLabel,
        includeInfrastructure: pdfIncludeInfrastructure,
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

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
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

  const renderContainerTable = (containers: ContainerReport[]) => (
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
          {containers.map((container) => (
            <tr key={container.container_id} className="border-b last:border-0 hover:bg-muted/30">
              <td className="px-4 py-3 font-medium truncate max-w-[200px]" title={container.container_name}>
                {container.container_name}
              </td>
              <td className={cn('px-4 py-3 text-right', (container.cpu?.avg ?? 0) > 80 && 'text-red-500 font-medium')}>
                {container.cpu ? `${container.cpu.avg.toFixed(1)}%` : '—'}
              </td>
              <td className="px-4 py-3 text-right">
                {container.cpu ? `${container.cpu.p95.toFixed(1)}%` : '—'}
              </td>
              <td className="px-4 py-3 text-right">
                {container.cpu ? `${container.cpu.max.toFixed(1)}%` : '—'}
              </td>
              <td className={cn('px-4 py-3 text-right', (container.memory?.avg ?? 0) > 85 && 'text-red-500 font-medium')}>
                {container.memory ? `${container.memory.avg.toFixed(1)}%` : '—'}
              </td>
              <td className="px-4 py-3 text-right">
                {container.memory ? `${container.memory.p95.toFixed(1)}%` : '—'}
              </td>
              <td className="px-4 py-3 text-right">
                {container.memory ? `${container.memory.max.toFixed(1)}%` : '—'}
              </td>
              <td className="px-4 py-3 text-right text-muted-foreground">
                {container.cpu?.samples ?? container.memory?.samples ?? 0}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

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
        <div className="flex items-center gap-2">
          <button
            onClick={handleOpenPdfOptions}
            className="flex items-center gap-2 rounded-md border bg-card px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            <FileText className="h-4 w-4" />
            Export Management PDF
          </button>
          <button
            onClick={handleExportCsv}
            disabled={!exportRows.length}
            className="flex items-center gap-2 rounded-md border bg-card px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
        </div>
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

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={excludeInfrastructure}
            onChange={(event) => setExcludeInfrastructure(event.target.checked)}
          />
          Exclude infrastructure services
        </label>
      </div>

      {showPdfOptions && (
        <div className="relative z-20 space-y-4 rounded-lg border bg-card p-4 pointer-events-auto">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Management PDF Export</h2>
              <p className="text-sm text-muted-foreground">
                Default range is 7 days. Endpoint scope follows the current report filter.
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
                checked={pdfIncludeInfrastructure}
                onChange={(event) => setPdfIncludeInfrastructure(event.target.checked)}
              />
              Include infrastructure services
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
      )}

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
        <div className="space-y-4">
          <div className="rounded-lg border bg-card">
            <div className="p-4 border-b">
              <h3 className="text-lg font-semibold">Application Services</h3>
            </div>
            {applicationContainers.length > 0 ? (
              renderContainerTable(applicationContainers)
            ) : (
              <div className="p-4 text-sm text-muted-foreground">No application services for the selected scope.</div>
            )}
          </div>

          {infrastructureContainers.length > 0 && (
            <div className="rounded-lg border bg-card">
              <div className="p-4 border-b">
                <h3 className="text-lg font-semibold">Infrastructure Services</h3>
              </div>
              {renderContainerTable(infrastructureContainers)}
            </div>
          )}
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
