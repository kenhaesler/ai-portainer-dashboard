import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { axe } from 'vitest-axe';
import * as axeMatchers from 'vitest-axe/matchers';
import ImageFootprintPage from '../image-footprint';

// Register vitest-axe matchers (toHaveNoViolations) in this test file.
// Mirrors the pattern used by frontend/src/test/a11y-pages.test.tsx — the
// shipped vitest-axe/extend-expect entry is empty in this version, and the
// linter strips bare expect.extend() from vitest.setup.ts.
expect.extend(axeMatchers);

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

  // ---------------------------------------------------------------------
  // Page-level wiring tests for the treemap.
  //
  // recharts' Treemap reports 0×0 in jsdom (no layout engine) and therefore
  // never paints its <CustomContent> cells. The cell-level ARIA contract
  // (role="button", aria-label "<name>, <bytes>", tabIndex=0, Enter/Space
  // activation, focus ring) is exhaustively covered by the dedicated
  // component test at src/shared/components/charts/image-treemap.test.tsx.
  //
  // To exercise the *page-level* wiring (ImageFootprint -> ImageTreemap
  // onCellClick -> setSelectedImage -> detail panel) we substitute
  // ImageTreemap with a faithful but jsdom-friendly stand-in that exposes
  // one focusable button per data row carrying the same ARIA contract the
  // real component renders. This lets us assert the page propagates clicks
  // and keyboard activation through to the detail panel, without depending
  // on recharts' SVG layout behaviour.
  // ---------------------------------------------------------------------
  describe('treemap wiring (with fake treemap)', () => {
    beforeEach(() => {
      vi.resetModules();
      mockUseImages.mockReturnValue({
        data: sampleImages,
        isLoading: false,
        isPending: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
        isFetching: false,
      } as any);
    });

    async function renderWithFakeTreemap() {
      vi.doMock('@/shared/components/charts/image-treemap', () => ({
        ImageTreemap: ({
          data,
          onCellClick,
        }: {
          data: { name: string; size: number }[];
          onCellClick?: (name: string) => void;
        }) => (
          <div role="group" aria-label="Image size treemap">
            {data.map((d) => (
              <button
                key={d.name}
                type="button"
                role="button"
                tabIndex={0}
                aria-label={`${d.name}, ${d.size} bytes`}
                onClick={() => onCellClick?.(d.name)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onCellClick?.(d.name);
                  }
                }}
                data-testid={`treemap-cell-${d.name}`}
              >
                {d.name}
              </button>
            ))}
          </div>
        ),
      }));

      // Re-import the page so it picks up the fake treemap.
      const Page = (await import('../image-footprint')).default;
      return renderWithProviders(<Page />);
    }

    it('renders one focusable treemap cell per non-empty image, each with role=button, aria-label, and tabIndex=0', async () => {
      await renderWithFakeTreemap();

      const group = screen.getByRole('group', { name: 'Image size treemap' });
      const nginxCell = screen.getByTestId('treemap-cell-nginx');
      const redisCell = screen.getByTestId('treemap-cell-redis');

      expect(group).toContainElement(nginxCell);
      expect(group).toContainElement(redisCell);

      for (const cell of [nginxCell, redisCell]) {
        expect(cell).toHaveAttribute('role', 'button');
        expect(cell).toHaveAttribute('tabindex', '0');
        const label = cell.getAttribute('aria-label') ?? '';
        // <name>, <size> contract — same shape ImageTreemap produces.
        expect(label).toMatch(/^(nginx|redis), \d+ bytes$/);
      }
    });

    it('opens the detail panel when a treemap cell is clicked', async () => {
      await renderWithFakeTreemap();

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByTestId('treemap-cell-nginx'));
      });

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      expect(dialog.getAttribute('aria-label')).toMatch(/nginx/i);
    });

    it('opens the detail panel when Enter is pressed on a focused treemap cell', async () => {
      await renderWithFakeTreemap();

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      const cell = screen.getByTestId('treemap-cell-nginx');
      await act(async () => {
        cell.focus();
        fireEvent.keyDown(cell, { key: 'Enter' });
      });

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      expect(dialog.getAttribute('aria-label')).toMatch(/nginx/i);
    });

    it('opens the detail panel when Space is pressed on a focused treemap cell', async () => {
      await renderWithFakeTreemap();

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      const cell = screen.getByTestId('treemap-cell-redis');
      await act(async () => {
        cell.focus();
        fireEvent.keyDown(cell, { key: ' ' });
      });

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      expect(dialog.getAttribute('aria-label')).toMatch(/redis/i);
    });

    it('does not open the detail panel for unrelated keys (Tab, Escape)', async () => {
      await renderWithFakeTreemap();

      const cell = screen.getByTestId('treemap-cell-nginx');
      await act(async () => {
        cell.focus();
        fireEvent.keyDown(cell, { key: 'Tab' });
        fireEvent.keyDown(cell, { key: 'Escape' });
      });

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  describe('axe audit', () => {
    it('has no WCAG 2.1 AA violations when images are loaded', async () => {
      mockUseImages.mockReturnValue({
        data: sampleImages,
        isLoading: false,
        isPending: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
        isFetching: false,
      } as any);

      const { container } = renderWithProviders(<ImageFootprintPage />);

      // Excluded rules:
      //   - color-contrast: jsdom has no layout/CSS engine; contrast cannot
      //     be evaluated. Covered by Playwright visual checks (Issue #435).
      //   - button-name: ThemedSelect (Radix combobox) trigger is a known
      //     pre-existing violation tracked in a11y-pages.test.tsx.
      //   - heading-order: page jumps h1 -> h3 for chart section headings,
      //     a known site-wide pattern (see a11y-pages.test.tsx Reports).
      const results = await axe(container, {
        rules: {
          'color-contrast': { enabled: false },
          'button-name': { enabled: false },
          'heading-order': { enabled: false },
        },
      });
      expect(results).toHaveNoViolations();
    });

    it('has no WCAG 2.1 AA violations in the empty state', async () => {
      mockUseImages.mockReturnValue({
        data: [],
        isLoading: false,
        isPending: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
        isFetching: false,
      } as any);

      const { container } = renderWithProviders(<ImageFootprintPage />);

      const results = await axe(container, {
        rules: {
          'color-contrast': { enabled: false },
          'button-name': { enabled: false },
          'heading-order': { enabled: false },
        },
      });
      expect(results).toHaveNoViolations();
    });
  });
});
