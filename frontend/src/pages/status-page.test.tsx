import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import type { ReactNode } from 'react';

// Mock framer-motion before importing component
vi.mock('framer-motion', () => ({
  useReducedMotion: vi.fn(() => false),
  motion: {
    div: ({ children, className, ...rest }: { children?: ReactNode; className?: string; [k: string]: unknown }) => {
      const safe: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) {
        if (['style', 'id', 'role', 'data-testid'].includes(k)) safe[k] = v;
      }
      return <div className={className} {...safe}>{children}</div>;
    },
  },
}));

import { useReducedMotion } from 'framer-motion';
const mockUseReducedMotion = vi.mocked(useReducedMotion);

function stubMatchMedia(reduce: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)' ? reduce : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function makeStatusData(overrides: Record<string, unknown> = {}) {
  return {
    title: 'System Status',
    description: 'Current system health',
    overallStatus: 'operational',
    uptime: { '24h': 99.99, '7d': 99.95, '30d': 99.9 },
    endpointUptime: { '24h': 100, '7d': 100, '30d': 99.8 },
    snapshot: {
      containersRunning: 12,
      containersStopped: 2,
      containersUnhealthy: 1,
      endpointsUp: 3,
      endpointsDown: 0,
      lastChecked: '2026-02-08T10:00:00Z',
    },
    uptimeTimeline: [
      { date: '2026-02-07', uptime_pct: 100 },
      { date: '2026-02-08', uptime_pct: 99.9 },
    ],
    recentIncidents: [],
    autoRefreshSeconds: 30,
    ...overrides,
  };
}

function mockFetchOk(data: unknown) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  } as Response);
}

async function renderPage(data?: unknown) {
  const statusData = data ?? makeStatusData();
  mockFetchOk(statusData);

  const mod = await import('./status-page');
  const StatusPage = mod.default;

  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(<StatusPage />);
  });

  await waitFor(() => {
    expect(screen.queryByText(/loading/i) ?? document.querySelector('.animate-spin')).toBeNull();
  });

  return result!;
}

describe('StatusPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubMatchMedia(false);
    mockUseReducedMotion.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders title and description', async () => {
    await renderPage();
    expect(screen.getByText('System Status')).toBeInTheDocument();
    expect(screen.getByText('Current system health')).toBeInTheDocument();
  });

  it('renders gradient mesh background', async () => {
    await renderPage();
    expect(screen.getByTestId('status-gradient')).toBeInTheDocument();
    expect(screen.getByTestId('status-gradient').className).toContain('login-gradient-mesh');
  });

  it('renders floating particles when motion enabled', async () => {
    await renderPage();
    expect(document.querySelectorAll('.login-particle')).toHaveLength(10);
  });

  it('hides particles when reduced motion is preferred', async () => {
    stubMatchMedia(true);
    mockUseReducedMotion.mockReturnValue(true);
    await renderPage();
    expect(document.querySelectorAll('.login-particle')).toHaveLength(0);
  });

  it('shows operational status banner', async () => {
    await renderPage();
    expect(screen.getByText('All Systems Operational')).toBeInTheDocument();
    const banner = screen.getByTestId('status-banner');
    expect(banner.className).toContain('bg-emerald-500/10');
  });

  it('shows degraded status banner', async () => {
    await renderPage(makeStatusData({ overallStatus: 'degraded' }));
    expect(screen.getByText('Partial System Degradation')).toBeInTheDocument();
    const banner = screen.getByTestId('status-banner');
    expect(banner.className).toContain('bg-yellow-500/10');
  });

  it('shows major outage status banner', async () => {
    await renderPage(makeStatusData({ overallStatus: 'major_outage' }));
    expect(screen.getByText('Major Outage')).toBeInTheDocument();
    const banner = screen.getByTestId('status-banner');
    expect(banner.className).toContain('bg-red-500/10');
  });

  it('displays uptime percentages', async () => {
    await renderPage();
    expect(screen.getByText('99.99%')).toBeInTheDocument();
    expect(screen.getByText('99.95%')).toBeInTheDocument();
    expect(screen.getByText('99.9%')).toBeInTheDocument();
  });

  it('renders snapshot metrics', async () => {
    await renderPage();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Stopped')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('Unhealthy')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Endpoints Up')).toBeInTheDocument();
  });

  it('handles null snapshot gracefully', async () => {
    await renderPage(makeStatusData({ snapshot: null }));
    expect(screen.queryByText('Current Status')).not.toBeInTheDocument();
  });

  it('renders uptime timeline', async () => {
    await renderPage();
    expect(screen.getByTestId('uptime-timeline')).toBeInTheDocument();
    expect(screen.getByText('Uptime History (90 days)')).toBeInTheDocument();
  });

  it('hides timeline when empty', async () => {
    await renderPage(makeStatusData({ uptimeTimeline: [] }));
    expect(screen.queryByText('Uptime History (90 days)')).not.toBeInTheDocument();
  });

  it('renders incidents', async () => {
    const incidents = [
      {
        id: '1',
        title: 'Database slowdown',
        severity: 'warning',
        status: 'resolved',
        created_at: new Date().toISOString(),
        resolved_at: new Date().toISOString(),
        summary: 'Slow queries detected',
      },
      {
        id: '2',
        title: 'API errors',
        severity: 'critical',
        status: 'active',
        created_at: new Date().toISOString(),
        resolved_at: null,
        summary: null,
      },
    ];
    await renderPage(makeStatusData({ recentIncidents: incidents }));
    expect(screen.getByText('Database slowdown')).toBeInTheDocument();
    expect(screen.getByText('Slow queries detected')).toBeInTheDocument();
    expect(screen.getByText('API errors')).toBeInTheDocument();
    expect(screen.getByText('Resolved')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('hides incidents section when empty', async () => {
    await renderPage(makeStatusData({ recentIncidents: [] }));
    expect(screen.queryByText('Recent Incidents')).not.toBeInTheDocument();
  });

  it('shows disabled message on 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({}),
    } as Response);

    const mod = await import('./status-page');
    const StatusPage = mod.default;

    await act(async () => {
      render(<StatusPage />);
    });

    await waitFor(() => {
      expect(screen.getByText(/not enabled/i)).toBeInTheDocument();
    });
  });

  it('shows refresh button', async () => {
    await renderPage();
    expect(screen.getByText('Refresh')).toBeInTheDocument();
  });

  it('calls fetch on refresh button click', async () => {
    await renderPage();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeStatusData()),
    } as Response);

    fireEvent.click(screen.getByText('Refresh'));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/status');
    });
  });

  it('auto-refreshes at configured interval', async () => {
    await renderPage(makeStatusData({ autoRefreshSeconds: 10 }));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeStatusData({ autoRefreshSeconds: 10 })),
    } as Response);

    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    expect(fetchSpy).toHaveBeenCalledWith('/api/status');
  });

  it('uses glassmorphic card styling', async () => {
    await renderPage();
    const cards = document.querySelectorAll('.backdrop-blur-xl');
    expect(cards.length).toBeGreaterThan(0);
  });

  it('uses theme CSS variables for backgrounds', async () => {
    await renderPage();
    const root = document.querySelector('[data-reduced-motion]');
    expect(root).toBeInTheDocument();
    expect(root!.className).toContain('bg-background');
  });
});
