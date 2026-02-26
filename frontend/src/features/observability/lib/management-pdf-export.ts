import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type {
  ContainerReport,
  Recommendation,
  TrendsReport,
} from '@/features/observability/hooks/use-reports';

export type ManagementPdfTheme = 'ocean' | 'forest' | 'slate' | 'sunset';

export const MANAGEMENT_PDF_THEMES: Array<{ value: ManagementPdfTheme; label: string }> = [
  { value: 'ocean', label: 'Ocean Blue' },
  { value: 'forest', label: 'Forest Green' },
  { value: 'slate', label: 'Slate Gray' },
  { value: 'sunset', label: 'Sunset Orange' },
];

export interface ManagementPdfInput {
  generatedAt: Date;
  timeRange: string;
  scopeLabel: string;
  includeInfrastructure: boolean;
  containers: ContainerReport[];
  recommendations: Recommendation[];
  trends?: TrendsReport['trends'];
  theme: ManagementPdfTheme;
  logoDataUrl?: string;
  reportTitle?: string;
}

export interface ManagementPdfModel {
  generatedAtIso: string;
  periodLabel: string;
  scopeLabel: string;
  infrastructureIncluded: boolean;
  totalServices: number;
  avgCpu: number;
  maxCpu: number;
  avgMemory: number;
  maxMemory: number;
  recommendationCount: number;
  cpuTrend: Array<{ label: string; avg: number }>;
  memoryTrend: Array<{ label: string; avg: number }>;
  topServices: Array<{
    containerName: string;
    cpuAvg: number;
    cpuMax: number;
    memoryAvg: number;
    memoryMax: number;
  }>;
  recommendationRows: Array<{
    containerName: string;
    issues: string;
  }>;
  theme: ManagementPdfTheme;
  logoDataUrl?: string;
  reportTitle: string;
}

function timeRangeLabel(timeRange: string): string {
  if (timeRange === '24h') return 'Last 24 Hours';
  if (timeRange === '7d') return 'Last 7 Days';
  if (timeRange === '30d') return 'Last 30 Days';
  return timeRange;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatPercent(value: number): string {
  return `${round(value).toFixed(1)}%`;
}

function normalizeTrendLabel(raw: string): string {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toISOString().slice(0, 10);
}

function getThemeColors(theme: ManagementPdfTheme): {
  accent: [number, number, number];
  text: [number, number, number];
  subtle: [number, number, number];
  cardBg: [number, number, number];
  tableHeadBg: [number, number, number];
} {
  if (theme === 'forest') {
    return {
      accent: [22, 101, 52],
      text: [20, 83, 45],
      subtle: [34, 94, 58],
      cardBg: [236, 253, 245],
      tableHeadBg: [240, 253, 244],
    };
  }
  if (theme === 'slate') {
    return {
      accent: [15, 23, 42],
      text: [15, 23, 42],
      subtle: [71, 85, 105],
      cardBg: [248, 250, 252],
      tableHeadBg: [241, 245, 249],
    };
  }
  if (theme === 'sunset') {
    return {
      accent: [154, 52, 18],
      text: [124, 45, 18],
      subtle: [154, 52, 18],
      cardBg: [255, 247, 237],
      tableHeadBg: [255, 237, 213],
    };
  }

  return {
    accent: [30, 58, 138],
    text: [15, 23, 42],
    subtle: [51, 65, 85],
    cardBg: [239, 246, 255],
    tableHeadBg: [248, 250, 252],
  };
}

export function buildManagementPdfModel(input: ManagementPdfInput): ManagementPdfModel {
  const sortedContainers = [...input.containers].sort((a, b) => {
    const scoreA = (a.cpu?.avg ?? 0) + (a.memory?.avg ?? 0);
    const scoreB = (b.cpu?.avg ?? 0) + (b.memory?.avg ?? 0);
    return scoreB - scoreA;
  });

  const topServices = sortedContainers.slice(0, 10).map((item) => ({
    containerName: item.container_name,
    cpuAvg: round(item.cpu?.avg ?? 0),
    cpuMax: round(item.cpu?.max ?? 0),
    memoryAvg: round(item.memory?.avg ?? 0),
    memoryMax: round(item.memory?.max ?? 0),
  }));

  return {
    generatedAtIso: input.generatedAt.toISOString(),
    periodLabel: timeRangeLabel(input.timeRange),
    scopeLabel: input.scopeLabel,
    infrastructureIncluded: input.includeInfrastructure,
    totalServices: sortedContainers.length,
    avgCpu: round(average(sortedContainers.map((item) => item.cpu?.avg ?? 0))),
    maxCpu: round(sortedContainers.reduce((max, item) => Math.max(max, item.cpu?.max ?? 0), 0)),
    avgMemory: round(average(sortedContainers.map((item) => item.memory?.avg ?? 0))),
    maxMemory: round(sortedContainers.reduce((max, item) => Math.max(max, item.memory?.max ?? 0), 0)),
    recommendationCount: input.recommendations.length,
    cpuTrend: (input.trends?.cpu ?? []).slice(-7).map((item) => ({
      label: normalizeTrendLabel(item.hour),
      avg: round(item.avg),
    })),
    memoryTrend: (input.trends?.memory ?? []).slice(-7).map((item) => ({
      label: normalizeTrendLabel(item.hour),
      avg: round(item.avg),
    })),
    topServices,
    recommendationRows: input.recommendations.slice(0, 10).map((item) => ({
      containerName: item.container_name,
      issues: item.issues.join('; '),
    })),
    theme: input.theme,
    logoDataUrl: input.logoDataUrl,
    reportTitle: input.reportTitle?.trim() || 'Management Resource Report',
  };
}

function drawKpiCard(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  value: string,
  colors: ReturnType<typeof getThemeColors>,
): void {
  doc.setFillColor(...colors.cardBg);
  doc.roundedRect(x, y, width, height, 2, 2, 'F');
  doc.setTextColor(...colors.subtle);
  doc.setFontSize(8);
  doc.text(label, x + 3, y + 6);
  doc.setTextColor(...colors.text);
  doc.setFontSize(14);
  doc.text(value, x + 3, y + 14);
}

export async function exportManagementPdf(input: ManagementPdfInput, filename: string): Promise<void> {
  const model = buildManagementPdfModel(input);
  const colors = getThemeColors(model.theme);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  let y = 15;

  // Optional logo (best-effort)
  if (model.logoDataUrl) {
    try {
      doc.addImage(model.logoDataUrl, 'PNG', 160, 10, 35, 14);
    } catch {
      // If logo is invalid for jsPDF, continue without logo.
    }
  }

  doc.setTextColor(...colors.accent);
  doc.setFontSize(18);
  doc.text(model.reportTitle, 14, y);
  y += 6;

  doc.setTextColor(...colors.subtle);
  doc.setFontSize(9);
  doc.text(`Generated: ${model.generatedAtIso}`, 14, y);
  y += 4;
  doc.text(`Period: ${model.periodLabel}`, 14, y);
  y += 4;
  doc.text(`Scope: ${model.scopeLabel}`, 14, y);
  y += 4;
  doc.text(`Infrastructure included: ${model.infrastructureIncluded ? 'Yes' : 'No'}`, 14, y);
  y += 8;

  doc.setTextColor(...colors.accent);
  doc.setFontSize(12);
  doc.text('Executive Summary', 14, y);
  y += 4;

  const cardY = y;
  const cardW = 44;
  const cardH = 18;
  drawKpiCard(doc, 14, cardY, cardW, cardH, 'Services', String(model.totalServices), colors);
  drawKpiCard(doc, 61, cardY, cardW, cardH, 'Avg CPU', formatPercent(model.avgCpu), colors);
  drawKpiCard(doc, 108, cardY, cardW, cardH, 'Max CPU', formatPercent(model.maxCpu), colors);
  drawKpiCard(doc, 155, cardY, cardW, cardH, 'Avg Memory', formatPercent(model.avgMemory), colors);
  y += cardH + 6;

  doc.setTextColor(...colors.subtle);
  doc.setFontSize(9);
  doc.text(`Max Memory: ${formatPercent(model.maxMemory)} | Recommendations: ${model.recommendationCount}`, 14, y);
  y += 7;

  doc.setTextColor(...colors.accent);
  doc.setFontSize(12);
  doc.text('Weekly Trends', 14, y);
  y += 2;

  autoTable(doc, {
    startY: y,
    head: [['Metric', 'Date', 'Average']],
    body: [
      ...(model.cpuTrend.length
        ? model.cpuTrend.map((row) => ['CPU', row.label, formatPercent(row.avg)])
        : [['CPU', '-', 'No data']]),
      ...(model.memoryTrend.length
        ? model.memoryTrend.map((row) => ['Memory', row.label, formatPercent(row.avg)])
        : [['Memory', '-', 'No data']]),
    ],
    theme: 'grid',
    headStyles: { fillColor: colors.tableHeadBg, textColor: colors.text },
    styles: { fontSize: 8 },
    margin: { left: 14, right: 14 },
  });

  y = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y;
  y += 8;

  doc.setTextColor(...colors.accent);
  doc.setFontSize(12);
  doc.text('Top 10 Services by Resource Usage', 14, y);
  y += 2;

  autoTable(doc, {
    startY: y,
    head: [['Service', 'CPU Avg', 'CPU Max', 'MEM Avg', 'MEM Max']],
    body: model.topServices.length
      ? model.topServices.map((row) => [
        row.containerName,
        formatPercent(row.cpuAvg),
        formatPercent(row.cpuMax),
        formatPercent(row.memoryAvg),
        formatPercent(row.memoryMax),
      ])
      : [['No services available for selected filters.', '-', '-', '-', '-']],
    theme: 'grid',
    headStyles: { fillColor: colors.tableHeadBg, textColor: colors.text },
    styles: { fontSize: 8 },
    margin: { left: 14, right: 14 },
  });

  y = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y;
  y += 8;

  doc.setTextColor(...colors.accent);
  doc.setFontSize(12);
  doc.text('Recommendations / Risks', 14, y);
  y += 5;

  doc.setTextColor(...colors.text);
  doc.setFontSize(9);
  if (!model.recommendationRows.length) {
    doc.text('No active recommendations for selected filters.', 14, y);
  } else {
    for (const row of model.recommendationRows.slice(0, 10)) {
      const lines = doc.splitTextToSize(`- ${row.containerName}: ${row.issues}`, 180);
      doc.text(lines, 14, y);
      y += lines.length * 4;
      if (y > 280) {
        doc.addPage();
        y = 20;
      }
    }
  }

  doc.save(filename);
}
