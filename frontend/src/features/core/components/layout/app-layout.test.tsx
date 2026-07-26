import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// --- Mock the heavy shell children to focused stubs. The real Sidebar already
// --- carries data-testid="sidebar"; the stub mirrors that so the test asserts
// --- AppLayout still renders the sidebar slot when a page throws.
vi.mock('@/features/core/components/layout/sidebar', () => ({
  Sidebar: ({ forceRail }: { forceRail?: boolean }) => (
    <div data-testid="sidebar" data-force-rail={forceRail ? 'true' : 'false'} />
  ),
}));
vi.mock('@/features/core/components/layout/header', () => ({
  Header: () => <div data-testid="header" />,
}));
vi.mock('@/features/core/components/layout/mobile-bottom-nav', () => ({
  MobileBottomNav: () => null,
}));
vi.mock('@/features/core/components/layout/command-palette', () => ({
  CommandPalette: () => null,
}));
vi.mock('@/features/core/components/layout/dashboard-background', () => ({
  DashboardBackground: () => null,
}));
vi.mock('@/shared/components/ui/keyboard-shortcuts-overlay', () => ({
  KeyboardShortcutsOverlay: () => null,
}));

vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));

// ui-store is called both as useUiStore(selector) and useUiStore(), plus
// useUiStore.getState() inside a keyboard-shortcut callback.
const uiState = {
  sidebarCollapsed: false,
  potatoMode: false,
  commandPaletteOpen: false,
  setCommandPaletteOpen: vi.fn(),
  setSidebarCollapsed: vi.fn(),
};
vi.mock('@/stores/ui-store', () => ({
  useUiStore: Object.assign(
    (selector?: (_s: typeof uiState) => unknown) =>
      selector ? selector(uiState) : uiState,
    { getState: () => uiState },
  ),
}));

vi.mock('@/stores/theme-store', () => ({
  useThemeStore: () => ({
    theme: 'glass-dark',
    setTheme: vi.fn(),
    dashboardBackground: 'none',
  }),
  themeOptions: [{ value: 'glass-dark' }, { value: 'glass-light' }],
}));

vi.mock('@/shared/hooks/use-entrance-played', () => ({
  useEntrancePlayed: () => ({ hasPlayed: true, markPlayed: vi.fn() }),
}));
vi.mock('@/shared/hooks/use-key-chord', () => ({ useKeyChord: () => {} }));
vi.mock('@/shared/hooks/use-keyboard-shortcut', () => ({
  useKeyboardShortcut: () => {},
}));

// Force the reduced-motion path (plain <Outlet/>, no AnimatePresence) for a
// deterministic render.
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return { ...actual, useReducedMotion: () => true };
});

import { AppLayout, NAV_CHORDS } from './app-layout';
import { RouteErrorBoundary } from '@/shared/components/feedback/route-error-boundary';
import { navDestinations, breadcrumbLabelForPath } from '@/features/core/lib/navigation-manifest';

function Boom(): never {
  throw new Error('page exploded');
}

function renderAt(child: ReactNode = <Boom />) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <AppLayout />,
        errorElement: <RouteErrorBoundary />, // mirrors router.tsx
        children: [{ index: true, element: child }],
      },
    ],
    { initialEntries: ['/'] },
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('AppLayout shell resilience', () => {
  it('keeps the sidebar mounted when the active page throws', () => {
    // Suppress the expected React error log noise for this render.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderAt();
    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    spy.mockRestore();
  });
});

describe('g-chord navigation', () => {
  it('only jumps to paths that exist in the route manifest', () => {
    const manifestPaths = navDestinations.map((d) => d.path);
    for (const [keys, path] of NAV_CHORDS) {
      expect(manifestPaths, `chord ${keys} points at an unknown path`).toContain(path);
    }
  });

  it('assigns each chord a unique key sequence', () => {
    const keys = NAV_CHORDS.map(([k]) => k);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('names destinations exactly as the sidebar does', () => {
    for (const [, path] of NAV_CHORDS) {
      expect(breadcrumbLabelForPath(path)).toBeTruthy();
    }
    // The overlay used to say "Go to Trace Explorer" while the nav said Traces.
    expect(breadcrumbLabelForPath('/traces')).toBe('Traces');
    expect(breadcrumbLabelForPath('/assistant')).toBe('Assistant');
  });
});

describe('AppLayout tablet rail', () => {
  function stubMatchMedia(matches: (query: string) => boolean) {
    const original = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: matches(query),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    });
    return () => {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: original,
      });
    };
  }

  it('gives the content the full sidebar width above 1024px', () => {
    const restore = stubMatchMedia(() => false);
    try {
      renderAt(<div>page</div>);
      expect(screen.getByTestId('sidebar')).toHaveAttribute('data-force-rail', 'false');
      expect(screen.getByTestId('app-content').className).toContain('md:ml-[calc(256px+2rem)]');
    } finally {
      restore();
    }
  });

  it('collapses to the 64px icon rail between 768px and 1023px', () => {
    const restore = stubMatchMedia((q) => q.includes('1023px'));
    try {
      renderAt(<div>page</div>);
      expect(screen.getByTestId('sidebar')).toHaveAttribute('data-force-rail', 'true');
      const content = screen.getByTestId('app-content');
      expect(content.className).toContain('md:ml-[calc(64px+2rem)]');
      expect(content.className).not.toContain('md:ml-[calc(256px+2rem)]');
    } finally {
      restore();
    }
  });
});
