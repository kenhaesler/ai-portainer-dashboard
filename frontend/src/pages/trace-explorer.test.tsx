import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/hooks/use-auto-refresh', () => ({
  useAutoRefresh: () => ({ interval: 0, setInterval: vi.fn() }),
}));

vi.mock('@/components/charts/service-map', () => ({
  ServiceMap: () => <div>mock-service-map</div>,
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

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TraceExplorerPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TraceExplorerPage', () => {
  it('shows explicit source/endpoint/container badges with unknown fallback', () => {
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

    mockUseTrace.mockReturnValue({ data: undefined });
    mockUseServiceMap.mockReturnValue({ data: { nodes: [], edges: [] }, isLoading: false });
    mockUseTraceSummary.mockReturnValue({ data: undefined });

    renderPage();

    expect(screen.getAllByText('source: ebpf').length).toBeGreaterThan(0);
    expect(screen.getByText('endpoint: unknown')).toBeTruthy();
    expect(screen.getByText('container: unknown')).toBeTruthy();
    expect(screen.getByText('Showing all trace sources. Use source filter to inspect HTTP vs eBPF behavior.')).toBeTruthy();
  });

  it('shows missing client span explanation and drawer JSON details', () => {
    mockUseTraces.mockReturnValue({
      data: {
        traces: [
          {
            trace_id: 'trace-2',
            root_span: 'GET /users',
            duration_ms: 320,
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
        traceId: 'trace-2',
        spans: [
          {
            span_id: 'span-1',
            trace_id: 'trace-2',
            parent_span_id: null,
            name: 'GET /users',
            service_name: 'api',
            start_time: '2026-02-12T10:00:00.000Z',
            end_time: '2026-02-12T10:00:00.320Z',
            duration_ms: 320,
            kind: 'server',
            status: 'ok',
            trace_source: 'ebpf',
            attributes: JSON.stringify({
              'http.method': 'GET',
              'service.namespace': 'prod',
              'service.instance.id': 'api-1',
              'container.name': 'api-container',
              'endpoint.name': 'edge-1',
            }),
          },
        ],
      },
    });

    mockUseServiceMap.mockReturnValue({ data: { nodes: [], edges: [] }, isLoading: false });
    mockUseTraceSummary.mockReturnValue({ data: undefined });

    renderPage();

    fireEvent.click(screen.getByText('api'));

    expect(screen.getByText('Missing client span detected')).toBeTruthy();
    expect(screen.getByText('Trace Details Drawer')).toBeTruthy();
    expect(screen.getByText('Key Attributes')).toBeTruthy();
    expect(screen.getByText('HTTP Method')).toBeTruthy();
    expect(screen.getByText('GET')).toBeTruthy();
    expect(screen.getByText('Raw span attributes JSON')).toBeTruthy();
    expect(screen.getByText('Resource attributes JSON')).toBeTruthy();
  });

  it('supports raw spans table filtering and row-to-drawer sync', () => {
    mockUseTraces.mockReturnValue({
      data: {
        traces: [
          {
            trace_id: 'trace-3',
            root_span: 'GET /orders',
            duration_ms: 500,
            status: 'error',
            service_name: 'orders',
            start_time: '2026-02-12T10:00:00.000Z',
            trace_source: 'ebpf',
            span_count: 2,
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
        traceId: 'trace-3',
        spans: [
          {
            span_id: 'span-a',
            trace_id: 'trace-3',
            parent_span_id: null,
            name: 'GET /orders',
            service_name: 'orders',
            start_time: '2026-02-12T10:00:00.000Z',
            end_time: '2026-02-12T10:00:00.300Z',
            duration_ms: 300,
            kind: 'server',
            status: 'ok',
            trace_source: 'ebpf',
            attributes: '{}',
          },
          {
            span_id: 'span-b',
            trace_id: 'trace-3',
            parent_span_id: 'span-a',
            name: 'SELECT orders',
            service_name: 'db',
            start_time: '2026-02-12T10:00:00.120Z',
            end_time: '2026-02-12T10:00:00.220Z',
            duration_ms: 100,
            kind: 'internal',
            status: 'error',
            trace_source: 'ebpf',
            attributes: '{}',
          },
        ],
      },
    });

    mockUseServiceMap.mockReturnValue({ data: { nodes: [], edges: [] }, isLoading: false });
    mockUseTraceSummary.mockReturnValue({ data: undefined });

    renderPage();

    fireEvent.click(screen.getByText('orders'));

    const filterInput = screen.getByPlaceholderText('Filter spans...');
    fireEvent.change(filterInput, { target: { value: 'select' } });

    expect(screen.getAllByText('SELECT orders').length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByText('SELECT orders')[0]);
    expect(screen.getAllByText('span-b').length).toBeGreaterThan(0);
  });
});
