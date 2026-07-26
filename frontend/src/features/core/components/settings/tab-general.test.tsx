import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GeneralTab } from './tab-general';

const cacheStatsRef: { data: unknown } = { data: undefined };
const systemInfoRef: { data: unknown } = { data: undefined };

vi.mock('@/features/core/hooks/use-cache-admin', () => ({
  useCacheStats: () => cacheStatsRef,
  useCacheClear: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/features/core/hooks/use-system-info', () => ({
  useSystemInfo: () => systemInfoRef,
}));

beforeEach(() => {
  cacheStatsRef.data = undefined;
  systemInfoRef.data = undefined;
});

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <GeneralTab theme="glass-light" />
    </QueryClientProvider>,
  );
}

describe('GeneralTab — caching model note (#1312)', () => {
  it('renders the informational caching note below the cache stats', () => {
    renderTab();
    const note = screen.getByTestId('caching-model-note');
    expect(note).toBeInTheDocument();
    expect(note).toHaveTextContent(/auto-refresh and background polls read from the server cache/i);
    expect(note).toHaveTextContent(/clicking/i);
    expect(note).toHaveTextContent(/refresh/i);
    expect(note).toHaveTextContent(/non-admin clicks fall back to a plain refresh/i);
  });
});

describe('GeneralTab — system component versions', () => {
  it('shows Node.js, Fastify, React and the real app version', () => {
    systemInfoRef.data = { app: '2.0.0', node: '22.11.0', fastify: '5.8.5' };

    renderTab();

    // App version comes from the backend (replaces the old hardcoded 1.0.0).
    expect(screen.getByText('2.0.0')).toBeInTheDocument();
    expect(screen.queryByText('1.0.0')).not.toBeInTheDocument();

    // Node.js + Fastify cards (label + value).
    expect(screen.getByText('Node.js')).toBeInTheDocument();
    expect(screen.getByText('22.11.0')).toBeInTheDocument();
    expect(screen.getByText('Fastify')).toBeInTheDocument();
    expect(screen.getByText('5.8.5')).toBeInTheDocument();

    // React version is reported client-side.
    expect(screen.getByText('React')).toBeInTheDocument();
    expect(screen.getByText(React.version)).toBeInTheDocument();
  });

  it('renders a placeholder while versions are loading', () => {
    systemInfoRef.data = undefined;

    renderTab();

    // Node.js / Fastify / app version fall back to an em dash until loaded.
    expect(screen.getByText('Node.js')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });
});

describe('GeneralTab — raw cache keys are not product surface', () => {
  const populatedStats = {
    size: 2,
    l1Size: 1,
    l2Size: 1,
    hits: 10,
    misses: 2,
    hitRate: '83%',
    backend: 'multi-layer',
    entries: [
      { key: 'stats:3:eff28011ff7bd189089e1d192b14b09c95b42aed', expiresIn: 30 },
      { key: 'portainer:images', expiresIn: 60 },
    ],
  };

  it('does not dump individual cache keys into the page', () => {
    cacheStatsRef.data = populatedStats;

    renderTab();

    expect(screen.queryByTestId('data-table')).not.toBeInTheDocument();
    expect(screen.queryByText('stats:3:eff28011ff7bd189089e1d192b14b09c95b42aed')).not.toBeInTheDocument();
    expect(screen.queryByText('portainer:images')).not.toBeInTheDocument();
    expect(screen.queryByText(/Cached Entry Keys/i)).not.toBeInTheDocument();
  });

  it('keeps the aggregate counters, which do read', () => {
    cacheStatsRef.data = populatedStats;

    renderTab();

    expect(screen.getByText('Hit Rate')).toBeInTheDocument();
    expect(screen.getByText('83%')).toBeInTheDocument();
    expect(screen.getByText('Redis Keys')).toBeInTheDocument();
  });
});

describe('GeneralTab — placement', () => {
  it('renders system information as a disclosure', () => {
    renderTab();

    const disclosure = screen.getByTestId('system-information');
    expect(disclosure.tagName).toBe('DETAILS');
    expect(within(disclosure).getByText('System Information')).toBeInTheDocument();
  });

  it('does not host cache administration — that belongs with the cache settings', () => {
    renderTab();

    expect(screen.queryByRole('button', { name: /clear all cache/i })).not.toBeInTheDocument();
  });
});
