import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Sidebar } from './sidebar';
import { useUiStore } from '@/stores/ui-store';
import { navDestinations } from '@/features/core/lib/navigation-manifest';

vi.mock('@/features/operations/hooks/use-remediation', () => ({
  useRemediationActions: vi.fn(),
}));

import { useRemediationActions } from '@/features/operations/hooks/use-remediation';

const mockUseRemediationActions = vi.mocked(useRemediationActions);

function renderSidebar(props: { forceRail?: boolean } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Sidebar {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * Reads the rendered nav into an ordered list of { title, items } groups so
 * tests can assert both grouping and order. Each group is a direct `div.mb-2`
 * child of <nav>; the title is the header button's first span, items are <li>s.
 */
function getNavGroups() {
  const nav = screen.getByRole('navigation', { name: 'Primary' });
  const groupDivs = Array.from(nav.children).filter((el) =>
    el.classList.contains('mb-2'),
  ) as HTMLElement[];
  return groupDivs.map((group) => {
    const header = group.querySelector(':scope > button');
    const title = header?.querySelector('span')?.textContent?.trim() ?? '';
    const items = Array.from(group.querySelectorAll('li')).map((li) =>
      (li.textContent ?? '').trim(),
    );
    return { title, items };
  });
}

describe('Sidebar', () => {
  beforeEach(() => {
    useUiStore.persist?.clearStorage?.();
    useUiStore.setState({
      sidebarCollapsed: false,
      collapsedGroups: {},
    });
  });

  it('uses a symmetric 1rem inset on top, left, and bottom', () => {
    mockUseRemediationActions.mockReturnValue({ data: [] } as any);
    renderSidebar();
    const sidebar = screen.getByTestId('sidebar');
    expect(sidebar.className).toContain('top-4');
    expect(sidebar.className).toContain('left-4');
    expect(sidebar.className).toContain('bottom-4');
    // no leftover activity-feed bottom clearance
    expect(sidebar.className).not.toContain('bottom-12');
    expect(sidebar.className).not.toContain('bottom-2');
  });

  it('shows pending remediation count as badge', () => {
    mockUseRemediationActions.mockReturnValue({
      data: [
        { id: '1', type: 'restart', status: 'pending', containerId: 'c1', endpointId: 1, description: 'test', suggestedBy: 'ai', createdAt: '', updatedAt: '' },
        { id: '2', type: 'restart', status: 'pending', containerId: 'c2', endpointId: 1, description: 'test', suggestedBy: 'ai', createdAt: '', updatedAt: '' },
      ],
    } as any);

    renderSidebar();

    const badge = screen.getByText('2');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('bg-destructive');
  });

  it('shows no badge when there are zero pending actions', () => {
    mockUseRemediationActions.mockReturnValue({
      data: [],
    } as any);

    renderSidebar();

    // Remediation link should exist but no badge
    expect(screen.getByText(/Remediation/i)).toBeInTheDocument();
    // No destructive badge elements should exist
    const badges = document.querySelectorAll('.bg-destructive');
    expect(badges).toHaveLength(0);
  });

  it('shows no badge when data is undefined (loading)', () => {
    mockUseRemediationActions.mockReturnValue({
      data: undefined,
    } as any);

    renderSidebar();

    expect(screen.getByText(/Remediation/i)).toBeInTheDocument();
    const badges = document.querySelectorAll('.bg-destructive');
    expect(badges).toHaveLength(0);
  });

  it('renders sliding active indicator on current route item', () => {
    mockUseRemediationActions.mockReturnValue({
      data: [],
    } as any);

    renderSidebar();

    expect(screen.getByTestId('sidebar-active-indicator')).toBeInTheDocument();
  });

  it('renders the intent-based navigation groups in order', () => {
    mockUseRemediationActions.mockReturnValue({
      data: [],
    } as any);

    renderSidebar();

    expect(getNavGroups().map((g) => g.title)).toEqual([
      'Overview',
      'Monitoring',
      'Intelligence',
      'Diagnostics',
      'Security',
      'Operations',
    ]);
    // Old grab-bag groups are gone.
    expect(screen.queryByText('Backups')).not.toBeInTheDocument();
    expect(screen.getByText(/Settings/i)).toBeInTheDocument();
  });

  it('places Remediation under Operations, not Intelligence (observer-first: actions are separated)', () => {
    mockUseRemediationActions.mockReturnValue({ data: [] } as any);

    renderSidebar();

    const groups = getNavGroups();
    const intelligence = groups.find((g) => g.title === 'Intelligence');
    const operations = groups.find((g) => g.title === 'Operations');
    expect(intelligence?.items).not.toContain('Remediation');
    expect(operations?.items).toContain('Remediation');
  });

  it('consolidates the two monitoring views under the Monitoring group', () => {
    mockUseRemediationActions.mockReturnValue({ data: [] } as any);

    renderSidebar();

    const monitoring = getNavGroups().find((g) => g.title === 'Monitoring');
    expect(monitoring?.items).toEqual(['Health & Monitoring', 'Metrics Dashboard']);
  });

  it('keeps the two log views adjacent under Diagnostics', () => {
    mockUseRemediationActions.mockReturnValue({ data: [] } as any);

    renderSidebar();

    const diagnostics = getNavGroups().find((g) => g.title === 'Diagnostics');
    const items = diagnostics?.items ?? [];
    const logViewer = items.indexOf('Log Viewer');
    const edgeLogs = items.indexOf('Edge Logs');
    expect(logViewer).toBeGreaterThanOrEqual(0);
    expect(edgeLogs).toBeGreaterThanOrEqual(0);
    expect(Math.abs(logViewer - edgeLogs)).toBe(1);
  });

  it('gives Security its own group containing the Security Audit view', () => {
    mockUseRemediationActions.mockReturnValue({ data: [] } as any);

    renderSidebar();

    const security = getNavGroups().find((g) => g.title === 'Security');
    expect(security?.items).toContain('Security Audit');
  });

  it('pins the Settings link below the nav groups, not inside one', () => {
    mockUseRemediationActions.mockReturnValue({ data: [] } as any);

    renderSidebar();

    // Settings remains reachable...
    expect(screen.getByRole('link', { name: /Settings/i })).toBeInTheDocument();
    // ...but is no longer an item inside any of the titled groups.
    for (const group of getNavGroups()) {
      expect(group.items).not.toContain('Settings');
    }
  });

  it('renders collapse toggle button', () => {
    mockUseRemediationActions.mockReturnValue({
      data: [],
    } as any);

    renderSidebar();

    expect(screen.getByLabelText('Collapse sidebar')).toBeInTheDocument();
  });

  it('renders animated badge with data-testid', () => {
    mockUseRemediationActions.mockReturnValue({
      data: [
        { id: '1', type: 'restart', status: 'pending', containerId: 'c1', endpointId: 1, description: 'test', suggestedBy: 'ai', createdAt: '', updatedAt: '' },
      ],
    } as any);

    renderSidebar();

    const badge = screen.getByTestId('sidebar-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('1');
  });

  // --- Navigation is made of real links -----------------------------------

  it('renders every destination as an anchor with an href, not a button', () => {
    mockUseRemediationActions.mockReturnValue({ data: [] } as any);

    renderSidebar();

    const expected = navDestinations.filter(
      (d) => !d.paletteOnly && d.featureGate === undefined,
    );
    for (const destination of expected) {
      const link = screen.getByRole('link', { name: new RegExp(`^${destination.label}$`, 'i') });
      expect(link.tagName).toBe('A');
      expect(link).toHaveAttribute('href', destination.path);
    }
    // Middle-click / Cmd-click need an href; nothing in the nav list is a button.
    const navList = screen.getByRole('navigation', { name: 'Primary' });
    expect(navList.querySelectorAll('li button')).toHaveLength(0);
  });

  it('routes Home client-side like every other destination (no full page reload)', () => {
    mockUseRemediationActions.mockReturnValue({ data: [] } as any);
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, assign },
    });

    try {
      renderSidebar();
      const home = screen.getByRole('link', { name: /^Home$/i });
      expect(home).toHaveAttribute('href', '/');
      home.click();
      expect(assign).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });

  it('marks the active destination with aria-current', () => {
    mockUseRemediationActions.mockReturnValue({ data: [] } as any);
    renderSidebar();
    expect(screen.getByRole('link', { name: /^Home$/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /^Reports$/i })).not.toHaveAttribute('aria-current');
  });

  it('names the nav and exposes group expansion state to assistive tech', () => {
    mockUseRemediationActions.mockReturnValue({ data: [] } as any);
    renderSidebar();
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  // --- Scroll affordance ---------------------------------------------------

  it('shows no scroll cue when the nav fits', () => {
    mockUseRemediationActions.mockReturnValue({ data: [] } as any);
    renderSidebar();
    expect(screen.queryByTestId('scroll-gradient')).toBeNull();
  });

  it('draws a scroll cue that is visible on light themes when groups fall below the fold', () => {
    mockUseRemediationActions.mockReturnValue({ data: [] } as any);
    const scrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => 600,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 300,
    });

    try {
      renderSidebar();
      const cue = screen.getByTestId('scroll-gradient');
      // A hard rule at the cut line, plus a fade at real opacity — the old
      // 8px `from-sidebar-background/40` fade was invisible on light themes.
      expect(cue.className).toContain('border-b');
      expect(cue.className).toContain('border-sidebar-border');
      expect(cue.className).toContain('from-sidebar-background');
      expect(cue.className).not.toContain('from-sidebar-background/40');
    } finally {
      if (scrollHeight) {
        Object.defineProperty(HTMLElement.prototype, 'scrollHeight', scrollHeight);
      }
      if (clientHeight) {
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', clientHeight);
      }
    }
  });

  // --- Tablet rail --------------------------------------------------------

  it('collapses to the 64px icon rail when the viewport forces it', () => {
    mockUseRemediationActions.mockReturnValue({ data: [] } as any);
    renderSidebar({ forceRail: true });

    expect(screen.getByTestId('sidebar').className).toContain('w-16');
    expect(screen.getByTestId('sidebar').className).not.toContain('w-64');
    // The manual toggle would be a no-op at this width.
    expect(screen.queryByLabelText(/sidebar$/i)).toBeNull();
  });

  it('keeps the full width when the viewport allows it', () => {
    mockUseRemediationActions.mockReturnValue({ data: [] } as any);
    renderSidebar();
    expect(screen.getByTestId('sidebar').className).toContain('w-64');
  });
});
