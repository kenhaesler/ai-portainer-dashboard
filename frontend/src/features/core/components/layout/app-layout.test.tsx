import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// --- Mock the heavy shell children to focused stubs. The real Sidebar already
// --- carries data-testid="sidebar"; the stub mirrors that so the test asserts
// --- AppLayout still renders the sidebar slot when a page throws.
vi.mock('@/features/core/components/layout/sidebar', () => ({
  Sidebar: () => <div data-testid="sidebar" />,
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
    (selector?: (s: typeof uiState) => unknown) =>
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

import { AppLayout } from './app-layout';
import { RouteErrorBoundary } from '@/shared/components/feedback/route-error-boundary';

function Boom(): never {
  throw new Error('page exploded');
}

function renderAt() {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <AppLayout />,
        errorElement: <RouteErrorBoundary />, // mirrors router.tsx
        children: [{ index: true, element: <Boom /> }],
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
