import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/hooks/use-auto-refresh', () => ({
  useAutoRefresh: () => ({ interval: 0, setInterval: vi.fn() }),
}));

vi.mock('@/components/charts/service-map', () => ({
  ServiceMap: () => <div>mock-service-map</div>,
}));

vi.mock('@/components/shared/themed-select', () => ({
  ThemedSelect: ({ value, options, onValueChange, className }: {
    value: string;
    options: Array<{ value: string; label: string }>;
    onValueChange: (value: string) => void;
    className?: string;
  }) => (
    <select className={className} value={value} onChange={(e) => onValueChange(e.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

const mockUseTraces = vi.fn();
const mockUseTrace = vi.fn();
const mockUseServiceMap = vi.fn();
const mockUseTraceSummary = vi.fn();

vi.mock('@/hooks/use-traces', () => ({
  useTraces: (...args: unknown[]) => mockUseTraces(...args),
  useTrace: (...args: unknown[]) => mockUseTrace(...args),
  useServiceMap: (...args: unknown[]) => mockUseServiceMap(...args),
  useTraceSummary: (...args: unknown[]) => mockUseTraceSummary(...args),
}));

import TraceExplorerPage from './trace-explorer';

describe('TraceExplorerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseTraces.mockReturnValue({
      data: {
        traces: [
          {
            trace_id: 'trace-1',
            root_span: 'GET /health',
            duration_ms: 120,
            status: 'ok',
            service_name: 'api',
            start_time: '2026-02-12T10:00:00.000Z',
            trace_source: 'ebpf',
            span_count: 1,
          },
        ],
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    });

    mockUseTrace.mockReturnValue({
      data: {
        traceId: 'trace-1',
        spans: [
          {
            span_id: 'span-1',
            parent_span_id: null,
            name: 'GET /health',
            service_name: 'api',
            start_time: '2026-02-12T10:00:00.000Z',
            duration_ms: 120,
            status: 'ok',
            trace_source: 'ebpf',
            attributes: '{}',
          },
        ],
      },
    });

    mockUseServiceMap.mockReturnValue({ data: { nodes: [], edges: [] } });
    mockUseTraceSummary.mockReturnValue({
      data: {
        totalTraces: 12,
        avgDuration: 85,
        errorRate: 0.2,
        services: 4,
        sourceCounts: {
          http: 3,
          ebpf: 7,
          scheduler: 2,
          unknown: 0,
        },
      },
    });
  });

  it('renders source-scoped counters from summary', () => {
    render(<TraceExplorerPage />);

    expect(screen.getByText('Source counters:')).toBeInTheDocument();
    expect(screen.getByText('eBPF: 7')).toBeInTheDocument();
    expect(screen.getByText('HTTP: 3')).toBeInTheDocument();
    expect(screen.getByText('Scheduler: 2')).toBeInTheDocument();
  });

  it('applies advanced filters through trace query state', () => {
    render(<TraceExplorerPage />);

    fireEvent.click(screen.getByText('Show advanced filters'));
    fireEvent.change(screen.getByPlaceholderText('/api/users/:id'), { target: { value: '/health' } });
    fireEvent.change(screen.getByPlaceholderText('500'), { target: { value: '200' } });

    const lastCall = mockUseTraces.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(lastCall.httpRoute).toBe('/health');
    expect(lastCall.httpStatusCode).toBe(200);
  });
});
