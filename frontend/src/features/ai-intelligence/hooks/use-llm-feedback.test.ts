import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
const mockApiPut = vi.fn();

vi.mock('@/shared/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
    put: (...args: unknown[]) => mockApiPut(...args),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  useSubmitFeedback,
  useFeedbackStats,
  useRecentNegativeFeedback,
  useFeedbackList,
  useReviewFeedback,
  useBulkDeleteFeedback,
  useGenerateSuggestion,
  usePromptSuggestions,
  useUpdateSuggestionStatus,
} from './use-llm-feedback';

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

describe('use-llm-feedback hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useSubmitFeedback', () => {
    it('calls POST /api/llm/feedback', async () => {
      mockApiPost.mockResolvedValue({
        id: 'fb-1',
        feature: 'chat_assistant',
        rating: 'positive',
      });

      const { result } = renderHook(() => useSubmitFeedback(), { wrapper: createWrapper() });

      result.current.mutate({
        feature: 'chat_assistant',
        rating: 'positive',
        comment: 'Great!',
      });

      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledWith(
          '/api/llm/feedback',
          expect.objectContaining({
            feature: 'chat_assistant',
            rating: 'positive',
            comment: 'Great!',
          }),
        );
      });
    });

    it('includes responsePreview and userQuery when provided', async () => {
      mockApiPost.mockResolvedValue({
        id: 'fb-2',
        feature: 'chat_assistant',
        rating: 'negative',
      });

      const { result } = renderHook(() => useSubmitFeedback(), { wrapper: createWrapper() });

      result.current.mutate({
        feature: 'chat_assistant',
        rating: 'negative',
        comment: 'Bad answer',
        responsePreview: 'Container is healthy...',
        userQuery: 'Is my app down?',
      });

      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledWith(
          '/api/llm/feedback',
          expect.objectContaining({
            responsePreview: 'Container is healthy...',
            userQuery: 'Is my app down?',
          }),
        );
      });
    });
  });

  describe('useFeedbackStats', () => {
    it('calls GET /api/llm/feedback/stats', async () => {
      mockApiGet.mockResolvedValue([
        { feature: 'chat_assistant', total: 10, positive: 8, negative: 2, satisfactionRate: 80, pendingCount: 0 },
      ]);

      const { result } = renderHook(() => useFeedbackStats(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.data).toBeDefined();
        expect(result.current.data?.[0].feature).toBe('chat_assistant');
      });
    });
  });

  describe('useRecentNegativeFeedback', () => {
    it('calls GET /api/llm/feedback/recent-negative', async () => {
      mockApiGet.mockResolvedValue([{ id: 'fb-1', rating: 'negative' }]);

      const { result } = renderHook(() => useRecentNegativeFeedback(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.data).toBeDefined();
        expect(result.current.data).toHaveLength(1);
      });
    });
  });

  describe('useFeedbackList', () => {
    it('calls GET /api/llm/feedback with filters', async () => {
      mockApiGet.mockResolvedValue({ items: [], total: 0 });

      const { result } = renderHook(
        () => useFeedbackList({ feature: 'chat_assistant', rating: 'negative' }),
        { wrapper: createWrapper() },
      );

      await waitFor(() => {
        expect(result.current.data).toBeDefined();
        expect(mockApiGet).toHaveBeenCalledWith(
          '/api/llm/feedback',
          expect.objectContaining({
            params: expect.objectContaining({ feature: 'chat_assistant', rating: 'negative' }),
          }),
        );
      });
    });
  });

  describe('useReviewFeedback', () => {
    it('calls PUT /api/llm/feedback/:id/review', async () => {
      mockApiPut.mockResolvedValue({
        id: 'fb-1',
        admin_status: 'approved',
      });

      const { result } = renderHook(() => useReviewFeedback(), { wrapper: createWrapper() });

      result.current.mutate({ id: 'fb-1', action: 'approved' });

      await waitFor(() => {
        expect(mockApiPut).toHaveBeenCalledWith(
          '/api/llm/feedback/fb-1/review',
          expect.objectContaining({ action: 'approved' }),
        );
      });
    });
  });

  describe('useBulkDeleteFeedback', () => {
    it('calls POST /api/llm/feedback/bulk-delete', async () => {
      mockApiPost.mockResolvedValue({ deleted: 3 });

      const { result } = renderHook(() => useBulkDeleteFeedback(), { wrapper: createWrapper() });

      result.current.mutate({ ids: ['fb-1', 'fb-2', 'fb-3'] });

      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledWith(
          '/api/llm/feedback/bulk-delete',
          expect.objectContaining({ ids: ['fb-1', 'fb-2', 'fb-3'] }),
        );
      });
    });
  });

  describe('useGenerateSuggestion', () => {
    it('calls POST /api/llm/feedback/generate-suggestion', async () => {
      mockApiPost.mockResolvedValue({
        id: 'sug-1',
        feature: 'chat_assistant',
        suggested_prompt: 'New prompt',
      });

      const { result } = renderHook(() => useGenerateSuggestion(), { wrapper: createWrapper() });

      result.current.mutate({ feature: 'chat_assistant' });

      await waitFor(() => {
        expect(mockApiPost).toHaveBeenCalledWith(
          '/api/llm/feedback/generate-suggestion',
          expect.objectContaining({ feature: 'chat_assistant' }),
        );
      });
    });
  });

  describe('usePromptSuggestions', () => {
    it('calls GET /api/llm/feedback/suggestions', async () => {
      mockApiGet.mockResolvedValue([]);

      const { result } = renderHook(() => usePromptSuggestions(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.data).toBeDefined();
      });
    });
  });

  describe('useUpdateSuggestionStatus', () => {
    it('calls PUT /api/llm/feedback/suggestions/:id', async () => {
      mockApiPut.mockResolvedValue({
        id: 'sug-1',
        status: 'applied',
      });

      const { result } = renderHook(() => useUpdateSuggestionStatus(), { wrapper: createWrapper() });

      result.current.mutate({ id: 'sug-1', status: 'applied' });

      await waitFor(() => {
        expect(mockApiPut).toHaveBeenCalledWith(
          '/api/llm/feedback/suggestions/sug-1',
          expect.objectContaining({ status: 'applied' }),
        );
      });
    });
  });
});
