import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SearchProvider } from '@/providers/search-provider';

/**
 * The app shell must offer a way past the navigation.
 *
 * Without one, reaching page content took 22-29 Tab presses through the
 * sidebar — on every route, on every visit — and the topology graph then added
 * roughly 70 more stops with no way past them. For a keyboard-first operations
 * tool that is not an edge case; it is the primary audience.
 *
 * These assertions run against the real `AppLayout` with the real `Sidebar` and
 * `Header` mounted, so the "first focusable element" claim is measured against
 * the actual navigation an operator would otherwise tab through. Only the
 * boundaries CI cannot reach are stubbed: auth, the Socket.IO provider and
 * `fetch`.
 *
 * The assertions are deliberately structural rather than visual: the link must
 * be the first focusable element, and it must point at a real element that can
 * receive focus. A skip link whose target is missing or unfocusable moves the
 * visual viewport and leaves focus where it was, which is worse than having
 * none at all because it looks like it worked.
 */

vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    username: 'admin',
    role: 'admin',
    logout: vi.fn(),
  }),
}));

vi.mock('@/providers/socket-provider', () => ({
  useSockets: () => ({ connected: false, monitoringSocket: null }),
}));

import { AppLayout } from './app-layout';

/**
 * Approximates DOM tab order; it is not a faithful model of a browser's.
 * jsdom applies no CSS, so the desktop sidebar (wrapped in `hidden md:block`)
 * and the mobile bottom nav (`md:hidden`) both render and are both counted —
 * a combination no real viewport produces. The list also omits
 * `[contenteditable]`, `details > summary` and `area[href]`, and
 * `input:not([disabled])` matches `input[type=hidden]`, which is never
 * tabbable.
 *
 * That is enough for the assertions below, which need DOM order plus evidence
 * that the navigation actually mounted — not an exact tab-stop total.
 * `[tabindex="-1"]` is excluded on purpose: that is exactly what the skip
 * target is supposed to be.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function renderShell() {
  // The sidebar and header both hold react-query hooks. Nothing here asserts on
  // their data, so a single empty payload keeps every query resolvable without
  // an unhandled rejection.
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve([]),
  } as Response);

  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <AppLayout />,
        children: [{ index: true, element: <p>page body</p> }],
      },
    ],
    { initialEntries: ['/'] },
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  // SearchProvider is the one context the shell requires that is not a store:
  // the command palette reads recent searches from it.
  return render(
    <QueryClientProvider client={queryClient}>
      <SearchProvider>
        <RouterProvider router={router} />
      </SearchProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('app shell skip link', () => {
  it('is the first focusable element in the rendered shell', () => {
    const { container } = renderShell();

    const focusable = Array.from(
      container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    );

    // Guards the assertion below against passing vacuously: if the sidebar had
    // failed to render, "first focusable" would be true of a shell with one
    // focusable element and would prove nothing.
    expect(focusable.length).toBeGreaterThan(10);
    expect(focusable[0]).toBe(screen.getByTestId('skip-to-content'));
  });

  it('points at the main landmark of the same render, which can take focus', () => {
    renderShell();

    const link = screen.getByTestId('skip-to-content');
    const targetId = link.getAttribute('href')?.replace(/^#/, '') ?? '';
    const target = document.getElementById(targetId);

    expect(target).not.toBeNull();
    // The destination must be the content landmark, not an arbitrary wrapper.
    expect(target).toBe(screen.getByRole('main'));
    // -1 keeps it out of the tab order while still allowing programmatic and
    // fragment-navigation focus, which is exactly what a skip target needs.
    expect(target).toHaveAttribute('tabindex', '-1');

    // jsdom refuses focus() on an element that is not a focusable area, so this
    // fails outright if the tabIndex is dropped from <main>.
    target!.focus();
    expect(document.activeElement).toBe(target);
  });

  it('is hidden until focused rather than removed from the accessibility tree', () => {
    renderShell();

    // `sr-only` keeps it announced and reachable; `hidden`/`display:none`
    // would take it out of the tab order and defeat the purpose.
    const link = screen.getByRole('link', { name: 'Skip to content' });
    expect(link.className).toContain('sr-only');
    expect(link.className).toContain('focus:not-sr-only');
    expect(link).not.toHaveAttribute('hidden');
    expect(link).not.toHaveAttribute('aria-hidden');
  });
});
