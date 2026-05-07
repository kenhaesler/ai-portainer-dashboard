import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContainerComparisonView } from './container-comparison-view';
import type { Container } from '@/features/containers/hooks/use-containers';

vi.mock('@/features/containers/hooks/use-container-comparison', () => ({
  useComparisonMetrics: vi.fn(() => ({
    data: [],
    isLoading: false,
    isError: false,
    queries: [],
  })),
}));

vi.mock('recharts', () => ({
  LineChart: ({ children }: { children: React.ReactNode }) =>
    createElement('div', { 'data-testid': 'line-chart' }, children),
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
    createElement('div', null, children),
}));

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, node);
}

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'c1',
    name: 'web-app',
    image: 'nginx:1.25',
    state: 'running',
    status: 'Up 2 hours',
    endpointId: 1,
    endpointName: 'eA',
    ports: [],
    created: 1700000000,
    labels: {},
    networks: [],
    ...overrides,
  } as Container;
}

describe('ContainerComparisonView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a pill per compared container with a remove button', () => {
    const containers = [
      makeContainer({ id: 'c1', name: 'web-app' }),
      makeContainer({ id: 'c2', name: 'api' }),
    ];

    render(
      wrap(
        createElement(ContainerComparisonView, {
          containers,
          tab: 'metrics',
          onTabChange: vi.fn(),
          timeRange: '1h',
          onTimeRangeChange: vi.fn(),
          onRemove: vi.fn(),
        }),
      ),
    );

    expect(screen.getByText('web-app')).toBeInTheDocument();
    expect(screen.getByText('api')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Remove web-app from comparison'),
    ).toBeInTheDocument();
  });

  it('calls onRemove with the container id when the pill × is clicked', async () => {
    const containers = [makeContainer({ id: 'c1', name: 'web-app' })];
    const onRemove = vi.fn();

    render(
      wrap(
        createElement(ContainerComparisonView, {
          containers,
          tab: 'metrics',
          onTabChange: vi.fn(),
          timeRange: '1h',
          onTimeRangeChange: vi.fn(),
          onRemove,
        }),
      ),
    );

    await userEvent.click(screen.getByLabelText('Remove web-app from comparison'));
    expect(onRemove).toHaveBeenCalledWith('c1');
  });

  it('renders the metrics tab by default and shows the time-range strip', () => {
    const containers = [
      makeContainer({ id: 'c1', name: 'web-app' }),
      makeContainer({ id: 'c2', name: 'api' }),
    ];

    render(
      wrap(
        createElement(ContainerComparisonView, {
          containers,
          tab: 'metrics',
          onTabChange: vi.fn(),
          timeRange: '1h',
          onTimeRangeChange: vi.fn(),
          onRemove: vi.fn(),
        }),
      ),
    );

    expect(screen.getByText('CPU Usage')).toBeInTheDocument();
    expect(screen.getByText('Memory Usage')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '15m' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '7d' })).toBeInTheDocument();
  });

  it('calls onTabChange when a tab is clicked', async () => {
    const containers = [
      makeContainer({ id: 'c1', name: 'web-app' }),
      makeContainer({ id: 'c2', name: 'api' }),
    ];
    const onTabChange = vi.fn();

    render(
      wrap(
        createElement(ContainerComparisonView, {
          containers,
          tab: 'metrics',
          onTabChange,
          timeRange: '1h',
          onTimeRangeChange: vi.fn(),
          onRemove: vi.fn(),
        }),
      ),
    );

    await userEvent.click(screen.getByRole('button', { name: /Configuration/i }));
    expect(onTabChange).toHaveBeenCalledWith('config');
  });

  it('calls onTimeRangeChange when a range button is clicked', async () => {
    const containers = [
      makeContainer({ id: 'c1', name: 'web-app' }),
      makeContainer({ id: 'c2', name: 'api' }),
    ];
    const onTimeRangeChange = vi.fn();

    render(
      wrap(
        createElement(ContainerComparisonView, {
          containers,
          tab: 'metrics',
          onTabChange: vi.fn(),
          timeRange: '1h',
          onTimeRangeChange,
          onRemove: vi.fn(),
        }),
      ),
    );

    await userEvent.click(screen.getByRole('button', { name: '24h' }));
    expect(onTimeRangeChange).toHaveBeenCalledWith('24h');
  });
});
