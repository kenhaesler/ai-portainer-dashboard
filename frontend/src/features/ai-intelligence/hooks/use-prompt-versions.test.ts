import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createElement } from 'react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock('@/shared/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

import { usePromptHistory, useRollbackPrompt } from './use-prompt-versions';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVersion(overrides: Partial<{
  id: number; feature: string; version: number; systemPrompt: string;
  model: string | null; temperature: number | null; changedBy: string;
  changedAt: string; changeNote: string | null;
}> = {}) {
  return {
    id: 1,
    feature: 'chat_assistant',
    version: 1,
    systemPrompt: 'You are a helpful assistant.',
    model: null,
    temperature: null,
    changedBy: 'admin',
    changedAt: '2026-01-01T00:00:00.000Z',
    changeNote: null,
    ...overrides,
  };
}

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePromptHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches history for a feature', async () => {
    const versions = [
      makeVersion({ id: 2, version: 2, changedBy: 'alice' }),
      makeVersion({ id: 1, version: 1, changedBy: 'admin' }),
    ];
    mockGet.mockResolvedValueOnce({ versions });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => usePromptHistory('chat_assistant'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.versions).toHaveLength(2);
    expect(result.current.data?.versions[0].version).toBe(2);
    expect(result.current.data?.versions[1].version).toBe(1);
  });

  it('calls the correct API endpoint', async () => {
    mockGet.mockResolvedValueOnce({ versions: [] });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => usePromptHistory('anomaly_explainer'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(mockGet).toHaveBeenCalled());

    expect(mockGet).toHaveBeenCalledWith('/api/settings/prompts/anomaly_explainer/history');
  });

  it('returns empty versions on empty history', async () => {
    mockGet.mockResolvedValueOnce({ versions: [] });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => usePromptHistory('chat_assistant'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.versions).toHaveLength(0);
  });

  it('does not fetch when enabled=false', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => usePromptHistory('chat_assistant', false), {
      wrapper: createWrapper(queryClient),
    });

    // Give query a chance to fire (it shouldn't)
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockGet).not.toHaveBeenCalled();
  });

  it('does not fetch when feature is empty string', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => usePromptHistory(''), {
      wrapper: createWrapper(queryClient),
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockGet).not.toHaveBeenCalled();
  });

  it('surfaces error state on API failure', async () => {
    mockGet.mockRejectedValueOnce(new Error('Network error'));

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => usePromptHistory('chat_assistant'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useRollbackPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls the correct rollback endpoint with versionId', async () => {
    const newVersion = makeVersion({ id: 10, version: 5 });
    mockPost.mockResolvedValueOnce({ success: true, newVersion });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useRollbackPrompt('chat_assistant'), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate(3);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockPost).toHaveBeenCalledWith(
      '/api/settings/prompts/chat_assistant/rollback',
      { versionId: 3 },
    );
  });

  it('shows success toast with version number on rollback', async () => {
    const newVersion = makeVersion({ version: 7 });
    mockPost.mockResolvedValueOnce({ success: true, newVersion });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useRollbackPrompt('chat_assistant'), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate(2);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockToastSuccess).toHaveBeenCalledWith('Rolled back to v7');
  });

  it('shows error toast on rollback failure', async () => {
    mockPost.mockRejectedValueOnce(new Error('Version not found'));

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useRollbackPrompt('chat_assistant'), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate(999);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(mockToastError).toHaveBeenCalledWith('Rollback failed: Version not found');
  });

  it('invalidates prompt-history query on success', async () => {
    const newVersion = makeVersion({ version: 3 });
    mockPost.mockResolvedValueOnce({ success: true, newVersion });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useRollbackPrompt('chat_assistant'), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      result.current.mutate(1);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['prompt-history', 'chat_assistant'] }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['settings'] }),
    );
  });
});
