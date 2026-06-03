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
