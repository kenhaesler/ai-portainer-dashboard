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
  useTriggerStalenessCheck: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
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

import ImageFootprintPage from './image-footprint';

describe('ImageFootprintPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds left padding to the first table column header and cell', () => {
    render(<ImageFootprintPage />);

    const imageHeader = screen.getByRole('columnheader', { name: 'Image' });
    expect(imageHeader.className).toContain('pl-2');

    const imageCell = screen.getByText('nginx').closest('td');
    expect(imageCell).not.toBeNull();
    expect(imageCell?.className).toContain('pl-2');
  });
});
