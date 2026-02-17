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

vi.mock('@/hooks/use-endpoints', () => ({
  useEndpoints: () => ({
    data: [{ id: 1, name: 'local' }],
  }),
}));

vi.mock('@/hooks/use-images', () => ({
  useImages: () => ({
    data: [
      {
        id: 'img-1',
        name: 'nginx',
        tags: ['nginx:latest'],
        size: 100_000_000,
        registry: 'docker.io',
        endpointId: 1,
        endpointName: 'local',
      },
    ],
    isLoading: false,
    isError: false,
    error: null,
    refetch: mockRefetch,
    isFetching: false,
  }),
}));

vi.mock('@/hooks/use-auto-refresh', () => ({
  useAutoRefresh: () => ({
    interval: 60,
    setInterval: mockSetInterval,
  }),
}));

vi.mock('@/hooks/use-image-staleness', () => ({
  useImageStaleness: () => ({ data: null }),
}));

vi.mock('@/hooks/use-force-refresh', () => ({
  useForceRefresh: () => ({
    forceRefresh: mockForceRefresh,
    isForceRefreshing: false,
  }),
}));

vi.mock('@/components/charts/image-treemap', () => ({
  ImageTreemap: () => <div data-testid="image-treemap" />,
}));

vi.mock('@/components/charts/image-sunburst', () => ({
  ImageSunburst: () => <div data-testid="image-sunburst" />,
}));

vi.mock('@/components/shared/themed-select', () => ({
  ThemedSelect: () => <div data-testid="themed-select" />,
}));

vi.mock('@/components/shared/auto-refresh-toggle', () => ({
  AutoRefreshToggle: () => <div data-testid="auto-refresh-toggle" />,
}));

vi.mock('@/components/shared/refresh-button', () => ({
  RefreshButton: () => <button type="button">Refresh</button>,
}));

vi.mock('@/components/shared/loading-skeleton', () => ({
  SkeletonCard: () => <div data-testid="skeleton-card" />,
}));

vi.mock('@/lib/motion-tokens', () => ({
  spring: { snappy: { type: 'spring', stiffness: 400, damping: 25 } },
  duration: { fast: 0.15, base: 0.25, slow: 0.4, slower: 0.6 },
  easing: { default: [0.4, 0, 0.2, 1], pop: [0.32, 0.72, 0, 1] },
  transition: { page: { duration: 0.4 } },
  pageVariants: {},
}));

vi.mock('@/components/shared/motion-page', () => ({
  MotionPage: ({ children }: any) => <div data-testid="motion-page">{children}</div>,
  MotionReveal: ({ children }: any) => <div>{children}</div>,
  MotionStagger: ({ children, className }: any) => <div className={className}>{children}</div>,
}));

vi.mock('@/components/shared/spotlight-card', () => ({
  SpotlightCard: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/components/shared/kpi-card', () => ({
  KpiCard: ({ label, value }: any) => (
    <div data-testid="kpi-card">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  ),
}));

vi.mock('@/components/shared/data-table', () => ({
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
});
