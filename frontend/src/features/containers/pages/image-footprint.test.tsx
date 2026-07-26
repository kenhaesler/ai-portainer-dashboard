import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('react-dom', async () => {
  const actual = await vi.importActual('react-dom');
  return { ...actual, createPortal: (node: any) => node };
});

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: any) => <>{children}</>,
  m: {
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
  KpiCard: ({ label, value, trendValue }: any) => (
    <div data-testid="kpi-card">
      <span>{label}</span>
      <span>{value}</span>
      {trendValue && <span>{trendValue}</span>}
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

    // h1 matches the navigation manifest's short label ("Images"), not the
    // longer sidebar-era title the page used to carry.
    expect(screen.getByRole('heading', { level: 1, name: 'Images' })).toBeInTheDocument();
    expect(screen.getByTestId('page-header')).toBeInTheDocument();
    expect(screen.getByTestId('image-treemap')).toBeInTheDocument();
    expect(screen.getByTestId('image-sunburst')).toBeInTheDocument();
  });

  it('drops the subtitle that promised layer composition', () => {
    render(<ImageFootprintPage />);

    expect(screen.queryByTestId('page-header-subtitle')).not.toBeInTheDocument();
    expect(screen.queryByText(/layer composition/i)).not.toBeInTheDocument();
  });

  it('does not restate the charts’ own titles in explanatory sentences', () => {
    render(<ImageFootprintPage />);

    expect(screen.queryByText(/Larger boxes indicate larger images/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Shows total image size grouped by container registry/i),
    ).not.toBeInTheDocument();
  });

  it('renders the same page header in the error branch', () => {
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

    expect(screen.getByRole('heading', { level: 1, name: 'Images' })).toBeInTheDocument();
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
    // Three images on this page: one up to date, one stale, one never checked.
    const pageImages = [
      { ...defaultImageData[0], id: 'img-1', name: 'nginx' },
      { ...defaultImageData[0], id: 'img-2', name: 'redis', size: 40_000_000 },
      { ...defaultImageData[0], id: 'img-3', name: 'busybox', size: 5_000_000 },
    ];

    // The API-wide summary deliberately disagrees with the page's image list —
    // 57 checked rows above a 3-row table was the reported bug.
    const stalenessData = {
      summary: { total: 57, upToDate: 7, stale: 4, unchecked: 46 },
      records: [
        { image_name: 'nginx', is_stale: 0, last_checked_at: '2026-01-01T00:00:00.000Z' },
        { image_name: 'redis', is_stale: 1, last_checked_at: '2026-01-01T00:00:00.000Z' },
        // A record for an image that is not on this page — must not be counted.
        { image_name: 'ghost', is_stale: 1, last_checked_at: '2026-01-01T00:00:00.000Z' },
      ],
    };

    function renderWithStaleness() {
      mockUseImages.mockReturnValue({
        data: pageImages,
        isLoading: false,
        isPending: false,
        isError: false,
        error: null,
        refetch: mockRefetch,
        isFetching: false,
      });
      mockUseImageStaleness.mockReturnValue({ data: stalenessData });
      return render(<ImageFootprintPage />);
    }

    it('renders the three KPI cards inside a single grid container when staleness data is available', () => {
      const { container } = renderWithStaleness();

      // The Staleness Summary grid is identified by a stable class hook so the
      // test does not depend on Tailwind utility ordering.
      const grid = container.querySelector('.staleness-summary-grid');
      expect(grid).not.toBeNull();

      // All three KPI cards must be children (transitively) of the same grid
      // container — overlap regressions happen when a card escapes the grid
      // track or is rendered outside its expected parent.
      // Scoped to the grid: "Up to Date" also appears as a row status badge in
      // the table below, which is precisely the reconciliation this page owes.
      const labels = ['Checked', 'Up to Date', 'Stale'];
      const cardsInsideGrid = labels.map((label) => within(grid as HTMLElement).getByText(label));
      expect(cardsInsideGrid).toHaveLength(3);
    });

    it('scopes the tile counts to the images the table shows, not the whole staleness table', () => {
      renderWithStaleness();

      const checked = screen.getByTestId('staleness-tile-checked');
      const upToDate = screen.getByTestId('staleness-tile-upToDate');
      const stale = screen.getByTestId('staleness-tile-stale');

      // 3 images on this page, 2 of them have a staleness record.
      expect(checked).toHaveTextContent('2');
      expect(checked).toHaveTextContent('of 3 images');
      expect(upToDate).toHaveTextContent('1');
      expect(stale).toHaveTextContent('1');

      // None of the API-wide numbers may leak through.
      expect(checked).not.toHaveTextContent('57');
      expect(upToDate).not.toHaveTextContent('7');
      expect(stale).not.toHaveTextContent('4');
    });

    it('the Stale tile filters the table down to the stale rows', () => {
      renderWithStaleness();

      // All three rows before filtering.
      expect(screen.getByText('nginx')).toBeInTheDocument();
      expect(screen.getByText('redis')).toBeInTheDocument();
      expect(screen.getByText('busybox')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('staleness-tile-stale'));

      expect(screen.getByText('redis')).toBeInTheDocument();
      expect(screen.queryByText('nginx')).not.toBeInTheDocument();
      expect(screen.queryByText('busybox')).not.toBeInTheDocument();
      expect(screen.getByTestId('image-status-filter')).toHaveTextContent('1 of 3 images');
    });

    it('clicking the active tile again clears the filter', () => {
      renderWithStaleness();

      fireEvent.click(screen.getByTestId('staleness-tile-stale'));
      expect(screen.queryByText('nginx')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('staleness-tile-stale'));
      expect(screen.getByText('nginx')).toBeInTheDocument();
      expect(screen.queryByTestId('image-status-filter')).not.toBeInTheDocument();
    });

    it('"Show all images" clears the filter', () => {
      renderWithStaleness();

      fireEvent.click(screen.getByTestId('staleness-tile-upToDate'));
      expect(screen.queryByText('redis')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Show all images' }));
      expect(screen.getByText('redis')).toBeInTheDocument();
    });

    it('exposes each tile as a keyboard-operable toggle', () => {
      renderWithStaleness();

      const stale = screen.getByTestId('staleness-tile-stale');
      expect(stale).toHaveAttribute('role', 'button');
      expect(stale).toHaveAttribute('tabindex', '0');
      expect(stale).toHaveAttribute('aria-pressed', 'false');

      fireEvent.keyDown(stale, { key: 'Enter' });
      expect(screen.getByTestId('staleness-tile-stale')).toHaveAttribute('aria-pressed', 'true');
    });

    it('uses a generous gap so transformed cards stay clear of their neighbours', () => {
      const { container } = renderWithStaleness();

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

    it('does not render the staleness grid when none of this page’s images were checked', () => {
      // The staleness table has rows, but none of them are for an image the
      // table below is showing — the tiles would be unresolvable to any row.
      mockUseImageStaleness.mockReturnValue({
        data: {
          summary: { total: 57, upToDate: 7, stale: 4, unchecked: 46 },
          records: [
            { image_name: 'ghost', is_stale: 1, last_checked_at: '2026-01-01T00:00:00.000Z' },
          ],
        },
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
