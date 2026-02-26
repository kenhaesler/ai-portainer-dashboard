import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { createElement } from 'react';
import ContainerComparison from './container-comparison';

vi.mock('@/shared/lib/api', () => ({
  api: {
    get: vi.fn(),
    request: vi.fn(),
  },
}));

vi.mock('@/shared/hooks/use-auto-refresh', () => ({
  useAutoRefresh: () => ({
    interval: 30,
    setInterval: vi.fn(),
    enabled: true,
    toggle: vi.fn(),
    options: [0, 15, 30, 60, 120, 300],
  }),
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

import { api } from '@/shared/lib/api';
const mockApi = vi.mocked(api);

const mockContainers = [
  {
    id: 'abc123',
    name: 'web-app-1',
    image: 'nginx:latest',
    state: 'running',
    status: 'Up 2 hours',
    endpointId: 1,
    endpointName: 'prod-1',
    ports: [],
    created: 1700000000,
    labels: { 'com.docker.compose.service': 'web' },
    networks: ['bridge'],
    healthStatus: 'healthy',
  },
  {
    id: 'def456',
    name: 'web-app-2',
    image: 'nginx:latest',
    state: 'running',
    status: 'Up 3 hours',
    endpointId: 1,
    endpointName: 'prod-1',
    ports: [],
    created: 1700000100,
    labels: { 'com.docker.compose.service': 'web', 'version': '2.0' },
    networks: ['bridge', 'backend'],
    healthStatus: 'unhealthy',
  },
  {
    id: 'ghi789',
    name: 'api-server',
    image: 'node:20',
    state: 'exited',
    status: 'Exited (0)',
    endpointId: 2,
    endpointName: 'staging',
    ports: [],
    created: 1699999900,
    labels: {},
    networks: [],
  },
];

function createWrapper(initialEntries = ['/comparison']) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(MemoryRouter, { initialEntries }, children),
    );
}

describe('ContainerComparison', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.get.mockResolvedValue(mockContainers);
  });

  it('should render the page header', async () => {
    render(createElement(ContainerComparison), { wrapper: createWrapper() });

    expect(screen.getByText('Container Comparison')).toBeInTheDocument();
    expect(
      screen.getByText('Compare metrics, configuration, and status across containers'),
    ).toBeInTheDocument();
  });

  it('should show "Add container" button', async () => {
    render(createElement(ContainerComparison), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Add container')).toBeInTheDocument();
    });
  });

  it('should show info message when fewer than 2 containers selected', async () => {
    render(createElement(ContainerComparison), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(
        screen.getByText(/Select at least 2 containers to compare/),
      ).toBeInTheDocument();
    });
  });

  it('should show container search dropdown when clicking Add', async () => {
    render(createElement(ContainerComparison), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Add container')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Add container'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search containers...')).toBeInTheDocument();
    });
  });

  it('should show containers in search dropdown', async () => {
    render(createElement(ContainerComparison), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Add container')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Add container'));

    await waitFor(() => {
      expect(screen.getByText('web-app-1')).toBeInTheDocument();
      expect(screen.getByText('web-app-2')).toBeInTheDocument();
      expect(screen.getByText('api-server')).toBeInTheDocument();
    });
  });

  it('should filter containers by search text', async () => {
    render(createElement(ContainerComparison), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Add container')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Add container'));

    const searchInput = screen.getByPlaceholderText('Search containers...');
    fireEvent.change(searchInput, { target: { value: 'api' } });

    await waitFor(() => {
      expect(screen.getByText('api-server')).toBeInTheDocument();
      expect(screen.queryByText('web-app-1')).not.toBeInTheDocument();
    });
  });
});
