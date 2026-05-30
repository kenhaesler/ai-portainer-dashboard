import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';

vi.mock('@/shared/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ groups: [], endpoint_facets: [], total_active: 0 }),
  },
}));

let mockIsVisible = true;
vi.mock('@/shared/hooks/use-page-visibility', () => ({
  usePageVisibility: () => mockIsVisible,
}));

import { useIncidentGroups } from './use-incident-groups';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useIncidentGroups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsVisible = true;
  });

  it('serializes camelCase params to snake_case query string', async () => {
    const { api } = await import('@/shared/lib/api');
    renderHook(
      () => useIncidentGroups({ status: 'active', endpointId: 42, since: '24h', severity: 'critical' }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/api/incidents/groups', {
        params: { status: 'active', endpoint_id: '42', since: '24h', severity: 'critical' },
      });
    });
  });

  it('omits undefined params', async () => {
    const { api } = await import('@/shared/lib/api');
    renderHook(() => useIncidentGroups({}), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/api/incidents/groups', { params: {} });
    });
  });

  it('polls every 30s when page is visible', () => {
    const { result } = renderHook(() => useIncidentGroups(), { wrapper: createWrapper() });
    expect(result.current.status).toBe('pending');
  });

  it('disables polling when page is hidden', () => {
    mockIsVisible = false;
    const { result } = renderHook(() => useIncidentGroups(), { wrapper: createWrapper() });
    expect(result.current.status).toBe('pending');
  });
});
