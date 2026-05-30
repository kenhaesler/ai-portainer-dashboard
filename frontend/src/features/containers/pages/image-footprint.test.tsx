import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom');
  return { ...actual, createPortal: (node: any) => node };
});

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: any) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: any) => <div {...Object.fromEntries(Object.entries(props).filter(([k]) => !['variants', 'initial', 'animate', 'exit', 'transition'].includes(k)))}>{children}</div>,
  },
  useReducedMotion: () => false,
  useMotionValue: () => ({ set: vi.fn() }),
  useSpring: (v: any) => v,
}));

const mockSetInterval = vi.fn();
const mockRefetch = vi.fn();
const mockForceRefresh = vi.fn();

vi.mock('@/features/containers/hooks/use-endpoints', () => ({
  useEndpoints: () => ({
    data: [{ id: 1, name: 'local' }],
  }),
}));

const defaultImageData = [
  {
    id: 'img-1',
    name: 'nginx',
    tags: ['nginx:latest'],
    size: 100_000_000,
    registry: 'docker.io',
    endpointId: 1,
    endpointName: 'local',
  },
];

const mockUseImages = vi.fn().mockReturnValue({
  data: defaultImageData,
  isLoading: false,
  isPending: false,
  isError: false,
  error: null,
  refetch: mockRefetch,
  isFetching: false,
});

vi.mock('@/features/containers/hooks/use-images', () => ({
  useImages: (...args: unknown[]) => mockUseImages(...args),
}));

vi.mock('@/shared/hooks/use-auto-refresh', () => ({
  useAutoRefresh: () => ({
    interval: 60,
    setInterval: mockSetInterval,
    enabled: true,
  }),
}));

const mockUseImageStaleness = vi.fn().mockReturnValue({ data: null });

vi.mock('@/features/containers/hooks/use-image-staleness', () => ({
  useImageStaleness: (...args: unknown[]) => mockUseImageStaleness(...args),
}));

vi.mock('@/shared/hooks/use-force-refresh', () => ({
  useForceRefresh: () => ({
    forceRefresh: mockForceRefresh,
    isForceRefreshing: false,
  }),
}));

vi.mock('@/shared/components/charts/image-treemap', () => ({
  ImageTreemap: () => <div data-testid="image-treemap" />,
}));

vi.mock('@/shared/components/charts/image-sunburst', () => ({
  ImageSunburst: () => <div data-testid="image-sunburst" />,
}));

vi.mock('@/shared/components/ui/themed-select', () => ({
  ThemedSelect: () => <div data-testid="themed-select" />,
}));

vi.mock('@/shared/components/ui/refresh-controls', () => ({
  RefreshControls: () => <button type="button">Refresh</button>,
}));

vi.mock('@/shared/components/feedback/skeleton', () => ({
  SkeletonChart: () => <div data-testid="skeleton-card" />,
}));

vi.mock('@/shared/lib/motion-tokens', () => ({
  spring: { snappy: { type: 'spring', stiffness: 400, damping: 25 } },
  duration: { fast: 0.15, base: 0.25, slow: 0.4, slower: 0.6 },
  easing: { default: [0.4, 0, 0.2, 1], pop: [0.32, 0.72, 0, 1] },
  transition: { page: { duration: 0.4 } },
  pageVariants: {},
}));

vi.mock('@/shared/components/layout/motion-page', () => ({
  MotionPage: ({ children }: any) => <div data-testid="motion-page">{children}</div>,
  MotionReveal: ({ children }: any) => <div>{children}</div>,
  MotionStagger: ({ children, className }: any) => <div className={className}>{children}</div>,
}));

vi.mock('@/shared/components/data-display/spotlight-card', () => ({
  SpotlightCard: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/shared/components/data-display/kpi-card', () => ({
  KpiCard: ({ label, value }: any) => (
    <div data-testid="kpi-card">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  ),
}));

vi.mock('@/shared/components/tables/data-table', () => ({
  DataTable: ({ columns, data, searchPlaceholder }: any) => (
    <div data-testid="data-table">
      <input placeholder={searchPlaceholder} />
      <table>
        <thead>
          <tr>
            {columns.map((col: any) => (
              <th key={col.header}>{col.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row: any, i: number) => (
            <tr key={i}>
              {columns.map((col: any) => (
                <td key={col.header}>
                  {col.cell
                    ? col.cell({ row: { original: row }, getValue: () => row[col.accessorKey] })
                    : row[col.accessorKey]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ),
}));

import ImageFootprintPage from './image-footprint';

describe('ImageFootprintPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks wipes mockReturnValue too — restore the default each test
    mockUseImageStaleness.mockReturnValue({ data: null });
    mockUseImages.mockReturnValue({
      data: defaultImageData,
      isLoading: false,
      isPending: false,
      isError: false,
      error: null,
      refetch: mockRefetch,
      isFetching: false,
    });
  });

  it('renders the DataTable with image data and search', () => {
    render(<ImageFootprintPage />);

    expect(screen.getByTestId('data-table')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search images by name...')).toBeInTheDocument();
    expect(screen.getByText('nginx')).toBeInTheDocument();
  });

  it('renders charts and page header', () => {
    render(<ImageFootprintPage />);

    expect(screen.getByText('Image Footprint')).toBeInTheDocument();
    expect(screen.getByTestId('image-treemap')).toBeInTheDocument();
    expect(screen.getByTestId('image-sunburst')).toBeInTheDocument();
  });

  it('wraps the page in MotionPage', () => {
    render(<ImageFootprintPage />);

    expect(screen.getByTestId('motion-page')).toBeInTheDocument();
  });

  it('opens detail panel when clicking an image name', () => {
    render(<ImageFootprintPage />);

    // Panel should not be visible initially
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Click the image name button in the DataTable
    fireEvent.click(screen.getByText('nginx'));

    // Panel should appear with image details
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Disk Usage')).toBeInTheDocument();
  });

  it('closes detail panel on Escape key', () => {
    render(<ImageFootprintPage />);

    fireEvent.click(screen.getByText('nginx'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows skeleton cards when isPending and no data', () => {
    mockUseImages.mockReturnValue({
      data: undefined,
      isLoading: false,
      isPending: true,
      isError: false,
      error: null,
      refetch: mockRefetch,
      isFetching: false,
    });

    render(<ImageFootprintPage />);

    const skeletons = screen.getAllByTestId('skeleton-card');
    expect(skeletons.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByTestId('data-table')).not.toBeInTheDocument();
  });

  it('shows skeleton cards when isLoading is true', () => {
    mockUseImages.mockReturnValue({
      data: undefined,
      isLoading: true,
      isPending: true,
      isError: false,
      error: null,
      refetch: mockRefetch,
      isFetching: true,
    });

    render(<ImageFootprintPage />);

    const skeletons = screen.getAllByTestId('skeleton-card');
    expect(skeletons.length).toBeGreaterThanOrEqual(2);
  });

  it('passes refetchInterval to useImages based on auto-refresh settings', () => {
    render(<ImageFootprintPage />);

    expect(mockUseImages).toHaveBeenCalledWith(
      undefined,
      { refetchInterval: 60_000 },
    );
  });

  describe('staleness summary', () => {
    const stalenessData = {
      summary: { total: 12, upToDate: 9, stale: 3 },
      records: [],
    };

    it('renders the three KPI cards inside a single grid container when staleness data is available', () => {
      mockUseImageStaleness.mockReturnValue({ data: stalenessData });

      const { container } = render(<ImageFootprintPage />);

      // The Staleness Summary grid is identified by a stable class hook so the
      // test does not depend on Tailwind utility ordering.
      const grid = container.querySelector('.staleness-summary-grid');
      expect(grid).not.toBeNull();

      // All three KPI cards must be children (transitively) of the same grid
      // container — overlap regressions happen when a card escapes the grid
      // track or is rendered outside its expected parent.
      const labels = ['Checked', 'Up to Date', 'Stale'];
      const cardsInsideGrid = labels.map((label) => {
        const node = screen.getByText(label);
        expect(grid!.contains(node)).toBe(true);
        return node;
      });
      expect(cardsInsideGrid).toHaveLength(3);

      // KPI values render from the summary payload.
      expect(screen.getByText('12')).toBeInTheDocument();
      expect(screen.getByText('9')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('uses a generous gap so transformed cards stay clear of their neighbours', () => {
      mockUseImageStaleness.mockReturnValue({ data: stalenessData });

      const { container } = render(<ImageFootprintPage />);

      const grid = container.querySelector('.staleness-summary-grid');
      expect(grid).not.toBeNull();
      // gap-4 was too tight once TiltCard + KpiCard hover transforms compounded.
      // The fix bumped this to gap-6 — assert that explicitly so a future
      // refactor cannot silently shrink it back.
      expect(grid!.className).toContain('gap-6');
      expect(grid!.className).not.toMatch(/(?:^|\s)gap-4(?:\s|$)/);
    });

    it('does not render the staleness grid when there is no staleness data', () => {
      mockUseImageStaleness.mockReturnValue({ data: null });

      const { container } = render(<ImageFootprintPage />);

      expect(container.querySelector('.staleness-summary-grid')).toBeNull();
      expect(screen.queryByText('Checked')).not.toBeInTheDocument();
    });

    it('does not render the staleness grid when summary.total is zero', () => {
      mockUseImageStaleness.mockReturnValue({
        data: { summary: { total: 0, upToDate: 0, stale: 0 }, records: [] },
      });

      const { container } = render(<ImageFootprintPage />);

      expect(container.querySelector('.staleness-summary-grid')).toBeNull();
    });
  });

  describe('empty state', () => {
    it('renders the no-images empty state copy when images is an empty array', () => {
      mockUseImages.mockReturnValue({
        data: [],
        isLoading: false,
        isPending: false,
        isError: false,
        error: null,
        refetch: mockRefetch,
        isFetching: false,
      });

      render(<ImageFootprintPage />);

      expect(screen.getByText('No images found')).toBeInTheDocument();
      expect(
        screen.getByText('No Docker images found across any endpoints.'),
      ).toBeInTheDocument();

      // No charts, no data table when there is nothing to plot.
      expect(screen.queryByTestId('image-treemap')).not.toBeInTheDocument();
      expect(screen.queryByTestId('image-sunburst')).not.toBeInTheDocument();
      expect(screen.queryByTestId('data-table')).not.toBeInTheDocument();
    });

    it('renders the error state with a retry button when useImages errors', () => {
      mockUseImages.mockReturnValue({
        data: undefined,
        isLoading: false,
        isPending: false,
        isError: true,
        error: new Error('boom'),
        refetch: mockRefetch,
        isFetching: false,
      });

      render(<ImageFootprintPage />);

      expect(screen.getByText('Failed to load images')).toBeInTheDocument();
      expect(screen.getByText('boom')).toBeInTheDocument();

      const retry = screen.getByRole('button', { name: 'Try again' });
      fireEvent.click(retry);
      expect(mockRefetch).toHaveBeenCalled();
    });
  });
});
