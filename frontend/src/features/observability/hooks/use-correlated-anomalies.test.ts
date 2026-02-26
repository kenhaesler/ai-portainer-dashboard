import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';

vi.mock('@/shared/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue([
      {
        containerId: 'abc',
        containerName: 'web',
        metrics: [{ type: 'cpu', currentValue: 95, mean: 50, zScore: 4.5 }],
        compositeScore: 3.9,
        pattern: 'CPU Spike',
        severity: 'high',
      },
    ]),
  },
}));

import { useCorrelatedAnomalies } from './use-correlated-anomalies';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

describe('useCorrelatedAnomalies', () => {
  it('fetches correlated anomaly data', async () => {
    const { result } = renderHook(() => useCorrelatedAnomalies(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0].severity).toBe('high');
  });
});
