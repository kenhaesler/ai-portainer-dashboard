import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

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

vi.mock('@/components/shared/motion-page', () => ({
  MotionPage: ({ children }: any) => <div data-testid="motion-page">{children}</div>,
  MotionReveal: ({ children }: any) => <div>{children}</div>,
  MotionStagger: ({ children, className }: any) => <div className={className}>{children}</div>,
}));

vi.mock('@/components/shared/tilt-card', () => ({
  TiltCard: ({ children }: any) => <div>{children}</div>,
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
              <td>{row.name}</td>
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
});
