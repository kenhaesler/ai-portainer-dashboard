import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildManagementPdfModel,
  exportManagementPdf,
  type ManagementPdfInput,
} from './management-pdf-export';

const mocks = vi.hoisted(() => {
  const addImageMock = vi.fn();
  const setTextColorMock = vi.fn();
  const setFontSizeMock = vi.fn();
  const textMock = vi.fn();
  const setFillColorMock = vi.fn();
  const roundedRectMock = vi.fn();
  const splitTextToSizeMock = vi.fn((text: string) => [text]);
  const addPageMock = vi.fn();
  const saveMock = vi.fn();
  const JsPdfConstructorMock = vi.fn(() => ({
    addImage: addImageMock,
    setTextColor: setTextColorMock,
    setFontSize: setFontSizeMock,
    text: textMock,
    setFillColor: setFillColorMock,
    roundedRect: roundedRectMock,
    splitTextToSize: splitTextToSizeMock,
    addPage: addPageMock,
    save: saveMock,
    lastAutoTable: { finalY: 120 },
  }));
  const autoTableMock = vi.fn();
  return {
    addImageMock,
    saveMock,
    JsPdfConstructorMock,
    autoTableMock,
  };
});

vi.mock('jspdf', () => ({
  default: mocks.JsPdfConstructorMock,
}));

vi.mock('jspdf-autotable', () => ({
  default: (...args: unknown[]) => mocks.autoTableMock(...args),
}));

function buildInput(overrides: Partial<ManagementPdfInput> = {}): ManagementPdfInput {
  return {
    generatedAt: new Date('2026-02-13T10:00:00.000Z'),
    timeRange: '7d',
    scopeLabel: 'All endpoints',
    includeInfrastructure: false,
    theme: 'ocean',
    reportTitle: 'Management Resource Report',
    containers: [
      {
        container_id: 'c1',
        container_name: 'api-service',
        endpoint_id: 1,
        cpu: { avg: 50, min: 10, max: 90, p50: 45, p95: 85, p99: 89, samples: 42 },
        memory: { avg: 60, min: 20, max: 88, p50: 55, p95: 82, p99: 86, samples: 42 },
        memory_bytes: null,
      },
    ],
    recommendations: [
      {
        container_id: 'c1',
        container_name: 'api-service',
        issues: ['CPU over-utilized'],
      },
    ],
    trends: {
      cpu: [{ hour: '2026-02-13T09:00:00Z', avg: 45, max: 80, min: 10, samples: 20 }],
      memory: [{ hour: '2026-02-13T09:00:00Z', avg: 55, max: 75, min: 15, samples: 20 }],
      memory_bytes: [],
    },
    ...overrides,
  };
}

describe('buildManagementPdfModel', () => {
  it('builds expected summary and trend values', () => {
    const model = buildManagementPdfModel(buildInput());
    expect(model.periodLabel).toBe('Last 7 Days');
    expect(model.totalServices).toBe(1);
    expect(model.avgCpu).toBe(50);
    expect(model.maxMemory).toBe(88);
    expect(model.topServices[0].containerName).toBe('api-service');
    expect(model.cpuTrend[0].label).toBe('2026-02-13');
  });

  it('returns stable empty states with no data', () => {
    const model = buildManagementPdfModel(buildInput({
      containers: [],
      recommendations: [],
      trends: { cpu: [], memory: [], memory_bytes: [] },
    }));
    expect(model.totalServices).toBe(0);
    expect(model.topServices).toHaveLength(0);
    expect(model.recommendationRows).toHaveLength(0);
  });
});

describe('exportManagementPdf', () => {
  beforeEach(() => {
    mocks.JsPdfConstructorMock.mockClear();
    mocks.autoTableMock.mockClear();
    mocks.addImageMock.mockClear();
    mocks.saveMock.mockClear();
  });

  it('builds and saves a PDF', async () => {
    await exportManagementPdf(buildInput(), 'management-report.pdf');

    expect(mocks.JsPdfConstructorMock).toHaveBeenCalledTimes(1);
    expect(mocks.autoTableMock).toHaveBeenCalled();
    expect(mocks.saveMock).toHaveBeenCalledWith('management-report.pdf');
  });
});
