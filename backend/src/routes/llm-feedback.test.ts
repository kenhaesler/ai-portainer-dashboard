import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { llmFeedbackRoutes } from './llm-feedback.js';

// ── Mocks ──────────────────────────────────────────────────────────

const mockInsertFeedback = vi.fn();
const mockListFeedback = vi.fn();
const mockGetFeedbackStats = vi.fn();
const mockGetRecentNegativeFeedback = vi.fn();
const mockAdminReviewFeedback = vi.fn();
const mockBulkDeleteFeedback = vi.fn();
const mockCheckFeedbackRateLimit = vi.fn();
const mockIsValidFeature = vi.fn();
const mockGetNegativeFeedbackCount = vi.fn();
const mockGetNegativeFeedbackForFeature = vi.fn();
const mockInsertPromptSuggestion = vi.fn();
const mockListPromptSuggestions = vi.fn();
const mockUpdatePromptSuggestionStatus = vi.fn();

vi.mock('../services/feedback-store.js', () => ({
  insertFeedback: (...args: unknown[]) => mockInsertFeedback(...args),
  listFeedback: (...args: unknown[]) => mockListFeedback(...args),
  getFeedbackStats: (...args: unknown[]) => mockGetFeedbackStats(...args),
  getRecentNegativeFeedback: (...args: unknown[]) => mockGetRecentNegativeFeedback(...args),
  adminReviewFeedback: (...args: unknown[]) => mockAdminReviewFeedback(...args),
  bulkDeleteFeedback: (...args: unknown[]) => mockBulkDeleteFeedback(...args),
  checkFeedbackRateLimit: (...args: unknown[]) => mockCheckFeedbackRateLimit(...args),
  isValidFeature: (...args: unknown[]) => mockIsValidFeature(...args),
  getNegativeFeedbackCount: (...args: unknown[]) => mockGetNegativeFeedbackCount(...args),
  getNegativeFeedbackForFeature: (...args: unknown[]) => mockGetNegativeFeedbackForFeature(...args),
  insertPromptSuggestion: (...args: unknown[]) => mockInsertPromptSuggestion(...args),
  listPromptSuggestions: (...args: unknown[]) => mockListPromptSuggestions(...args),
  updatePromptSuggestionStatus: (...args: unknown[]) => mockUpdatePromptSuggestionStatus(...args),
}));

vi.mock('../services/prompt-store.js', () => ({
  getEffectivePrompt: () => 'You are a helpful assistant.',
  PROMPT_FEATURES: [
    { key: 'chat_assistant', label: 'Chat Assistant', description: 'Main chat' },
  ],
}));

vi.mock('../services/audit-logger.js', () => ({
  writeAuditLog: vi.fn(),
}));

// ── Test Setup ─────────────────────────────────────────────────────

function buildApp() {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.decorate('authenticate', async () => undefined);
  app.decorate('requireRole', () => async () => undefined);
  // Simulate user on every request
  app.addHook('onRequest', async (request) => {
    request.user = { sub: 'user-1', username: 'admin', role: 'admin', sessionId: 'sess-1' };
  });
  return app;
}

describe('LLM Feedback Routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockCheckFeedbackRateLimit.mockReturnValue(true);
    mockIsValidFeature.mockReturnValue(true);

    app = buildApp();
    await app.register(llmFeedbackRoutes);
    await app.ready();
  });

  // ── Submit Feedback ────────────────────────────────────────────

  describe('POST /api/llm/feedback', () => {
    it('creates feedback successfully', async () => {
      const mockFeedback = {
        id: 'fb-1',
        feature: 'chat_assistant',
        rating: 'positive',
        comment: 'Great response!',
        user_id: 'user-1',
        admin_status: 'pending',
        created_at: '2025-01-01T00:00:00Z',
      };
      mockInsertFeedback.mockReturnValue(mockFeedback);

      const res = await app.inject({
        method: 'POST',
        url: '/api/llm/feedback',
        payload: {
          feature: 'chat_assistant',
          rating: 'positive',
          comment: 'Great response!',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBe('fb-1');
      expect(body.rating).toBe('positive');
      expect(mockInsertFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          feature: 'chat_assistant',
          rating: 'positive',
          comment: 'Great response!',
          user_id: 'user-1',
        }),
      );
    });

    it('submits negative feedback with comment', async () => {
      const mockFeedback = {
        id: 'fb-2',
        feature: 'anomaly_explainer',
        rating: 'negative',
        comment: 'Explanation was too vague',
        user_id: 'user-1',
        admin_status: 'pending',
      };
      mockInsertFeedback.mockReturnValue(mockFeedback);

      const res = await app.inject({
        method: 'POST',
        url: '/api/llm/feedback',
        payload: {
          feature: 'anomaly_explainer',
          rating: 'negative',
          comment: 'Explanation was too vague',
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().rating).toBe('negative');
    });

    it('submits feedback with responsePreview and userQuery', async () => {
      const mockFeedback = {
        id: 'fb-3',
        feature: 'chat_assistant',
        rating: 'negative',
        comment: 'Wrong answer',
        user_id: 'user-1',
        admin_status: 'pending',
        response_preview: 'The container is healthy...',
        user_query: 'Is my container down?',
      };
      mockInsertFeedback.mockReturnValue(mockFeedback);

      const res = await app.inject({
        method: 'POST',
        url: '/api/llm/feedback',
        payload: {
          feature: 'chat_assistant',
          rating: 'negative',
          comment: 'Wrong answer',
          responsePreview: 'The container is healthy...',
          userQuery: 'Is my container down?',
        },
      });

      expect(res.statusCode).toBe(201);
      expect(mockInsertFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          response_preview: 'The container is healthy...',
          user_query: 'Is my container down?',
        }),
      );
    });

    it('rejects invalid feature', async () => {
      mockIsValidFeature.mockReturnValue(false);

      const res = await app.inject({
        method: 'POST',
        url: '/api/llm/feedback',
        payload: {
          feature: 'invalid_feature',
          rating: 'positive',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('Invalid feature');
    });

    it('enforces rate limiting', async () => {
      mockCheckFeedbackRateLimit.mockReturnValue(false);

      const res = await app.inject({
        method: 'POST',
        url: '/api/llm/feedback',
        payload: {
          feature: 'chat_assistant',
          rating: 'positive',
        },
      });

      expect(res.statusCode).toBe(429);
      expect(res.json().error).toContain('Too many');
    });

    it('rejects invalid rating value', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/llm/feedback',
        payload: {
          feature: 'chat_assistant',
          rating: 'neutral',
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── List Feedback ──────────────────────────────────────────────

  describe('GET /api/llm/feedback', () => {
    it('returns paginated feedback list', async () => {
      mockListFeedback.mockReturnValue({
        items: [{ id: 'fb-1', feature: 'chat_assistant', rating: 'positive' }],
        total: 1,
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/llm/feedback',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.items).toHaveLength(1);
      expect(body.total).toBe(1);
    });

    it('filters by feature', async () => {
      mockListFeedback.mockReturnValue({ items: [], total: 0 });

      const res = await app.inject({
        method: 'GET',
        url: '/api/llm/feedback?feature=chat_assistant',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().items).toEqual([]);
      expect(mockListFeedback).toHaveBeenCalledWith(
        expect.objectContaining({ feature: 'chat_assistant' }),
      );
    });

    it('filters by rating', async () => {
      mockListFeedback.mockReturnValue({ items: [], total: 0 });

      const res = await app.inject({
        method: 'GET',
        url: '/api/llm/feedback?rating=negative',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().items).toEqual([]);
      expect(mockListFeedback).toHaveBeenCalledWith(
        expect.objectContaining({ rating: 'negative' }),
      );
    });
  });

  // ── Feedback Statistics ────────────────────────────────────────

  describe('GET /api/llm/feedback/stats', () => {
    it('returns per-feature statistics', async () => {
      mockGetFeedbackStats.mockReturnValue([
        { feature: 'chat_assistant', total: 50, positive: 40, negative: 10, satisfactionRate: 80, pendingCount: 5 },
        { feature: 'anomaly_explainer', total: 20, positive: 12, negative: 8, satisfactionRate: 60, pendingCount: 3 },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/llm/feedback/stats',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(2);
      expect(body[0].satisfactionRate).toBe(80);
    });
  });

  // ── Recent Negative Feedback ───────────────────────────────────

  describe('GET /api/llm/feedback/recent-negative', () => {
    it('returns recent negative entries', async () => {
      mockGetRecentNegativeFeedback.mockReturnValue([
        { id: 'fb-1', feature: 'chat_assistant', rating: 'negative', comment: 'Not helpful' },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/llm/feedback/recent-negative',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(1);
    });
  });

  // ── Admin Review ───────────────────────────────────────────────

  describe('PUT /api/llm/feedback/:id/review', () => {
    it('approves feedback', async () => {
      mockAdminReviewFeedback.mockReturnValue({
        id: 'fb-1',
        admin_status: 'approved',
        effective_rating: 'negative',
      });

      const res = await app.inject({
        method: 'PUT',
        url: '/api/llm/feedback/fb-1/review',
        payload: { action: 'approved' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().admin_status).toBe('approved');
    });

    it('overrules feedback with note', async () => {
      mockAdminReviewFeedback.mockReturnValue({
        id: 'fb-1',
        admin_status: 'overruled',
        effective_rating: 'positive',
        admin_note: 'Response was actually correct',
      });

      const res = await app.inject({
        method: 'PUT',
        url: '/api/llm/feedback/fb-1/review',
        payload: { action: 'overruled', note: 'Response was actually correct' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().admin_status).toBe('overruled');
      expect(res.json().admin_note).toBe('Response was actually correct');
    });

    it('returns 404 for missing feedback', async () => {
      mockAdminReviewFeedback.mockReturnValue(null);

      const res = await app.inject({
        method: 'PUT',
        url: '/api/llm/feedback/nonexistent/review',
        payload: { action: 'approved' },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── Bulk Delete ────────────────────────────────────────────────

  describe('POST /api/llm/feedback/bulk-delete', () => {
    it('deletes multiple entries', async () => {
      mockBulkDeleteFeedback.mockReturnValue(3);

      const res = await app.inject({
        method: 'POST',
        url: '/api/llm/feedback/bulk-delete',
        payload: {
          ids: [
            'a0a0a0a0-b1b1-c2c2-d3d3-e4e4e4e4e4e4',
            'f5f5f5f5-a6a6-b7b7-c8c8-d9d9d9d9d9d9',
            '10101010-2020-3030-4040-505050505050',
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().deleted).toBe(3);
    });
  });

  // ── Suggestion Generation ──────────────────────────────────────

  describe('POST /api/llm/feedback/generate-suggestion', () => {
    it('rejects when insufficient negative feedback', async () => {
      mockGetNegativeFeedbackCount.mockReturnValue(5);

      const res = await app.inject({
        method: 'POST',
        url: '/api/llm/feedback/generate-suggestion',
        payload: { feature: 'chat_assistant' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('Need at least');
    });

    it('rejects invalid feature', async () => {
      mockIsValidFeature.mockReturnValue(false);

      const res = await app.inject({
        method: 'POST',
        url: '/api/llm/feedback/generate-suggestion',
        payload: { feature: 'invalid' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── Suggestion List & Update ───────────────────────────────────

  describe('GET /api/llm/feedback/suggestions', () => {
    it('returns suggestion list', async () => {
      mockListPromptSuggestions.mockReturnValue([
        { id: 'sug-1', feature: 'chat_assistant', status: 'pending', reasoning: 'Test' },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/llm/feedback/suggestions',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(1);
    });
  });

  describe('PUT /api/llm/feedback/suggestions/:id', () => {
    it('updates suggestion status', async () => {
      mockUpdatePromptSuggestionStatus.mockReturnValue({
        id: 'sug-1',
        status: 'applied',
        feature: 'chat_assistant',
      });

      const res = await app.inject({
        method: 'PUT',
        url: '/api/llm/feedback/suggestions/sug-1',
        payload: { status: 'applied' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('applied');
    });

    it('returns 404 for missing suggestion', async () => {
      mockUpdatePromptSuggestionStatus.mockReturnValue(null);

      const res = await app.inject({
        method: 'PUT',
        url: '/api/llm/feedback/suggestions/nonexistent',
        payload: { status: 'dismissed' },
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
