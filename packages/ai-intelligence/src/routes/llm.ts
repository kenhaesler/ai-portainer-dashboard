import '@dashboard/core/plugins/auth.js';
import '@dashboard/core/plugins/request-tracing.js';
import '@fastify/rate-limit';
import '@fastify/swagger';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'crypto';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import { getConfig } from '@dashboard/core/config/index.js';
import * as portainer from '@dashboard/core/portainer/portainer-client.js';
import { normalizeEndpoint, normalizeContainer } from '@dashboard/core/portainer/portainer-normalizers.js';
import { isDockerEndpoint } from '@dashboard/core/models/portainer.js';
import { cachedFetch, getCacheKey, TTL } from '@dashboard/core/portainer/portainer-cache.js';
import { getEffectivePrompt, getEffectiveLlmConfig, PROMPT_FEATURES, type PromptFeature } from '../services/prompt-store.js';
import { insertLlmTrace } from '../services/llm-trace-store.js';
import { LlmQueryBodySchema, LlmTestConnectionBodySchema, LlmModelsQuerySchema, LlmTestPromptBodySchema } from '@dashboard/core/models/api-schemas.js';
import { PROMPT_TEST_FIXTURES } from '../services/prompt-test-fixtures.js';
import { isPromptInjection, sanitizeLlmOutput } from '../services/prompt-guard.js';
import { getAuthHeaders, getFetchErrorMessage, llmFetch, REDACTED_TOKEN_PLACEHOLDER, resolveChatCompletionsUrl, resolveModelsUrl } from '../services/llm-client.js';

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
    for (const ep of normalized.filter(e => e.status === 'up' && isDockerEndpoint(e.type)).slice(0, 10)) {
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
  // Cast needed: Zod v4 type inference drops this property from the large EnvConfig union
  const llmRateMax = (getConfig() as Record<string, unknown>).LLM_RATE_LIMIT_PER_MINUTE as number;

  // Natural language query endpoint
  fastify.post<{ Body: { query: string } }>('/api/llm/query', {
    schema: {
      tags: ['LLM'],
      summary: 'Process a natural language dashboard query',
      security: [{ bearerAuth: [] }],
      body: LlmQueryBodySchema,
    },
    preHandler: [fastify.authenticate],
    config: {
      rateLimit: {
        max: llmRateMax ?? 20,
        timeWindow: '1 minute',
        hook: 'preHandler',
        keyGenerator: (request: FastifyRequest) => {
          return request.user?.sub ?? request.ip;
        },
      },
    },
  }, async (request) => {
    const llmConfig = await getEffectiveLlmConfig('command_palette');
    const { query } = request.body;
    const startTime = Date.now();

    const searchModel = llmConfig.model;

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

      if (!llmConfig.apiUrl) {
        return {
          action: 'error',
          text: 'AI Search is not configured. Set Settings → AI & LLM → API Endpoint URL.',
        };
      }

      const chatUrl = resolveChatCompletionsUrl(llmConfig.apiUrl);
      const response = await llmFetch(chatUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(llmConfig.apiToken, llmConfig.authType),
        },
        body: JSON.stringify({
          model: searchModel,
          messages,
          stream: false,
          response_format: { type: 'json_object' },
          ...(typeof (llmConfig as { temperature?: number }).temperature === 'number'
            ? { temperature: (llmConfig as { temperature?: number }).temperature }
            : {}),
        }),
        signal: AbortSignal.timeout(60_000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as any;
      const fullResponse: string = data.choices?.[0]?.message?.content || data.message?.content || '';

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

  // Test connection to the configured (or supplied) OpenAI-compatible LLM endpoint
  fastify.post<{ Body: { url?: string; token?: string; authType?: 'bearer' | 'basic' } }>('/api/llm/test-connection', {
    schema: {
      tags: ['LLM'],
      summary: 'Test connectivity to an OpenAI-compatible LLM endpoint',
      security: [{ bearerAuth: [] }],
      body: LlmTestConnectionBodySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { url, token, authType } = request.body;

    try {
      const effectiveConfig = await getEffectiveLlmConfig();
      const targetUrl = url || effectiveConfig.apiUrl;
      if (!targetUrl) {
        return { ok: false, error: 'No API endpoint URL configured. Set Settings → AI & LLM → API Endpoint URL.' };
      }

      // Defense-in-depth: if a client echoes back the redaction sentinel
      // returned by the settings GET, treat it as nullish so the stored
      // config wins. See REDACTED_TOKEN_PLACEHOLDER for full rationale.
      const tokenIsRedacted = token === REDACTED_TOKEN_PLACEHOLDER;
      const effectiveToken = (token && !tokenIsRedacted) ? token : effectiveConfig.apiToken;
      const effectiveAuthType = authType ?? effectiveConfig.authType;
      const authHeaders = getAuthHeaders(effectiveToken, effectiveAuthType);
      const modelsUrl = resolveModelsUrl(targetUrl);
      const response = await llmFetch(modelsUrl, {
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) {
        const data = await response.json() as { data?: Array<{ id: string }> };
        const models = (data.data ?? []).map((m) => m.id);
        return { ok: true, models };
      }

      return { ok: false, error: `HTTP ${response.status}: ${response.statusText}` };
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

    const llmConfig = await getEffectiveLlmConfig(feature as PromptFeature);
    const effectiveModel = model && model.trim() ? model.trim() : llmConfig.model;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: fixture.sampleInput },
    ];

    try {
      if (!llmConfig.apiUrl) {
        throw new Error('LLM is not configured. Set Settings → AI & LLM → API Endpoint URL.');
      }

      const chatUrl = resolveChatCompletionsUrl(llmConfig.apiUrl);
      const response = await llmFetch(chatUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(llmConfig.apiToken, llmConfig.authType),
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
      const fullResponse: string = data.choices?.[0]?.message?.content || data.message?.content || '';

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

  // List available models from the configured LLM endpoint
  fastify.get<{ Querystring: { host?: string } }>('/api/llm/models', {
    schema: {
      tags: ['LLM'],
      summary: 'List models from the configured OpenAI-compatible LLM endpoint',
      security: [{ bearerAuth: [] }],
      querystring: LlmModelsQuerySchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const llmConfig = await getEffectiveLlmConfig();
    // Optional `host` query param lets the Settings page probe an unsaved URL.
    const targetUrl = request.query.host || llmConfig.apiUrl;

    try {
      if (!targetUrl) {
        return { models: llmConfig.model ? [{ name: llmConfig.model }] : [], default: llmConfig.model };
      }

      const modelsUrl = resolveModelsUrl(targetUrl);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...getAuthHeaders(llmConfig.apiToken, llmConfig.authType),
      };

      const response = await llmFetch(modelsUrl, { headers });
      if (response.ok) {
        const data = await response.json() as { data?: Array<{ id: string }> };
        return {
          models: (data.data ?? []).map((m: { id: string }) => ({ name: m.id })),
          default: llmConfig.model,
        };
      }

      return {
        models: llmConfig.model ? [{ name: llmConfig.model }] : [],
        default: llmConfig.model,
      };
    } catch (err) {
      log.error({ err }, 'Failed to fetch models');
      return {
        models: llmConfig.model ? [{ name: llmConfig.model }] : [],
        default: llmConfig.model,
      };
    }
  });
}
