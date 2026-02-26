import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { createChildLogger } from '../../../core/utils/logger.js';
import { getConfig } from '../../../core/config/index.js';
import * as portainer from '../../../core/portainer/portainer-client.js';
import { normalizeEndpoint, normalizeContainer } from '../../../core/portainer/portainer-normalizers.js';
import { cachedFetch, getCacheKey, TTL } from '../../../core/portainer/portainer-cache.js';
import { getEffectiveLlmConfig } from '../../../core/services/settings-store.js';
import { getEffectivePrompt, PROMPT_FEATURES, type PromptFeature } from '../services/prompt-store.js';
import { insertLlmTrace } from '../services/llm-trace-store.js';
import { LlmQueryBodySchema, LlmTestConnectionBodySchema, LlmModelsQuerySchema, LlmTestPromptBodySchema } from '../../../core/models/api-schemas.js';
import { PROMPT_TEST_FIXTURES } from '../services/prompt-test-fixtures.js';
import { isPromptInjection, sanitizeLlmOutput } from '../services/prompt-guard.js';
import { getAuthHeaders, getFetchErrorMessage, llmFetch, createOllamaClient, createConfiguredOllamaClient } from '../services/llm-client.js';

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

    const containerList = allContainers.map(c => `${c.name} (${c.state}, image:${c.image})`).join(', ');

    return `Endpoints: ${normalized.length} (${normalized.filter(e => e.status === 'up').length} up)
Containers: ${allContainers.length} total, ${running} running, ${stopped} stopped, ${unhealthy} unhealthy
All containers: ${containerList}`;
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
    const llmConfig = await getEffectiveLlmConfig();
    const config = getConfig();
    const { query } = request.body;
    const startTime = Date.now();

    // Use AI_SEARCH_MODEL if set, fall back to model from settings/env (Ollama only)
    let searchModel = config.AI_SEARCH_MODEL;

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
      const systemPrompt = await getEffectivePrompt('command_palette') + infraContext;

      const messages = [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: query },
      ];

      let fullResponse = '';

      // Ollama only: try AI_SEARCH_MODEL, fall back to settings model if not available
      const ollama = await createConfiguredOllamaClient(llmConfig);

      try {
        const response = await ollama.chat({
          model: searchModel,
          messages,
          stream: false,
          format: 'json',
        });
        fullResponse = response.message?.content || '';
      } catch (modelErr) {
        // If model not found, fall back to the model from settings
        const errorMsg = modelErr instanceof Error ? modelErr.message : String(modelErr);
        if (errorMsg.includes('not found') && searchModel !== llmConfig.model) {
          log.warn({ searchModel, fallbackModel: llmConfig.model }, 'AI_SEARCH_MODEL not found in Ollama, falling back to settings model');
          searchModel = llmConfig.model;
          const response = await ollama.chat({
            model: searchModel,
            messages,
            stream: false,
            format: 'json',
          });
          fullResponse = response.message?.content || '';
        } else {
          throw modelErr;
        }
      }

      // Record success trace
      const latencyMs = Date.now() - startTime;
      const promptTokens = estimateTokens(messages.map((m) => m.content).join(''));
      const completionTokens = estimateTokens(fullResponse);
      try {
        await insertLlmTrace({
          trace_id: randomUUID(),
          model: searchModel,
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

      if (parsed.action === 'filter') {
        const filters = parsed.filters && typeof parsed.filters === 'object' ? parsed.filters : {};
        const containerNames = Array.isArray(parsed.containerNames)
          ? parsed.containerNames.filter((n: unknown): n is string => typeof n === 'string')
          : [];
        return {
          action: 'filter',
          text: sanitizeLlmOutput(typeof parsed.text === 'string' ? parsed.text : ''),
          description: parsed.description || '',
          filters,
          containerNames,
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
        await insertLlmTrace({
          trace_id: randomUUID(),
          model: searchModel,
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
        // Test custom endpoint — try OpenAI-compatible /v1/models first,
        // then fall back to Ollama-native /api/tags for proxies (e.g. ParisNeo)
        // that don't implement the OpenAI compatibility layer.
        const baseUrl = new URL(url);
        const authHeaders = getAuthHeaders(token, (await getEffectiveLlmConfig()).authType);
        const fetchOpts = {
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          signal: AbortSignal.timeout(10_000),
        };

        // Try OpenAI-compatible /v1/models
        const modelsUrl = `${baseUrl.origin}/v1/models`;
        const response = await llmFetch(modelsUrl, fetchOpts);

        if (response.ok) {
          const data = await response.json() as { data?: Array<{ id: string }> };
          const models = (data.data ?? []).map((m) => m.id);
          return { ok: true, models };
        }

        // Fallback: try Ollama-native /api/tags (for proxies like ParisNeo Ollama Proxy)
        const tagsUrl = `${baseUrl.origin}/api/tags`;
        try {
          const fallbackResponse = await llmFetch(tagsUrl, fetchOpts);
          if (fallbackResponse.ok) {
            const data = await fallbackResponse.json() as { models?: Array<{ name: string }> };
            const models = (data.models ?? []).map((m) => m.name);
            return { ok: true, models };
          }
        } catch {
          // Fallback also failed — report the original error
        }

        return { ok: false, error: `HTTP ${response.status}: ${response.statusText}` };
      }

      // Test Ollama connection using provided URL or fallback to settings/config
      const effectiveConfig = await getEffectiveLlmConfig();
      const host = ollamaUrl || effectiveConfig.ollamaUrl;
      const ollama = await createConfiguredOllamaClient({ ...effectiveConfig, ollamaUrl: host });
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

    const llmConfig = await getEffectiveLlmConfig();
    const effectiveModel = model && model.trim() ? model.trim() : llmConfig.model;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: fixture.sampleInput },
    ];

    try {
      let fullResponse = '';

      if (llmConfig.customEnabled && llmConfig.customEndpointUrl) {
        const response = await llmFetch(llmConfig.customEndpointUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeaders(llmConfig.customEndpointToken, llmConfig.authType),
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
        const ollama = await createConfiguredOllamaClient(llmConfig);
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
        await insertLlmTrace({
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
        await insertLlmTrace({
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
    const llmConfig = await getEffectiveLlmConfig();
    const customHost = request.query.host;

    try {
      // If using custom API endpoint, try OpenAI-compatible /v1/models
      if (!customHost && llmConfig.customEnabled && llmConfig.customEndpointUrl) {
        const baseUrl = new URL(llmConfig.customEndpointUrl);
        const modelsUrl = `${baseUrl.origin}/v1/models`;

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...getAuthHeaders(llmConfig.customEndpointToken, llmConfig.authType),
        };

        const response = await llmFetch(modelsUrl, { headers });
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
      const ollama = await createConfiguredOllamaClient({ ...llmConfig, ollamaUrl: customHost || llmConfig.ollamaUrl });
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
