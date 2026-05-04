import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import ImageFootprintPage from '../image-footprint';

// Recharts ResponsiveContainer needs layout measurements unavailable in jsdom.
vi.mock('recharts', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 600, height: 400 }}>{children}</div>
    ),
  };
});

vi.mock('@/features/containers/hooks/use-images', () => ({
  useImages: vi.fn(),
}));

vi.mock('@/features/containers/hooks/use-endpoints', () => ({
  useEndpoints: () => ({ data: [] }),
}));

vi.mock('@/shared/hooks/use-auto-refresh', () => ({
  useAutoRefresh: () => ({ interval: 60, setInterval: vi.fn(), enabled: false }),
}));

vi.mock('@/shared/hooks/use-force-refresh', () => ({
  useForceRefresh: () => ({ forceRefresh: vi.fn(), isForceRefreshing: false }),
}));

vi.mock('@/features/containers/hooks/use-image-staleness', () => ({
  useImageStaleness: () => ({ data: null }),
}));

import { useImages } from '@/features/containers/hooks/use-images';
const mockUseImages = vi.mocked(useImages);

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const sampleImages = [
  {
    id: 'sha256:abc',
    name: 'nginx',
    tags: ['nginx:latest'],
    size: 100_000_000,
    registry: 'docker.io',
    endpointId: 1,
    endpointName: 'local',
    created: 1700000000,
  },
  {
    id: 'sha256:def',
    name: 'redis',
    tags: ['redis:7'],
    size: 50_000_000,
    registry: 'docker.io',
    endpointId: 1,
    endpointName: 'local',
    created: 1700000000,
  },
];

describe('ImageFootprintPage accessibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the treemap group with "Image size treemap" aria-label when images are loaded', () => {
    mockUseImages.mockReturnValue({
      data: sampleImages,
      isLoading: false,
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);

    renderWithProviders(<ImageFootprintPage />);

    const treemapGroup = screen.getByRole('group', { name: 'Image size treemap' });
    expect(treemapGroup).toBeInTheDocument();
  });

  it('does not render treemap group when no images', () => {
    mockUseImages.mockReturnValue({
      data: [],
      isLoading: false,
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);

    renderWithProviders(<ImageFootprintPage />);

    expect(screen.queryByRole('group', { name: 'Image size treemap' })).not.toBeInTheDocument();
  });

  it('does not render treemap group during loading state', () => {
    mockUseImages.mockReturnValue({
      data: undefined,
      isLoading: true,
      isPending: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: true,
    } as any);

    renderWithProviders(<ImageFootprintPage />);

    expect(screen.queryByRole('group', { name: 'Image size treemap' })).not.toBeInTheDocument();
  });

  it('renders the image detail panel as a dialog with aria-label', async () => {
    mockUseImages.mockReturnValue({
      data: sampleImages,
      isLoading: false,
      isPending: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    } as any);

    renderWithProviders(<ImageFootprintPage />);

    // Click the "nginx" button in the data table to open the detail panel
    const tableButtons = screen.getAllByRole('button');
    const nginxTableButton = tableButtons.find(
      (btn) => btn.textContent === 'nginx',
    );
    expect(nginxTableButton).toBeDefined();

    await act(async () => {
      fireEvent.click(nginxTableButton!);
    });

    // The dialog is rendered via createPortal to document.body
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog.getAttribute('aria-label')).toMatch(/nginx/i);
  });
});
