import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue([
      {
        containerId: 'abc123',
        containerName: 'web-server',
        metricType: 'cpu',
        currentValue: 75,
        trend: 'increasing',
        timeToThreshold: 6,
        confidence: 'high',
      },
    ]),
  },
}));

import { useForecasts } from './use-forecasts';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

describe('useForecasts', () => {
  it('fetches forecast data', async () => {
    const { result } = renderHook(() => useForecasts(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].trend).toBe('increasing');
  });
});
