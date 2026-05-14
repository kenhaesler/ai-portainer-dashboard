import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/features/observability/hooks/use-red', () => ({
  useRed: vi.fn(),
}));

vi.mock('@/features/observability/hooks/use-traces', () => ({
  useTraces: vi.fn(),
}));

// jsdom can't render Recharts ResponsiveContainer; stub it inline.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="responsive-container" style={{ width: 800, height: 200 }}>
        {children}
      </div>
    ),
  };
});

import { useRed } from '@/features/observability/hooks/use-red';
import { useTraces } from '@/features/observability/hooks/use-traces';
import { ContainerTracesTab } from './container-traces-tab';

const mockUseRed = vi.mocked(useRed);
const mockUseTraces = vi.mocked(useTraces);

function renderTab(containerName = 'web-1', endpointId = 1) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ContainerTracesTab
          containerName={containerName}
          endpointId={endpointId}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ContainerTracesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the empty-state callout when RED data has no rows', () => {
    mockUseRed.mockReturnValue({ data: { buckets: [], truncated: false } } as any);
    mockUseTraces.mockReturnValue({ data: [] } as any);

    renderTab();

    expect(screen.getByTestId('no-trace-data-callout')).toBeInTheDocument();
  });

  it('renders the four panels when RED data is present', () => {
    mockUseRed.mockReturnValue({
      data: {
        buckets: [
          {
            bucketStart: '2026-05-14T11:00:00.000Z',
            rows: [
              {
                group: 'web-1',
                rate: 1.5,
                errorRate: 0.02,
                p50Ms: 10,
                p95Ms: 60,
                p99Ms: 120,
                callCount: 5400,
              },
            ],
          },
        ],
        truncated: false,
      },
    } as any);
    mockUseTraces.mockReturnValue({ data: [] } as any);

    renderTab();

    expect(screen.getByText(/RED summary/i)).toBeInTheDocument();
    expect(screen.getByText(/Top outgoing calls/i)).toBeInTheDocument();
    expect(screen.getByText(/Top incoming calls/i)).toBeInTheDocument();
    expect(screen.getByText(/Latency.*timeline|sparkline|over time/i)).toBeInTheDocument();
    // Rate shown
    expect(screen.getByText(/1\.50.*\/s/)).toBeInTheDocument();
    // Error rate (2.00%)
    expect(screen.getByText(/2\.00%/)).toBeInTheDocument();
    // p95 displayed in ms
    expect(screen.getByText(/60.*ms/)).toBeInTheDocument();
  });

  it('calls useRed twice: once for the summary (1h bucket) and once for the sparkline (1m bucket)', () => {
    mockUseRed.mockReturnValue({ data: { buckets: [], truncated: false } } as any);
    mockUseTraces.mockReturnValue({ data: [] } as any);

    renderTab('web-1');

    // Confirm useRed was called for both bucket sizes
    const bucketsPassed = mockUseRed.mock.calls.map((c) => c[0].bucket);
    expect(bucketsPassed).toContain('1h');
    expect(bucketsPassed).toContain('1m');
    // Both filtered by container
    for (const [opts] of mockUseRed.mock.calls) {
      expect(opts.container).toBe('web-1');
    }
  });

  it('fetches outgoing and incoming traces filtered by container name', () => {
    mockUseRed.mockReturnValue({ data: { buckets: [], truncated: false } } as any);
    mockUseTraces.mockReturnValue({ data: [] } as any);

    renderTab('api-2');

    const calls = mockUseTraces.mock.calls.map(([opts]) => opts);
    // Should have both a client (outgoing) and server (incoming) call.
    const outgoing = calls.find((c) => c?.containerName === 'api-2');
    expect(outgoing).toBeDefined();
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it('renders top outgoing/incoming rows with deep links to /traces?trace=…', () => {
    mockUseRed.mockReturnValue({
      data: {
        buckets: [
          {
            bucketStart: '2026-05-14T11:00:00.000Z',
            rows: [
              {
                group: 'web-1', rate: 1, errorRate: 0,
                p50Ms: 5, p95Ms: 10, p99Ms: 15, callCount: 3,
              },
            ],
          },
        ],
        truncated: false,
      },
    } as any);
    mockUseTraces.mockReturnValue({
      data: [
        {
          traceId: 't1', services: ['web-1'], startTime: '2026-05-14T11:00:00Z',
          duration: 12, status: 'ok',
          rootSpan: {
            traceId: 't1', spanId: 's1', operationName: 'GET /foo',
            serviceName: 'web-1', startTime: '2026-05-14T11:00:00Z',
            duration: 12, status: 'ok',
          },
          spans: [],
        },
      ],
    } as any);

    renderTab('web-1');

    const link = screen.getAllByRole('link', { name: /GET \/foo/i })[0];
    expect(link.getAttribute('href')).toMatch(/\/traces\?.*trace=t1/);
  });
});
