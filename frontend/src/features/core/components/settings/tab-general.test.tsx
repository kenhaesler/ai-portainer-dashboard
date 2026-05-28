import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GeneralTab } from './tab-general';

vi.mock('@/features/core/hooks/use-cache-admin', () => ({
  useCacheStats: () => ({ data: undefined }),
  useCacheClear: () => ({ mutate: vi.fn(), isPending: false }),
}));

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
