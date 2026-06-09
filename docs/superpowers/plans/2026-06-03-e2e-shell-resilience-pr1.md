# Frontend Shell Resilience (#1420 PR 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A failing page must degrade to an inline error card while the navigation shell (sidebar + header) stays mounted — never the white-screen / route-error-page swap that removes the sidebar.

**Architecture:** In `router.tsx` the only `errorElement` over the authenticated subtree sits on the `/` route, *the same route that renders `<AppLayout>`*. So any render error thrown by a page (or a shared child it renders) makes React Router replace `<AppLayout>` — sidebar included — with the error page. The fix is a component-level `ErrorBoundary` wrapping the layout's `<Outlet>`, **below** `AppLayout`, so a page error is caught in the content area and the chrome survives. A second, test-driven pass hardens Portainer-dependent pages to render their own empty/error states (so users see an in-context message, not the generic boundary fallback); the boundary backstops anything the sweep misses.

**Tech Stack:** React 19, React Router v6 data router, TanStack Query v5, Vitest + @testing-library/react (jsdom), framer-motion.

**Branch:** `feature/1420-e2e-shell-resilience-and-mock` (already created off `dev`; carries the design doc). Category A (login selector) is a separate branch/PR and is intentionally NOT included here.

---

## File Structure

- **Modify** `frontend/src/features/core/components/layout/app-layout.tsx` — wrap the two `<Outlet>` render sites in a local `PageBoundary` (uses the existing `ErrorBoundary`). The boundary lives inside the route-keyed wrapper, so it resets on navigation.
- **Create** `frontend/src/features/core/components/layout/app-layout.test.tsx` — integration test proving a throwing child route keeps the sidebar mounted and shows the fallback.
- **Create** `frontend/src/shared/components/feedback/__tests__/render-failed-fleet.tsx` — a tiny shared render helper (QueryClient + MemoryRouter) for the per-page graceful-state tests.
- **Modify** the Portainer-dependent pages + their existing `*.test.tsx` to add a "renders a graceful state when fleet data is empty/unavailable (no throw)" case, guarding any unguarded child access the test surfaces. Pages in scope (from the audit):
  `home.tsx`, `ai-monitor.tsx`, `workload-explorer.tsx`, `fleet-overview.tsx`, `metrics-dashboard.tsx`, `network-topology.tsx`, `image-footprint.tsx`, `container-detail.tsx`, `reports.tsx`, `packet-capture.tsx`. (`log-viewer.tsx` and `security-audit.tsx` already use the `= []` guard pattern — reference, no change.)
- **Modify** `docs/architecture.md` — one paragraph documenting the page-level error boundary.

---

## Task 1: Outlet error boundary keeps the shell alive

**Files:**
- Modify: `frontend/src/features/core/components/layout/app-layout.tsx`
- Test: `frontend/src/features/core/components/layout/app-layout.test.tsx`

- [ ] **Step 1: Write the failing integration test**

Create `frontend/src/features/core/components/layout/app-layout.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run the test and confirm it FAILS**

Run: `cd frontend && npx vitest run src/features/core/components/layout/app-layout.test.tsx`
Expected: FAIL — without the boundary, `<Boom/>` propagates to the `/` route's `errorElement`, which replaces `<AppLayout>`; `getByTestId('sidebar')` throws "Unable to find element".

- [ ] **Step 3: Add the boundary to AppLayout**

In `frontend/src/features/core/components/layout/app-layout.tsx`:

Add to the React import (line 1) a type import, and import the boundary (after line 9):

```tsx
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
```
```tsx
import { ErrorBoundary } from '@/shared/components/feedback/error-boundary';
```

Add a local wrapper just above `function FrozenOutlet()` (line 25):

```tsx
/**
 * Catches render errors thrown by the active page so one failing route
 * degrades to an inline error card instead of unmounting the whole shell
 * (sidebar + header). It sits BELOW AppLayout in the tree, so the chrome
 * survives, and renders inside the route-keyed wrapper, so it resets
 * automatically on navigation. (#1420)
 */
function PageBoundary({ children }: { children: ReactNode }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}
```

Wrap the reduced-motion Outlet (currently line 235-238):

```tsx
          {disableVisualMotion ? (
            <div key={location.pathname} className="h-auto">
              <PageBoundary>
                <Outlet />
              </PageBoundary>
            </div>
          ) : (
```

Wrap the animated FrozenOutlet (currently line 265):

```tsx
                <PageBoundary>
                  <FrozenOutlet />
                </PageBoundary>
```

- [ ] **Step 4: Run the test and confirm it PASSES**

Run: `cd frontend && npx vitest run src/features/core/components/layout/app-layout.test.tsx`
Expected: PASS — the boundary catches `<Boom/>`, `data-testid="sidebar"` is present, and the default "Something went wrong" fallback renders.

- [ ] **Step 5: Typecheck + lint the changed files**

Run: `cd frontend && npx tsc --noEmit && npx eslint src/features/core/components/layout/app-layout.tsx src/features/core/components/layout/app-layout.test.tsx`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/core/components/layout/app-layout.tsx \
        frontend/src/features/core/components/layout/app-layout.test.tsx
git commit -m "fix(frontend): keep the app shell when a page errors (#1420)

A page render error bubbled to the / route's errorElement, which replaced
<AppLayout> (sidebar + header) with the error page. Wrap the layout Outlet in
an ErrorBoundary so a failing route degrades to an inline card while the shell
stays mounted. This is also why the CI E2E suite lost [data-testid=sidebar] on
every Portainer-backed route when Portainer was unreachable.

Refs #1420"
```

---

## Task 2: Per-page graceful state on empty/unavailable fleet data

Each Portainer-dependent page must render an empty/error affordance — not throw —
when its fleet queries return empty data or an error. The audit showed the
page-level `isError` branches already exist on most pages; the residual throws
come from **child components fed empty-but-not-errored data**. These tests drive
those out; where one fails, apply the established guard pattern (default arrays
with `= []`, or `if (!data) return <EmptyState .../>`) to the offending access.

**Files:**
- Create: `frontend/src/shared/components/feedback/__tests__/render-failed-fleet.tsx`
- Modify + Test: one page + its `*.test.tsx` per sub-step.

- [ ] **Step 1: Add the shared render helper**

Create `frontend/src/shared/components/feedback/__tests__/render-failed-fleet.tsx`:

```tsx
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Render a page under the minimum providers it needs (QueryClient + router)
 * with retries disabled. Pair with vi.mock of the page's data hooks set to
 * empty / errored so the test asserts the page degrades without throwing.
 */
export function renderPage(ui: ReactElement, route = '/') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}
```

- [ ] **Step 2: Commit the helper**

```bash
git add frontend/src/shared/components/feedback/__tests__/render-failed-fleet.tsx
git commit -m "test(frontend): shared render helper for failed-fleet page tests (#1420)"
```

- [ ] **Step 3: Worked template — `home.tsx` empty-fleet test**

Add to `frontend/src/features/core/pages/home.test.tsx` (mock the page's hooks to
the empty-success state — `data: []`, `isError: false` — the higher-risk path
that feeds children empty arrays):

```tsx
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderPage } from '@/shared/components/feedback/__tests__/render-failed-fleet';

vi.mock('@/features/core/hooks/use-dashboard-full', () => ({
  useDashboardFull: () => ({
    data: { summary: undefined, resources: undefined, endpoints: [] },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    isFetching: false,
  }),
}));
vi.mock('@/features/containers/hooks/use-containers', () => ({
  useContainers: () => ({ data: [], isLoading: false, isError: false }),
  useFavoriteContainers: () => ({ data: [] }),
}));

import HomePage from './home';

describe('HomePage empty fleet', () => {
  it('renders without throwing when the fleet is empty', () => {
    expect(() => renderPage(<HomePage />)).not.toThrow();
    // The shell is provided by AppLayout in production; here we only assert the
    // page body mounts (heading present) rather than crashing a child.
    expect(screen.getByRole('heading', { name: /home/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run the home test**

Run: `cd frontend && npx vitest run src/features/core/pages/home.test.tsx`
- If PASS: home already degrades; no page change needed.
- If FAIL with a `TypeError` from a child (e.g. `Cannot read properties of undefined`): open the named child component and guard the access using the codebase pattern, e.g. change `const { data: items } = useX()` to `const { data: items = [] } = useX()`, or add `if (!data) return <EmptyState variant="empty" icon={PackageOpen} title="No data" />;`. Re-run until PASS.

- [ ] **Step 5: Commit home**

```bash
git add frontend/src/features/core/pages/home.test.tsx frontend/src/features/core/pages/home.tsx
git commit -m "test(frontend): home degrades on empty fleet; guard child access (#1420)"
```

- [ ] **Step 6: Repeat Steps 3–5 for each remaining page**

For each of: `ai-monitor.tsx`, `workload-explorer.tsx`, `fleet-overview.tsx`,
`metrics-dashboard.tsx`, `network-topology.tsx`, `image-footprint.tsx`,
`container-detail.tsx`, `reports.tsx`, `packet-capture.tsx` —
add an empty-fleet test to its existing `*.test.tsx` mirroring Step 3 (mock that
page's specific data hooks from the audit to `{ data: [], isError: false }`,
and the page's primary query also to `{ data: undefined, isError: true }` in a
second case), assert `not.toThrow()` plus a visible affordance (the page's
heading, its `data-testid` error text, or `getByTestId('empty-state-card')`).
Guard any child access the test surfaces with the `= []` / `if (!data) return`
pattern. Commit per page with message
`test(frontend): <page> degrades on empty/unavailable fleet (#1420)`.

Hook references from the audit (exact destructure sites to mock):
- `ai-monitor.tsx:380` `useContainers()`
- `workload-explorer.tsx:111-113` `useEndpoints()`, `useStacks()`, `useContainers()`
- `fleet-overview.tsx:320,329` `useEndpoints()`, `useStacks()`
- `metrics-dashboard.tsx:149,152,154` `useEndpoints()`, `useContainers()`, `useStacks()`
- `network-topology.tsx:53-55` `useEndpoints()`, `useContainers()`, `useNetworks()`
- `image-footprint.tsx:28,30` `useEndpoints()`, `useImages()`
- `container-detail.tsx:43,47` `useContainerDetail()`, `useEndpoints()`
- `reports.tsx:412,413` `useEndpoints()`, `useContainers()`
- `packet-capture.tsx:80-82` `useEndpoints()`, `useContainers()`, `useStacks()`

- [ ] **Step 7: Run the full frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: all pass.

---

## Task 3: Document the page-level error boundary

**Files:**
- Modify: `docs/architecture.md`

- [ ] **Step 1: Add a short note**

Under the frontend/routing section of `docs/architecture.md`, add:

```markdown
### Page-level error isolation

`AppLayout` wraps the router `<Outlet>` in an `ErrorBoundary` (`PageBoundary`).
A render error in one page degrades to an inline error card while the sidebar
and header stay mounted, instead of bubbling to the `/` route's `errorElement`
and replacing the whole shell. The boundary resets on navigation because it
renders inside the route-keyed wrapper. See #1420.
```

- [ ] **Step 2: Commit**

```bash
git add docs/architecture.md
git commit -m "docs(architecture): note the page-level error boundary (#1420)"
```

---

## Self-Review

**1. Spec coverage:**
- Spec PR-1 item 1 (structural isolation) → Task 1. ✅
- Spec PR-1 item 2 (sweep all Portainer-dependent pages) → Task 2 (all audited pages enumerated). ✅
- Spec PR-1 item 3 (tests: throwing child keeps sidebar) → Task 1 Step 1. ✅
- Spec "every PR includes doc updates" → Task 3. ✅
- `.env.example` doc update: N/A for a frontend-only change (no new env var).

**2. Placeholder scan:** Task 2 Step 6 generalises a repeated procedure rather than
re-listing 9 near-identical blocks; the per-page hook sites are given explicitly and
the guard pattern + assertions are fully specified in Steps 3–4, so an engineer has
the concrete recipe. No "TBD"/"add error handling" hand-waves remain.

**3. Type/name consistency:** `PageBoundary` (AppLayout), `renderPage` (helper),
`ErrorBoundary` (existing, `fallback?` optional — default fallback shows
"Something went wrong", matched in Task 1 Step 1), `EmptyState` props
(`variant`/`icon`/`title`) used consistently. `RouteErrorBoundary` referenced in the
test matches `router.tsx`. ✅

**Note on Task 2 honesty:** Task 1 alone makes the E2E chrome specs pass (the boundary
guarantees the sidebar survives). Task 2 is a test-driven UX/defense-in-depth sweep;
some pages may already pass their new test (already guarded) — that is a documented
win, not a gap. Anything the sweep misses is still backstopped by the Task 1 boundary.
