import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';

// ── Types ────────────────────────────────────────────────────────────

export interface LlmFeedback {
  id: string;
  trace_id: string | null;
  message_id: string | null;
  feature: string;
  rating: 'positive' | 'negative';
  comment: string | null;
  user_id: string;
  admin_status: 'pending' | 'approved' | 'rejected' | 'overruled';
  admin_note: string | null;
  effective_rating: 'positive' | 'negative' | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
}

export interface FeedbackStats {
  feature: string;
  total: number;
  positive: number;
  negative: number;
  satisfactionRate: number;
  pendingCount: number;
}

export interface PromptSuggestion {
  id: string;
  feature: string;
  current_prompt: string;
  suggested_prompt: string;
  reasoning: string;
  evidence_feedback_ids: string[];
  negative_count: number;
  status: 'pending' | 'applied' | 'dismissed' | 'edited';
  applied_at: string | null;
  applied_by: string | null;
  created_at: string;
}

interface FeedbackListResponse {
  items: LlmFeedback[];
  total: number;
}

// ── Query Keys ───────────────────────────────────────────────────────

const FEEDBACK_KEYS = {
  all: ['llm-feedback'] as const,
  list: (filters?: Record<string, unknown>) => ['llm-feedback', 'list', filters] as const,
  stats: ['llm-feedback', 'stats'] as const,
  recentNegative: ['llm-feedback', 'recent-negative'] as const,
  suggestions: (filters?: Record<string, unknown>) => ['llm-feedback', 'suggestions', filters] as const,
};

// ── Submit Feedback (any user) ──────────────────────────────────────

export function useSubmitFeedback() {
  const queryClient = useQueryClient();

  return useMutation<LlmFeedback, Error, {
    traceId?: string;
    messageId?: string;
    feature: string;
    rating: 'positive' | 'negative';
    comment?: string;
  }>({
    mutationFn: async (params) => {
      return api.post<LlmFeedback>('/api/llm/feedback', params);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: FEEDBACK_KEYS.all });
      if (variables.rating === 'positive') {
        toast.success('Thanks for your feedback!');
      } else {
        toast.success('Feedback submitted', { description: 'Your input helps improve AI quality.' });
      }
    },
    onError: (error) => {
      if (error.message.includes('Too many')) {
        toast.error('Slow down', { description: 'Please wait before submitting more feedback.' });
      } else {
        toast.error('Failed to submit feedback', { description: error.message });
      }
    },
  });
}

// ── Admin: List Feedback ────────────────────────────────────────────

export function useFeedbackList(filters?: {
  feature?: string;
  rating?: 'positive' | 'negative';
  adminStatus?: string;
  limit?: number;
  offset?: number;
}) {
  return useQuery<FeedbackListResponse>({
    queryKey: FEEDBACK_KEYS.list(filters),
    queryFn: () => api.get<FeedbackListResponse>('/api/llm/feedback', { params: filters as Record<string, string | number> }),
    staleTime: 30 * 1000,
  });
}

// ── Admin: Feedback Statistics ──────────────────────────────────────

export function useFeedbackStats() {
  return useQuery<FeedbackStats[]>({
    queryKey: FEEDBACK_KEYS.stats,
    queryFn: () => api.get<FeedbackStats[]>('/api/llm/feedback/stats'),
    staleTime: 30 * 1000,
  });
}

// ── Admin: Recent Negative ──────────────────────────────────────────

export function useRecentNegativeFeedback() {
  return useQuery<LlmFeedback[]>({
    queryKey: FEEDBACK_KEYS.recentNegative,
    queryFn: () => api.get<LlmFeedback[]>('/api/llm/feedback/recent-negative'),
    staleTime: 30 * 1000,
  });
}

// ── Admin: Review Feedback ──────────────────────────────────────────

export function useReviewFeedback() {
  const queryClient = useQueryClient();

  return useMutation<LlmFeedback, Error, {
    id: string;
    action: 'approved' | 'rejected' | 'overruled';
    note?: string;
  }>({
    mutationFn: async ({ id, ...body }) => {
      return api.put<LlmFeedback>(`/api/llm/feedback/${id}/review`, body);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: FEEDBACK_KEYS.all });
      toast.success(`Feedback ${variables.action}`);
    },
    onError: (error) => {
      toast.error('Failed to review feedback', { description: error.message });
    },
  });
}

// ── Admin: Bulk Delete ──────────────────────────────────────────────

export function useBulkDeleteFeedback() {
  const queryClient = useQueryClient();

  return useMutation<{ deleted: number }, Error, { ids: string[] }>({
    mutationFn: async (params) => {
      return api.post<{ deleted: number }>('/api/llm/feedback/bulk-delete', params);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: FEEDBACK_KEYS.all });
      toast.success(`Deleted ${data.deleted} feedback entries`);
    },
    onError: (error) => {
      toast.error('Failed to delete feedback', { description: error.message });
    },
  });
}

// ── Admin: Generate Suggestion ──────────────────────────────────────

export function useGenerateSuggestion() {
  const queryClient = useQueryClient();

  return useMutation<PromptSuggestion, Error, { feature: string }>({
    mutationFn: async (params) => {
      return api.post<PromptSuggestion>('/api/llm/feedback/generate-suggestion', params);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: FEEDBACK_KEYS.suggestions() });
      toast.success('Prompt suggestion generated', { description: 'Review the AI-generated improvement below.' });
    },
    onError: (error) => {
      toast.error('Failed to generate suggestion', { description: error.message });
    },
  });
}

// ── Admin: List Suggestions ─────────────────────────────────────────

export function usePromptSuggestions(filters?: { feature?: string; status?: string }) {
  return useQuery<PromptSuggestion[]>({
    queryKey: FEEDBACK_KEYS.suggestions(filters),
    queryFn: () => api.get<PromptSuggestion[]>('/api/llm/feedback/suggestions', { params: filters as Record<string, string> }),
    staleTime: 30 * 1000,
  });
}

// ── Admin: Update Suggestion Status ─────────────────────────────────

export function useUpdateSuggestionStatus() {
  const queryClient = useQueryClient();

  return useMutation<PromptSuggestion, Error, { id: string; status: 'applied' | 'dismissed' | 'edited' }>({
    mutationFn: async ({ id, ...body }) => {
      return api.put<PromptSuggestion>(`/api/llm/feedback/suggestions/${id}`, body);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: FEEDBACK_KEYS.all });
      toast.success(`Suggestion ${variables.status}`);
    },
    onError: (error) => {
      toast.error('Failed to update suggestion', { description: error.message });
    },
  });
}
