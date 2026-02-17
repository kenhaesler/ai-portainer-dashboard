import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import StackOverviewPage from './stack-overview';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('@/hooks/use-stacks', () => ({
  useStacks: vi.fn(),
}));

vi.mock('@/hooks/use-endpoints', () => ({
  useEndpoints: vi.fn(),
}));

vi.mock('@/hooks/use-auto-refresh', () => ({
  useAutoRefresh: () => ({ interval: 30, setInterval: vi.fn() }),
}));

vi.mock('@/hooks/use-force-refresh', () => ({
  useForceRefresh: () => ({ forceRefresh: vi.fn(), isForceRefreshing: false }),
}));

import { useStacks } from '@/hooks/use-stacks';
import { useEndpoints } from '@/hooks/use-endpoints';

const mockUseStacks = vi.mocked(useStacks);
const mockUseEndpoints = vi.mocked(useEndpoints);

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <StackOverviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('StackOverviewPage', () => {
  it('renders inferred stacks with Discovered badge', () => {
    mockUseStacks.mockReturnValue({
      data: [
        { id: -12345, name: 'my-compose-app', type: 2, endpointId: 1, status: 'active', envCount: 0, source: 'compose-label', containerCount: 3 },
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);
    mockUseEndpoints.mockReturnValue({
      data: [{ id: 1, name: 'local' }],
      isLoading: false,
    } as any);

    renderPage();

    expect(screen.getByText('my-compose-app')).toBeInTheDocument();
    expect(screen.getByText('Discovered')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument(); // container count
  });

  it('handles missing metadata gracefully for inferred stacks', () => {
    mockUseStacks.mockReturnValue({
      data: [
        { id: -99, name: 'bare-app', type: 2, endpointId: 1, status: 'active', envCount: 0, source: 'compose-label', containerCount: 1 },
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);
    mockUseEndpoints.mockReturnValue({
      data: [{ id: 1, name: 'local' }],
      isLoading: false,
    } as any);

    renderPage();

    // Dates should show N/A for inferred stacks (no createdAt/updatedAt)
    const naElements = screen.getAllByText('N/A');
    expect(naElements.length).toBeGreaterThanOrEqual(2);
    // Should not show the numeric ID
    expect(screen.queryByText(/ID: -99/)).not.toBeInTheDocument();
  });

  it('shows Portainer stacks with standard layout', () => {
    mockUseStacks.mockReturnValue({
      data: [
        { id: 5, name: 'web-stack', type: 2, endpointId: 1, status: 'active', envCount: 3, source: 'portainer', createdAt: 1700000000, updatedAt: 1700001000 },
      ],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);
    mockUseEndpoints.mockReturnValue({
      data: [{ id: 1, name: 'local' }],
      isLoading: false,
    } as any);

    renderPage();

    expect(screen.getByText('web-stack')).toBeInTheDocument();
    expect(screen.getByText('ID: 5')).toBeInTheDocument();
    expect(screen.queryByText('Discovered')).not.toBeInTheDocument();
  });

  it('shows updated empty state message', () => {
    mockUseStacks.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);
    mockUseEndpoints.mockReturnValue({
      data: [],
      isLoading: false,
    } as any);

    renderPage();

    expect(screen.getByText('No stacks or compose projects detected')).toBeInTheDocument();
  });
});
