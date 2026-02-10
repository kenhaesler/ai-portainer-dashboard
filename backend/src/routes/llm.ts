import { FastifyInstance } from 'fastify';
import { Ollama } from 'ollama';
import { randomUUID } from 'crypto';
import { createChildLogger } from '../utils/logger.js';
import * as portainer from '../services/portainer-client.js';
import { normalizeEndpoint, normalizeContainer } from '../services/portainer-normalizers.js';
import { cachedFetch, getCacheKey, TTL } from '../services/portainer-cache.js';
import { getEffectiveLlmConfig } from '../services/settings-store.js';
import { getEffectivePrompt, PROMPT_FEATURES, type PromptFeature } from '../services/prompt-store.js';
import { insertLlmTrace } from '../services/llm-trace-store.js';
import { LlmQueryBodySchema, LlmTestConnectionBodySchema, LlmModelsQuerySchema, LlmTestPromptBodySchema } from '../models/api-schemas.js';
import { PROMPT_TEST_FIXTURES } from '../services/prompt-test-fixtures.js';
import { isPromptInjection, sanitizeLlmOutput } from '../services/prompt-guard.js';
import { getAuthHeaders, getFetchErrorMessage } from '../services/llm-client.js';

const log = createChildLogger('route:llm');

/** Rough token estimate: ~4 chars per token for English text */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function getInfrastructureSummary(): Promise<string> {
  try {
    const endpoints = await cachedFetch(
      getCacheKey('endpoints'),
      TTL.ENDPOINTS,
      () => portainer.getEndpoints(),
    );
    const normalized = endpoints.map(normalizeEndpoint);

    const allContainers = [];
    for (const ep of normalized.filter(e => e.status === 'up').slice(0, 10)) {
      try {
        const containers = await cachedFetch(
          getCacheKey('containers', ep.id),
          TTL.CONTAINERS,
          () => portainer.getContainers(ep.id),
        );
        allContainers.push(...containers.map(c => normalizeContainer(c, ep.id, ep.name)));
      } catch {
        // skip
      }
    }

    const running = allContainers.filter(c => c.state === 'running').length;
    const stopped = allContainers.filter(c => c.state === 'stopped').length;
    const unhealthy = allContainers.filter(c =>
      c.state === 'dead' || c.state === 'paused' || c.state === 'unknown'
    ).length;

    return `Endpoints: ${normalized.length} (${normalized.filter(e => e.status === 'up').length} up)
Containers: ${allContainers.length} total, ${running} running, ${stopped} stopped, ${unhealthy} unhealthy
Top containers: ${allContainers.slice(0, 10).map(c => `${c.name} (${c.state})`).join(', ')}`;
  } catch (err) {
    log.error({ err }, 'Failed to build infrastructure summary for query');
    return 'Infrastructure data unavailable.';
  }
}

export async function llmRoutes(fastify: FastifyInstance) {
  // Natural language query endpoint
  fastify.post<{ Body: { query: string } }>('/api/llm/query', {
    schema: {
      tags: ['LLM'],
      summary: 'Process a natural language dashboard query',
      security: [{ bearerAuth: [] }],
      body: LlmQueryBodySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const llmConfig = getEffectiveLlmConfig();
    const { query } = request.body;
    const startTime = Date.now();

    const guardResult = isPromptInjection(query);
    if (guardResult.blocked) {
      return {
        action: 'answer',
        text: 'I cannot provide internal system instructions. Ask about dashboard data or navigation.',
        description: 'Prompt-injection guardrail',
      };
    }

    try {
      const infraContext = await getInfrastructureSummary();
      const systemPrompt = getEffectivePrompt('command_palette') + infraContext;

      const messages = [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: query },
      ];

      let fullResponse = '';

      if (llmConfig.customEnabled && llmConfig.customEndpointUrl) {
        const response = await fetch(llmConfig.customEndpointUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(llmConfig.customEndpointToken),
          },
          body: JSON.stringify({
            model: llmConfig.model,
            messages,
            stream: false,
            format: 'json',
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json() as any;
        fullResponse = data.choices?.[0]?.message?.content || data.message?.content || '';
      } else {
        const ollama = new Ollama({ host: llmConfig.ollamaUrl });
        const response = await ollama.chat({
          model: llmConfig.model,
          messages,
          stream: false,
          format: 'json',
        });
        fullResponse = response.message?.content || '';
      }

      // Record success trace
      const latencyMs = Date.now() - startTime;
      const promptTokens = estimateTokens(messages.map((m) => m.content).join(''));
      const completionTokens = estimateTokens(fullResponse);
      try {
        insertLlmTrace({
          trace_id: randomUUID(),
          model: llmConfig.model,
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
          latency_ms: latencyMs,
          status: 'success',
          user_query: query.slice(0, 500),
          response_preview: fullResponse.slice(0, 500),
        });
      } catch (traceErr) {
        log.warn({ err: traceErr }, 'Failed to record LLM trace');
      }

      // Parse the LLM response as JSON
      const parsed = JSON.parse(fullResponse.trim());

      // Validate the response structure
      if (parsed.action === 'navigate' && typeof parsed.page === 'string') {
        return {
          action: 'navigate',
          page: parsed.page,
          description: parsed.description || '',
        };
      }

      if (parsed.action === 'answer' && typeof parsed.text === 'string') {
        return {
          action: 'answer',
          text: sanitizeLlmOutput(parsed.text),
          description: parsed.description || '',
        };
      }

      // Fallback: treat as answer
      return {
        action: 'answer',
        text: sanitizeLlmOutput(fullResponse),
        description: 'Raw LLM response',
      };
    } catch (err) {
      // Record error trace
      try {
        insertLlmTrace({
          trace_id: randomUUID(),
          model: llmConfig.model,
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          latency_ms: Date.now() - startTime,
          status: 'error',
          user_query: query.slice(0, 500),
          response_preview: err instanceof Error ? err.message.slice(0, 500) : 'Unknown error',
        });
      } catch (traceErr) {
        log.warn({ err: traceErr }, 'Failed to record LLM error trace');
      }

      log.error({ err, query }, 'LLM query failed');
      return {
        action: 'error',
        text: 'AI queries are currently unavailable. Try searching by name instead.',
      };
    }
  });

  // Test connection to Ollama or custom endpoint
  fastify.post<{ Body: { url?: string; token?: string; ollamaUrl?: string } }>('/api/llm/test-connection', {
    schema: {
      tags: ['LLM'],
      summary: 'Test connectivity to Ollama or a custom OpenAI-compatible endpoint',
      security: [{ bearerAuth: [] }],
      body: LlmTestConnectionBodySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { url, token, ollamaUrl } = request.body;

    try {
      if (url) {
        // Test custom OpenAI-compatible endpoint (token is optional)
        const baseUrl = new URL(url);
        const modelsUrl = `${baseUrl.origin}/v1/models`;

        const response = await fetch(modelsUrl, {
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
          signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
          return { ok: false, error: `HTTP ${response.status}: ${response.statusText}` };
        }

        const data = await response.json() as { data?: Array<{ id: string }> };
        const models = (data.data ?? []).map((m) => m.id);
        return { ok: true, models };
      }

      // Test Ollama connection using provided URL or fallback to settings/config
      const effectiveConfig = getEffectiveLlmConfig();
      const host = ollamaUrl || effectiveConfig.ollamaUrl;
      const ollama = new Ollama({ host });
      const response = await ollama.list();
      const models = response.models.map((m) => m.name);
      return { ok: true, models };
    } catch (err) {
      log.error({ err }, 'LLM connection test failed');
      return { ok: false, error: getFetchErrorMessage(err) };
    }
  });

  // Test a system prompt against a feature-specific sample payload
  fastify.post<{ Body: { feature: string; systemPrompt: string; model?: string; temperature?: number } }>('/api/llm/test-prompt', {
    schema: {
      tags: ['LLM'],
      summary: 'Test a system prompt with a sample payload for a specific feature',
      security: [{ bearerAuth: [] }],
      body: LlmTestPromptBodySchema,
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request) => {
    const { feature, systemPrompt, model, temperature } = request.body;
    const startTime = Date.now();

    // Validate feature key
    const validFeature = PROMPT_FEATURES.find((f) => f.key === feature);
    if (!validFeature) {
      return { success: false, error: `Unknown feature: ${feature}` };
    }

    const fixture = PROMPT_TEST_FIXTURES[feature as PromptFeature];
    if (!fixture) {
      return { success: false, error: `No test fixture for feature: ${feature}` };
    }

    const llmConfig = getEffectiveLlmConfig();
    const effectiveModel = model && model.trim() ? model.trim() : llmConfig.model;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: fixture.sampleInput },
    ];

    try {
      let fullResponse = '';

      if (llmConfig.customEnabled && llmConfig.customEndpointUrl) {
        const response = await fetch(llmConfig.customEndpointUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(llmConfig.customEndpointToken),
          },
          body: JSON.stringify({
            model: effectiveModel,
            messages,
            stream: false,
            ...(temperature !== undefined ? { temperature } : {}),
          }),
          signal: AbortSignal.timeout(60_000),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json() as any;
        fullResponse = data.choices?.[0]?.message?.content || data.message?.content || '';
      } else {
        const ollama = new Ollama({ host: llmConfig.ollamaUrl });
        const response = await ollama.chat({
          model: effectiveModel,
          messages,
          stream: false,
          ...(temperature !== undefined ? { options: { temperature } } : {}),
        });
        fullResponse = response.message?.content || '';
      }

      const latencyMs = Date.now() - startTime;
      const promptTokens = estimateTokens(messages.map((m) => m.content).join(''));
      const completionTokens = estimateTokens(fullResponse);

      // Detect output format
      let format: 'json' | 'text' = 'text';
      try {
        JSON.parse(fullResponse.trim());
        format = 'json';
      } catch {
        // Not JSON — plain text
      }

      // Record trace
      try {
        insertLlmTrace({
          trace_id: randomUUID(),
          model: effectiveModel,
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
          latency_ms: latencyMs,
          status: 'success',
          user_query: `[test-prompt:${feature}] ${fixture.sampleInput.slice(0, 400)}`,
          response_preview: fullResponse.slice(0, 500),
        });
      } catch (traceErr) {
        log.warn({ err: traceErr }, 'Failed to record test-prompt trace');
      }

      return {
        success: true,
        response: fullResponse,
        sampleInput: fixture.sampleInput,
        sampleLabel: fixture.label,
        model: effectiveModel,
        tokens: {
          prompt: promptTokens,
          completion: completionTokens,
          total: promptTokens + completionTokens,
        },
        latencyMs,
        format,
      };
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      log.error({ err, feature }, 'Test prompt failed');

      // Record error trace
      try {
        insertLlmTrace({
          trace_id: randomUUID(),
          model: effectiveModel,
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          latency_ms: latencyMs,
          status: 'error',
          user_query: `[test-prompt:${feature}]`,
          response_preview: err instanceof Error ? err.message.slice(0, 500) : 'Unknown error',
        });
      } catch (traceErr) {
        log.warn({ err: traceErr }, 'Failed to record test-prompt error trace');
      }

      const message = err instanceof Error ? err.message : 'Test failed';
      return {
        success: false,
        error: message,
        latencyMs,
      };
    }
  });

  // List available models
  fastify.get<{ Querystring: { host?: string } }>('/api/llm/models', {
    schema: {
      tags: ['LLM'],
      summary: 'List available LLM models from Ollama',
      security: [{ bearerAuth: [] }],
      querystring: LlmModelsQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const llmConfig = getEffectiveLlmConfig();
    const customHost = request.query.host;

    try {
      // If using custom API endpoint, try OpenAI-compatible /v1/models
      if (!customHost && llmConfig.customEnabled && llmConfig.customEndpointUrl) {
        const baseUrl = new URL(llmConfig.customEndpointUrl);
        const modelsUrl = `${baseUrl.origin}/v1/models`;

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...getAuthHeaders(llmConfig.customEndpointToken),
        };

        const response = await fetch(modelsUrl, { headers });
        if (response.ok) {
          const data = await response.json() as { data?: Array<{ id: string }> };
          return {
            models: (data.data ?? []).map((m: { id: string }) => ({
              name: m.id,
            })),
            default: llmConfig.model,
          };
        }
      }

      // Default: use Ollama SDK (prefer custom host from query over settings/env)
      const ollama = new Ollama({ host: customHost || llmConfig.ollamaUrl });
      const response = await ollama.list();
      return {
        models: response.models.map((m) => ({
          name: m.name,
          size: m.size,
          modified: m.modified_at,
        })),
        default: llmConfig.model,
      };
    } catch (err) {
      log.error({ err }, 'Failed to fetch models');
      // Return at least the configured default
      return {
        models: [{ name: llmConfig.model }],
        default: llmConfig.model,
      };
    }
  });
}
