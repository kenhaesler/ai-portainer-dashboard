import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GeneralTab } from './tab-general';

const cacheStatsRef: { data: unknown } = { data: undefined };

vi.mock('@/features/core/hooks/use-cache-admin', () => ({
  useCacheStats: () => cacheStatsRef,
  useCacheClear: () => ({ mutate: vi.fn(), isPending: false }),
}));

beforeEach(() => {
  cacheStatsRef.data = undefined;
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

describe('GeneralTab — cached entry keys table (DataTable migration)', () => {
  it('renders the cache entries inside a DataTable', () => {
    cacheStatsRef.data = {
      size: 2,
      l1Size: 1,
      l2Size: 1,
      hits: 10,
      misses: 2,
      hitRate: '83%',
      backend: 'multi-layer',
      entries: [
        { key: 'portainer:containers', expiresIn: 30 },
        { key: 'portainer:images', expiresIn: 60 },
      ],
    };

    renderTab();

    const table = screen.getByTestId('data-table');
    expect(table).toBeInTheDocument();

    // Headers preserved from the original hand-rolled table
    expect(within(table).getByText('Key')).toBeInTheDocument();
    expect(within(table).getByText('Expires In (TTL)')).toBeInTheDocument();

    // Cell rendering preserved (key + TTL with the "s" suffix)
    expect(within(table).getByText('portainer:containers')).toBeInTheDocument();
    expect(within(table).getByText('portainer:images')).toBeInTheDocument();
    expect(within(table).getByText('30s')).toBeInTheDocument();
    expect(within(table).getByText('60s')).toBeInTheDocument();
  });

  it('does not render the cache entries table when there are no entries', () => {
    cacheStatsRef.data = {
      size: 0,
      l1Size: 0,
      l2Size: 0,
      hits: 0,
      misses: 0,
      hitRate: 'N/A',
      backend: 'memory-only',
      entries: [],
    };

    renderTab();

    expect(screen.queryByTestId('data-table')).not.toBeInTheDocument();
  });
});
