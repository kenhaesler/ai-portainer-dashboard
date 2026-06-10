import { Agent, fetch as undiciFetch } from 'undici';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import pLimit from 'p-limit';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import { getConfig } from '@dashboard/core/config/index.js';
import { getEffectiveLlmConfig, type PromptFeature } from './prompt-store.js';
import { insertLlmTrace } from './llm-trace-store.js';
import { isPromptInjection, sanitizeLlmOutput } from './prompt-guard.js';
import { withSpan } from '@dashboard/core/tracing/trace-context.js';
import { scrubPii, scrubPiiDeep } from '@dashboard/core/utils/pii-scrubber.js';
import type { NormalizedEndpoint, NormalizedContainer } from '@dashboard/core/portainer/portainer-normalizers.js';
import type { Insight } from '@dashboard/core/models/monitoring.js';

const log = createChildLogger('llm-client');

/**
 * Global concurrency limiter for LLM calls.
 * Prevents overwhelming the configured endpoint when multiple services
 * (investigations, remediation, log analysis, incident summaries) all
 * trigger LLM calls during the same monitoring cycle.
 * Max 2 concurrent calls — additional callers queue automatically.
 */
const LLM_MAX_CONCURRENCY = 2;
const llmLimit = pLimit(LLM_MAX_CONCURRENCY);

/** Expose current pending/active count for observability and testing. */
export function getLlmQueueSize(): { pending: number; active: number } {
  return { pending: llmLimit.pendingCount, active: llmLimit.activeCount };
}

/** Read custom CA certificate from NODE_EXTRA_CA_CERTS if set */
function getCustomCaCert(): Buffer | undefined {
  const certPath = process.env.NODE_EXTRA_CA_CERTS;
  if (!certPath) return undefined;
  try {
    return readFileSync(certPath);
  } catch (err) {
    log.warn({ err, certPath }, 'Failed to read custom CA certificate from NODE_EXTRA_CA_CERTS');
    return undefined;
  }
}

/**
 * Cached undici Agent for LLM fetch calls.
 * When LLM_VERIFY_SSL=false, disables certificate verification so that
 * self-signed or internal-CA endpoints work.
 * When NODE_EXTRA_CA_CERTS is set, passes the CA cert to undici (which does not
 * read this env var automatically like Node's built-in TLS).
 */
let llmDispatcher: Agent | undefined;
export function getLlmDispatcher(): Agent | undefined {
  if (llmDispatcher) return llmDispatcher;
  const config = getConfig();
  const ca = getCustomCaCert();
  if (!config.LLM_VERIFY_SSL) {
    log.warn('TLS certificate verification disabled for LLM connections (LLM_VERIFY_SSL=false) — not recommended for production');
    // nosemgrep: bypass-tls-verification — intentional: admin-configurable SSL verification bypass
    llmDispatcher = new Agent({ connect: { rejectUnauthorized: false } });
    return llmDispatcher;
  }
  if (ca) {
    llmDispatcher = new Agent({ connect: { ca } });
    return llmDispatcher;
  }
  return undefined;
}

/** Rough token estimate: ~4 chars per token for English text */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Normalize the configured LLM API URL so users can enter just the base URL
 * (e.g. `http://lmstudio:1234`) without remembering the exact path. Most
 * OpenAI-compatible servers (OpenAI, LM Studio, vLLM, LiteLLM, LocalAI,
 * OpenRouter) expose chat at `/v1/chat/completions`; some (Open WebUI) use
 * `/api/chat/completions`. URLs that already point at a chat-completions
 * endpoint are returned unchanged, so existing configs keep working.
 *
 * Rules:
 * - URL already ends with `/chat/completions` (any prefix) → unchanged
 * - URL ends with `/v1` → append `/chat/completions`
 * - Anything else → append `/v1/chat/completions` to the existing path
 *   (so reverse-proxy prefixes like `http://host/proxy` still work)
 */
export function resolveChatCompletionsUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return trimmed;

  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
  if (/\/v\d+$/i.test(trimmed)) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

/**
 * Derive the `/v1/models` URL from the configured chat-completions URL by
 * stripping the `/chat/completions` suffix (if present). Used by health
 * probes and the model-listing endpoint.
 */
export function resolveModelsUrl(rawUrl: string): string {
  const chatUrl = resolveChatCompletionsUrl(rawUrl);
  return chatUrl.replace(/\/chat\/completions$/i, '/models');
}

/**
 * Extract a human-readable error message from a non-streaming JSON response
 * body that the OpenAI-compatible parser would otherwise drop silently.
 *
 * Servers like LM Studio (when called on the wrong path), OpenRouter, and
 * vLLM return `200 OK` with a JSON body shaped like `{ "error": "..." }` or
 * `{ "error": { "message": "..." } }`. Without this, the streaming parser
 * skips these because they have no `choices[0].delta.content`, leading to
 * silent empty responses.
 */
export function extractApiError(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const err = (json as { error?: unknown }).error;
  if (!err) return null;
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && err !== null) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string') return message;
    return JSON.stringify(err);
  }
  return String(err);
}

/**
 * Extract a human-readable message from Node.js fetch errors.
 * Native fetch wraps the real cause (DNS, connection refused, SSL) inside err.cause.
 */
export function getFetchErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'Unknown connection error';
  const cause = (err as Error & { cause?: Error }).cause;
  if (cause instanceof Error) {
    // e.g. "getaddrinfo ENOTFOUND my-host" or "connect ECONNREFUSED 127.0.0.1:8080"
    return cause.message;
  }
  return err.message;
}

/**
 * Fetch wrapper that uses undici's fetch so the `dispatcher` option is
 * actually honored.  Global fetch() silently ignores `dispatcher`, which
 * means LLM_VERIFY_SSL=false had no effect.
 */
export function llmFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  return undiciFetch(url, {
    ...init,
    dispatcher: getLlmDispatcher(),
  } as any) as unknown as Promise<Response>;
}

export type LlmAuthType = 'bearer' | 'basic';

/**
 * The settings GET endpoint redacts sensitive values to this exact string
 * (see the REDACTED constant in the foundation settings route). Callers
 * that accept tokens from clients should treat this string as nullish —
 * sending it on to upstream services would defeat fallback logic and
 * silently strip to empty in getAuthHeaders (the bullets are outside
 * Latin-1) and yield a 401.
 */
export const REDACTED_TOKEN_PLACEHOLDER = '••••••••';

export function getAuthHeaders(token: string | undefined, authType: LlmAuthType = 'bearer'): Record<string, string> {
  if (!token) return {};

  // Strip non-Latin1 characters (code > 255) that break HTTP headers.
  // These commonly appear when tokens are copy-pasted from web UIs with
  // smart quotes, zero-width spaces, or other invisible Unicode characters.
  const sanitized = token.replace(/[^\x20-\xFF]/g, '');

  if (!sanitized) return {};

  if (authType === 'basic') {
    const base64Credentials = Buffer.from(sanitized).toString('base64');
    return { 'Authorization': `Basic ${base64Credentials}` };
  }

  // Default: Bearer token
  return { 'Authorization': `Bearer ${sanitized}` };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function chatStream(
  messages: ChatMessage[],
  systemPrompt: string,
  onChunk: (chunk: string) => void,
  feature?: PromptFeature,
): Promise<string> {
  // Choke-point prompt guard: every chatStream caller funnels through here,
  // including internal flows (log analysis, anomaly explanation, incident
  // summaries, investigations, remediation, PCAP, forecasts, correlations)
  // whose user-role content embeds container-derived data an attacker can
  // influence — log lines, container names, insight descriptions. Guarding
  // here means a new caller cannot forget the guard. Internal callers treat
  // the throw like any other LLM failure and degrade gracefully.
  for (const message of messages) {
    if (message.role !== 'user') continue;
    const guard = isPromptInjection(message.content);
    if (guard.blocked) {
      log.warn(
        { feature, reason: guard.reason, score: guard.score },
        'LLM request blocked by prompt-injection guard',
      );
      throw new Error('LLM request blocked by prompt-injection guard');
    }
  }

  return llmLimit(() =>
    withSpan('LLM chat', 'llm-service', 'client', () =>
      chatStreamInner(messages, systemPrompt, onChunk, feature),
    ),
  );
}

async function chatStreamInner(
  messages: ChatMessage[],
  systemPrompt: string,
  onChunk: (chunk: string) => void,
  feature?: PromptFeature,
): Promise<string> {
  const llmConfig = await getEffectiveLlmConfig(feature);
  const config = getConfig();
  const startTime = Date.now();
  const requestTimeoutMs = config.LLM_REQUEST_TIMEOUT;

  if (!llmConfig.apiUrl) {
    throw new Error('LLM is not configured. Set LLM_API_URL or configure Settings → AI & LLM → API Endpoint URL.');
  }

  // Layer 1: PII Scrubbing (Privacy-first)
  const scrubbedMessages = scrubPiiDeep(messages);
  const scrubbedSystemPrompt = scrubPii(systemPrompt);

  const fullMessages: ChatMessage[] = [
    { role: 'system', content: scrubbedSystemPrompt },
    ...scrubbedMessages,
  ];

  // Extract user query from the last user message (for trace recording)
  const userQuery = [...scrubbedMessages].reverse().find((m) => m.role === 'user')?.content;

  let fullResponse = '';
  const chatUrl = resolveChatCompletionsUrl(llmConfig.apiUrl);

  // Stable correlation id per LLM call (#1239). Sent on the outbound request
  // as `x-trace-correlation-id` so the Beyla-captured client span and the
  // llm_traces row can be joined for the LLM latency-breakdown panel.
  const correlationId = randomUUID();

  try {
    const response = await llmFetch(chatUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-trace-correlation-id': correlationId,
        ...getAuthHeaders(llmConfig.apiToken, llmConfig.authType),
      },
      body: JSON.stringify({
        model: llmConfig.model,
        messages: fullMessages,
        stream: true,
        ...(llmConfig.temperature !== undefined ? { temperature: llmConfig.temperature } : {}),
      }),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Response body is not readable');
    }

    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter((line) => line.trim() !== '');

      for (const raw of lines) {
        // Strip SSE "data: " prefix (OpenAI-compatible streaming format)
        let payload = raw.trim();
        if (payload.startsWith('data: ')) payload = payload.slice(6);
        else if (payload.startsWith('data:')) payload = payload.slice(5);

        // Skip SSE end sentinel and comment lines
        if (payload === '[DONE]' || payload.startsWith(':')) continue;

        try {
          const json = JSON.parse(payload);
          const apiError = extractApiError(json);
          if (apiError) {
            throw new Error(`LLM endpoint returned an error: ${apiError}. Verify Settings → AI & LLM → API Endpoint URL points at an OpenAI-compatible chat-completions endpoint.`);
          }
          const content = json.choices?.[0]?.delta?.content || json.message?.content || '';
          if (content) {
            fullResponse += content;
            onChunk(content);
          }
        } catch (parseErr) {
          // Re-throw API errors; swallow JSON parse errors for non-JSON SSE lines.
          if (parseErr instanceof Error && parseErr.message.startsWith('LLM endpoint returned an error')) {
            throw parseErr;
          }
          // Skip non-JSON lines (e.g. SSE event types)
        }
      }
    }

    const latencyMs = Date.now() - startTime;
    const promptTokens = estimateTokens(fullMessages.map((m) => m.content).join(''));
    const completionTokens = estimateTokens(fullResponse);

    // Choke-point output sanitization: strip thinking blocks, leaked
    // tool-call JSON, and system-prompt leak patterns before the response
    // is returned to callers (and persisted in traces/insights). Streamed
    // chunks via onChunk are necessarily raw — live-stream consumers (chat
    // socket, SSE summaries) apply their own final-message sanitization.
    const sanitizedResponse = sanitizeLlmOutput(fullResponse);

    try {
      await insertLlmTrace({
        trace_id: correlationId,
        model: llmConfig.model,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
        latency_ms: latencyMs,
        status: 'success',
        user_query: userQuery?.slice(0, 500),
        response_preview: sanitizedResponse.slice(0, 500),
      });
    } catch (traceErr) {
      log.warn({ err: traceErr }, 'Failed to record LLM trace');
    }

    // Debug-level so a chatty deployment doesn't flood info logs on every
    // successful chat. The correlation id is included for operators who
    // turn on debug while troubleshooting the LLM latency-breakdown panel.
    log.debug(
      {
        correlation_id: correlationId,
        model: llmConfig.model,
        model_latency_ms: latencyMs,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        responseLength: fullResponse.length,
      },
      'LLM chat stream completed',
    );
    return sanitizedResponse;
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    try {
      await insertLlmTrace({
        trace_id: correlationId,
        model: llmConfig.model,
        prompt_tokens: estimateTokens(fullMessages.map((m) => m.content).join('')),
        completion_tokens: 0,
        total_tokens: estimateTokens(fullMessages.map((m) => m.content).join('')),
        latency_ms: latencyMs,
        status: 'error',
        user_query: userQuery?.slice(0, 500),
        response_preview: err instanceof Error ? err.message.slice(0, 500) : 'Unknown error',
      });
    } catch (traceErr) {
      log.warn({ err: traceErr }, 'Failed to record LLM error trace');
    }

    log.error({ err, correlation_id: correlationId, model_latency_ms: latencyMs }, 'LLM chat stream failed');
    throw err;
  }
}

export function buildInfrastructureContext(
  endpoints: NormalizedEndpoint[],
  containers: NormalizedContainer[],
  insights: Insight[],
): string {
  const endpointSummary = endpoints
    .map((ep) => {
      const epContainers = containers.filter((c) => c.endpointId === ep.id);
      const running = epContainers.filter((c) => c.state === 'running').length;
      const stopped = epContainers.filter((c) => c.state === 'stopped').length;
      return `- ${ep.name} (${ep.status}): ${running} running, ${stopped} stopped`;
    })
    .join('\n');

  const runningContainers = containers.filter((c) => c.state === 'running');
  const stoppedContainers = containers.filter((c) => c.state === 'stopped');
  const unhealthyContainers = containers.filter(
    (c) => c.state === 'dead' || c.state === 'paused',
  );

  const containerSummary = [
    `Total: ${containers.length}`,
    `Running: ${runningContainers.length}`,
    `Stopped: ${stoppedContainers.length}`,
    `Unhealthy/Dead: ${unhealthyContainers.length}`,
  ].join(', ');

  const containerDetails = containers
    .slice(0, 50)
    .map((c) => `- ${c.name} (${c.image}): ${c.state} on ${c.endpointName}`)
    .join('\n');

  const recentInsights = insights
    .slice(0, 20)
    .map((i) => `- [${i.severity.toUpperCase()}] ${i.title}: ${i.description}`)
    .join('\n');

  const context = `You are an AI assistant specializing in Docker container infrastructure management. You have access to the following infrastructure data:

## Endpoints
${endpointSummary || 'No endpoints available.'}

## Container Summary
${containerSummary}

## Container Details
${containerDetails || 'No containers available.'}

## Recent Insights
${recentInsights || 'No recent insights.'}

Provide concise, actionable recommendations. When suggesting changes, always explain the potential impact and risks. Never perform destructive actions without explicit user confirmation.`;

  // Scrub any accidental PII in endpoint/container names before sending to LLM
  return scrubPii(context);
}

/**
 * Probe the configured LLM endpoint via `/v1/models`. Returns true if the
 * endpoint responds with HTTP 2xx, false otherwise (or if no URL is set).
 */
export async function isLlmAvailable(): Promise<boolean> {
  try {
    const llmConfig = await getEffectiveLlmConfig();
    if (!llmConfig.apiUrl) return false;

    const modelsUrl = resolveModelsUrl(llmConfig.apiUrl);
    const response = await llmFetch(modelsUrl, {
      headers: {
        ...getAuthHeaders(llmConfig.apiToken, llmConfig.authType),
      },
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    log.warn('LLM endpoint is not available');
    return false;
  }
}
