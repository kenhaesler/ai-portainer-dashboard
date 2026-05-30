import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Sidebar } from './sidebar';
import { useUiStore } from '@/stores/ui-store';

vi.mock('@/features/operations/hooks/use-remediation', () => ({
  useRemediationActions: vi.fn(),
}));

import { useRemediationActions } from '@/features/operations/hooks/use-remediation';

const mockUseRemediationActions = vi.mocked(useRemediationActions);

function renderSidebar() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Sidebar />
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
  const nav = screen.getByRole('navigation');
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
      'Diagnostics',
      'Intelligence',
      'Security',
      'Operations',
    ]);
    // Old grab-bag groups are gone.
    expect(screen.queryByText('Containers')).not.toBeInTheDocument();
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
    const edgeLogs = items.indexOf('Edge Agent Logs');
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
    expect(screen.getByRole('button', { name: /Settings/i })).toBeInTheDocument();
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
});
