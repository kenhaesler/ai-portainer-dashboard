import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';

vi.mock('@/shared/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({
      records: [
        { id: 1, image_name: 'library/nginx', image_tag: 'latest', registry: 'docker.io', is_stale: 1, last_checked_at: '2024-01-01' },
        { id: 2, image_name: 'library/redis', image_tag: 'latest', registry: 'docker.io', is_stale: 0, last_checked_at: '2024-01-01' },
      ],
      summary: { total: 2, stale: 1, upToDate: 1, unchecked: 0 },
    }),
    post: vi.fn().mockResolvedValue({ success: true, checked: 2, stale: 1 }),
  },
}));

import { useImageStaleness } from './use-image-staleness';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

describe('useImageStaleness', () => {
  it('fetches staleness data', async () => {
    const { result } = renderHook(() => useImageStaleness(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.summary.stale).toBe(1);
    expect(result.current.data?.records).toHaveLength(2);
  });
});
