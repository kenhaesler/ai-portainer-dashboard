import { FastifyInstance } from 'fastify';
import { z } from 'zod/v4';
import {
  insertFeedback,
  listFeedback,
  getFeedbackStats,
  getRecentNegativeFeedback,
  adminReviewFeedback,
  bulkDeleteFeedback,
  checkFeedbackRateLimit,
  isValidFeature,
  getNegativeFeedbackCount,
  getNegativeFeedbackForFeature,
  insertPromptSuggestion,
  listPromptSuggestions,
  updatePromptSuggestionStatus,
} from '../services/feedback-store.js';
import { getEffectivePrompt, PROMPT_FEATURES, type PromptFeature } from '../services/prompt-store.js';
import { writeAuditLog } from '../../../core/services/audit-logger.js';
import { getAuthHeaders, llmFetch, createConfiguredOllamaClient } from '../services/llm-client.js';
import { createChildLogger } from '../../../core/utils/logger.js';

const log = createChildLogger('llm-feedback-routes');

// Minimum negative feedback count before AI can generate suggestions
const MIN_NEGATIVE_FOR_SUGGESTION = 10;

// ── Zod Schemas ────────────────────────────────────────────────────

const SubmitFeedbackSchema = z.object({
  traceId: z.string().optional(),
  messageId: z.string().optional(),
  feature: z.string().min(1).max(100),
  rating: z.enum(['positive', 'negative']),
  comment: z.string().max(2000).optional(),
  responsePreview: z.string().max(2000).optional(),
  userQuery: z.string().max(1000).optional(),
});

const ListFeedbackQuerySchema = z.object({
  feature: z.string().optional(),
  rating: z.enum(['positive', 'negative']).optional(),
  adminStatus: z.string().optional(),
  limit: z.coerce.number().min(1).max(200).optional().default(50),
  offset: z.coerce.number().min(0).optional().default(0),
});

const ReviewFeedbackSchema = z.object({
  action: z.enum(['approved', 'rejected', 'overruled']),
  note: z.string().max(1000).optional(),
});

const BulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
});

const GenerateSuggestionSchema = z.object({
  feature: z.string().min(1).max(100),
});

const UpdateSuggestionStatusSchema = z.object({
  status: z.enum(['applied', 'dismissed', 'edited']),
});

const SuggestionListQuerySchema = z.object({
  feature: z.string().optional(),
  status: z.string().optional(),
});

const FeedbackIdParamsSchema = z.object({
  id: z.string(),
});

const SuggestionIdParamsSchema = z.object({
  id: z.string(),
});

// ── Routes ─────────────────────────────────────────────────────────

export async function llmFeedbackRoutes(fastify: FastifyInstance) {

  // ── Submit feedback (any authenticated user) ─────────────────────

  fastify.post('/api/llm/feedback', {
    schema: {
      tags: ['LLM Feedback'],
      summary: 'Submit feedback on an LLM-generated output',
      security: [{ bearerAuth: [] }],
      body: SubmitFeedbackSchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const body = request.body as z.infer<typeof SubmitFeedbackSchema>;
    const userId = request.user?.sub ?? 'unknown';

    // Validate feature
    if (!isValidFeature(body.feature)) {
      return reply.code(400).send({ error: `Invalid feature: ${body.feature}` });
    }

    // Rate limit check
    if (!checkFeedbackRateLimit(userId)) {
      return reply.code(429).send({ error: 'Too many feedback submissions. Please wait a moment.' });
    }

    const feedback = await insertFeedback({
      trace_id: body.traceId,
      message_id: body.messageId,
      feature: body.feature,
      rating: body.rating,
      comment: body.comment,
      user_id: userId,
      response_preview: body.responsePreview,
      user_query: body.userQuery,
    });

    return reply.code(201).send(feedback);
  });

  // ── List feedback (admin only) ──────────────────────────────────

  fastify.get('/api/llm/feedback', {
    schema: {
      tags: ['LLM Feedback'],
      summary: 'List all feedback entries (admin)',
      security: [{ bearerAuth: [] }],
      querystring: ListFeedbackQuerySchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request) => {
    const query = request.query as z.infer<typeof ListFeedbackQuerySchema>;
    return await listFeedback(query);
  });

  // ── Get feedback statistics (admin only) ────────────────────────

  fastify.get('/api/llm/feedback/stats', {
    schema: {
      tags: ['LLM Feedback'],
      summary: 'Get per-feature feedback statistics',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async () => {
    return await getFeedbackStats();
  });

  // ── Get recent negative feedback (admin only) ───────────────────

  fastify.get('/api/llm/feedback/recent-negative', {
    schema: {
      tags: ['LLM Feedback'],
      summary: 'Get recent negative feedback entries',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async () => {
    return await getRecentNegativeFeedback(20);
  });

  // ── Review a feedback entry (admin only) ────────────────────────

  fastify.put('/api/llm/feedback/:id/review', {
    schema: {
      tags: ['LLM Feedback'],
      summary: 'Admin review (approve, reject, or overrule) a feedback entry',
      security: [{ bearerAuth: [] }],
      params: FeedbackIdParamsSchema,
      body: ReviewFeedbackSchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { action, note } = request.body as z.infer<typeof ReviewFeedbackSchema>;
    const reviewerId = request.user?.sub ?? 'unknown';

    const result = await adminReviewFeedback(id, action, reviewerId, note);
    if (!result) {
      return reply.code(404).send({ error: 'Feedback entry not found' });
    }

    writeAuditLog({
      user_id: reviewerId,
      username: request.user?.username,
      action: `feedback.${action}`,
      target_type: 'llm_feedback',
      target_id: id,
      details: { action, note },
      request_id: request.requestId,
      ip_address: request.ip,
    });

    return result;
  });

  // ── Bulk delete feedback (admin only) ──────────────────────────

  fastify.post('/api/llm/feedback/bulk-delete', {
    schema: {
      tags: ['LLM Feedback'],
      summary: 'Bulk delete feedback entries (spam cleanup)',
      security: [{ bearerAuth: [] }],
      body: BulkDeleteSchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request) => {
    const { ids } = request.body as z.infer<typeof BulkDeleteSchema>;
    const deleted = await bulkDeleteFeedback(ids);

    writeAuditLog({
      user_id: request.user?.sub,
      username: request.user?.username,
      action: 'feedback.bulk_delete',
      target_type: 'llm_feedback',
      details: { count: deleted, ids },
      request_id: request.requestId,
      ip_address: request.ip,
    });

    return { deleted };
  });

  // ── Generate prompt improvement suggestion (admin only) ────────

  fastify.post('/api/llm/feedback/generate-suggestion', {
    schema: {
      tags: ['LLM Feedback'],
      summary: 'Use AI to analyze negative feedback and generate a prompt improvement suggestion',
      security: [{ bearerAuth: [] }],
      body: GenerateSuggestionSchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { feature } = request.body as z.infer<typeof GenerateSuggestionSchema>;

    if (!isValidFeature(feature)) {
      return reply.code(400).send({ error: `Invalid feature: ${feature}` });
    }

    const negativeCount = await getNegativeFeedbackCount(feature);
    if (negativeCount < MIN_NEGATIVE_FOR_SUGGESTION) {
      return reply.code(400).send({
        error: `Need at least ${MIN_NEGATIVE_FOR_SUGGESTION} negative feedback entries before generating suggestions. Currently have ${negativeCount}.`,
        currentCount: negativeCount,
        requiredCount: MIN_NEGATIVE_FOR_SUGGESTION,
      });
    }

    // Get negative feedback for analysis
    const negativeFeedback = await getNegativeFeedbackForFeature(feature, 30);
    const currentPrompt = await getEffectivePrompt(feature as PromptFeature);
    const featureInfo = PROMPT_FEATURES.find(f => f.key === feature);

    // Build the analysis prompt for the LLM
    const feedbackSummary = negativeFeedback
      .filter(f => f.comment)
      .map((f, i) => `${i + 1}. [${f.rating}] ${f.comment}`)
      .join('\n');

    const feedbackWithoutComments = negativeFeedback.filter(f => !f.comment).length;

    // Use a structured analysis approach
    const analysisPrompt = buildAnalysisPrompt(
      feature,
      featureInfo?.label ?? feature,
      currentPrompt,
      feedbackSummary,
      feedbackWithoutComments,
      negativeCount,
    );

    try {
      // Dynamically import to avoid circular dependencies
      const { getEffectiveLlmConfig } = await import('../../../core/services/settings-store.js');

      const llmConfig = await getEffectiveLlmConfig();

      let responseText = '';

      if (llmConfig.customEnabled && llmConfig.customEndpointUrl) {
        // Custom endpoint (token is optional — some endpoints don't require auth)
        const response = await llmFetch(llmConfig.customEndpointUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(llmConfig.customEndpointToken, llmConfig.authType),
          },
          body: JSON.stringify({
            model: llmConfig.model,
            messages: [
              { role: 'system', content: 'You are a prompt engineering expert. Analyze feedback and suggest prompt improvements. Always respond in the exact JSON format requested.' },
              { role: 'user', content: analysisPrompt },
            ],
            stream: false,
            temperature: 0.3,
          }),
        });

        if (!response.ok) {
          throw new Error(`LLM HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
        responseText = data.choices?.[0]?.message?.content ?? '';
      } else {
        // Ollama
        const ollama = await createConfiguredOllamaClient(llmConfig);
        const response = await ollama.chat({
          model: llmConfig.model,
          messages: [
            { role: 'system', content: 'You are a prompt engineering expert. Analyze feedback and suggest prompt improvements. Always respond in the exact JSON format requested.' },
            { role: 'user', content: analysisPrompt },
          ],
          stream: false,
          options: { temperature: 0.3 },
        });
        responseText = response.message?.content ?? '';
      }

      // Parse the LLM response
      const parsed = parseSuggestionResponse(responseText);

      if (!parsed) {
        log.warn({ feature, responseText: responseText.slice(0, 500) }, 'Failed to parse LLM suggestion response');
        return reply.code(500).send({ error: 'Failed to parse AI suggestion. The model may not have returned valid JSON.' });
      }

      // Store the suggestion
      const suggestion = await insertPromptSuggestion({
        feature,
        current_prompt: currentPrompt,
        suggested_prompt: parsed.suggestedPrompt,
        reasoning: parsed.reasoning,
        evidence_feedback_ids: negativeFeedback.slice(0, 10).map(f => f.id),
        negative_count: negativeCount,
      });

      writeAuditLog({
        user_id: request.user?.sub,
        username: request.user?.username,
        action: 'feedback.generate_suggestion',
        target_type: 'llm_prompt_suggestion',
        target_id: suggestion.id,
        details: { feature, negativeCount },
        request_id: request.requestId,
        ip_address: request.ip,
      });

      return reply.code(201).send(suggestion);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      log.error({ err, feature }, 'Failed to generate prompt suggestion');
      return reply.code(500).send({ error: `Failed to generate suggestion: ${message}` });
    }
  });

  // ── List prompt suggestions (admin only) ──────────────────────

  fastify.get('/api/llm/feedback/suggestions', {
    schema: {
      tags: ['LLM Feedback'],
      summary: 'List prompt improvement suggestions',
      security: [{ bearerAuth: [] }],
      querystring: SuggestionListQuerySchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request) => {
    const query = request.query as z.infer<typeof SuggestionListQuerySchema>;
    return await listPromptSuggestions(query);
  });

  // ── Update suggestion status (admin only) ──────────────────────

  fastify.put('/api/llm/feedback/suggestions/:id', {
    schema: {
      tags: ['LLM Feedback'],
      summary: 'Update a prompt suggestion status (apply, dismiss, or edit)',
      security: [{ bearerAuth: [] }],
      params: SuggestionIdParamsSchema,
      body: UpdateSuggestionStatusSchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { status } = request.body as z.infer<typeof UpdateSuggestionStatusSchema>;
    const userId = request.user?.sub ?? 'unknown';

    const result = await updatePromptSuggestionStatus(id, status, userId);
    if (!result) {
      return reply.code(404).send({ error: 'Suggestion not found' });
    }

    writeAuditLog({
      user_id: userId,
      username: request.user?.username,
      action: `suggestion.${status}`,
      target_type: 'llm_prompt_suggestion',
      target_id: id,
      details: { status, feature: result.feature },
      request_id: request.requestId,
      ip_address: request.ip,
    });

    return result;
  });
}

// ── Helpers ─────────────────────────────────────────────────────────

function buildAnalysisPrompt(
  feature: string,
  featureLabel: string,
  currentPrompt: string,
  feedbackSummary: string,
  feedbackWithoutComments: number,
  totalNegative: number,
): string {
  return `You are analyzing user feedback for the "${featureLabel}" (${feature}) LLM feature in a Docker container monitoring dashboard.

## Current System Prompt
\`\`\`
${currentPrompt}
\`\`\`

## Negative Feedback Summary
Total negative feedback entries: ${totalNegative}
Entries without comments: ${feedbackWithoutComments}

### User Comments:
${feedbackSummary || 'No comments provided.'}

## Your Task
1. Identify the top 2-3 recurring themes or patterns in the negative feedback
2. Determine which aspects of the current prompt might be causing the issues
3. Write an improved version of the system prompt that addresses the feedback

## Key Principles for Prompt Improvement
- Be specific and directive rather than vague
- Add relevant constraints that address the most common complaints
- Maintain the original intent and capabilities
- Don't make the prompt excessively long -- conciseness is important
- Focus on the highest-impact changes first
- If users complain about accuracy, add verification steps
- If users complain about verbosity, add conciseness instructions
- If users complain about missing context, add context-gathering instructions

## Required Response Format
Respond with ONLY valid JSON (no markdown fences, no explanation outside JSON):
{
  "patterns": ["pattern1", "pattern2", "pattern3"],
  "reasoning": "A 2-3 sentence explanation of why the current prompt is producing unsatisfactory results and what the key improvement is.",
  "suggestedPrompt": "The complete improved system prompt text."
}`;
}

function parseSuggestionResponse(response: string): { suggestedPrompt: string; reasoning: string } | null {
  try {
    // Try to extract JSON from the response (handle markdown fences)
    let jsonStr = response.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr) as { suggestedPrompt?: string; reasoning?: string };
    if (!parsed.suggestedPrompt || !parsed.reasoning) {
      return null;
    }

    return {
      suggestedPrompt: parsed.suggestedPrompt,
      reasoning: parsed.reasoning,
    };
  } catch {
    return null;
  }
}
