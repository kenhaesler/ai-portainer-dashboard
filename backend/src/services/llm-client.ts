import { Ollama } from 'ollama';
import { Agent, fetch as undiciFetch } from 'undici';
import { randomUUID } from 'crypto';
import { createChildLogger } from '../utils/logger.js';
import { getConfig } from '../config/index.js';
import { getEffectiveLlmConfig } from './settings-store.js';
import { insertLlmTrace } from './llm-trace-store.js';
import { withSpan } from './trace-context.js';
import type { NormalizedEndpoint, NormalizedContainer } from './portainer-normalizers.js';
import type { Insight } from '../models/monitoring.js';

const log = createChildLogger('llm-client');

/**
 * Cached undici Agent for LLM fetch calls.
 * When LLM_VERIFY_SSL=false, disables certificate verification so that
 * self-signed or internal-CA endpoints (e.g. OpenWebUI behind a reverse proxy) work.
 */
let llmDispatcher: Agent | undefined;
export function getLlmDispatcher(): Agent | undefined {
  if (llmDispatcher) return llmDispatcher;
  const config = getConfig();
  if (!config.LLM_VERIFY_SSL) {
    llmDispatcher = new Agent({ connect: { rejectUnauthorized: false } });
    return llmDispatcher;
  }
  return undefined;
}

/** Rough token estimate: ~4 chars per token for English text */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
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

export function getAuthHeaders(token: string | undefined): Record<string, string> {
  if (!token) return {};

  // Strip non-Latin1 characters (code > 255) that break HTTP headers.
  // These commonly appear when tokens are copy-pasted from web UIs with
  // smart quotes, zero-width spaces, or other invisible Unicode characters.
  const sanitized = token.replace(/[^\x20-\xFF]/g, '');

  if (!sanitized) return {};

  // Check if token is in username:password format (Basic auth)
  if (sanitized.includes(':')) {
    const base64Credentials = Buffer.from(sanitized).toString('base64');
    return { 'Authorization': `Basic ${base64Credentials}` };
  }

  // Otherwise use Bearer token
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
): Promise<string> {
  return withSpan('LLM chat', 'llm-service', 'client', () =>
    chatStreamInner(messages, systemPrompt, onChunk),
  );
}

async function chatStreamInner(
  messages: ChatMessage[],
  systemPrompt: string,
  onChunk: (chunk: string) => void,
): Promise<string> {
  const llmConfig = getEffectiveLlmConfig();
  const startTime = Date.now();

  const fullMessages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  // Extract user query from the last user message (for trace recording)
  const userQuery = [...messages].reverse().find((m) => m.role === 'user')?.content;

  let fullResponse = '';

  try {
    // Use authenticated fetch if custom endpoint is enabled and configured
    // Token is optional — some endpoints (e.g. Open WebUI on internal networks) don't require auth
    if (llmConfig.customEnabled && llmConfig.customEndpointUrl) {
      const response = await llmFetch(llmConfig.customEndpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(llmConfig.customEndpointToken),
        },
        body: JSON.stringify({
          model: llmConfig.model,
          messages: fullMessages,
          stream: true,
        }),
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
            const content = json.choices?.[0]?.delta?.content || json.message?.content || '';
            if (content) {
              fullResponse += content;
              onChunk(content);
            }
          } catch {
            // Skip non-JSON lines (e.g. SSE event types)
          }
        }
      }
    } else {
      // Use Ollama SDK for local/unauthenticated access
      const ollama = new Ollama({ host: llmConfig.ollamaUrl });
      const response = await ollama.chat({
        model: llmConfig.model,
        messages: fullMessages,
        stream: true,
      });

      for await (const part of response) {
        const content = part.message?.content || '';
        if (content) {
          fullResponse += content;
          onChunk(content);
        }
      }
    }

    const latencyMs = Date.now() - startTime;
    const promptTokens = estimateTokens(fullMessages.map((m) => m.content).join(''));
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
        user_query: userQuery?.slice(0, 500),
        response_preview: fullResponse.slice(0, 500),
      });
    } catch (traceErr) {
      log.warn({ err: traceErr }, 'Failed to record LLM trace');
    }

    log.debug({ model: llmConfig.model, responseLength: fullResponse.length }, 'Chat stream completed');
    return fullResponse;
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    try {
      insertLlmTrace({
        trace_id: randomUUID(),
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

    // Translate cryptic ByteString error (occurs when Ollama SDK receives HTML instead of JSON)
    if (err instanceof Error && err.message.includes('ByteString')) {
      const translated = new Error(
        'LLM endpoint returned HTML instead of JSON. Check that the configured URL points to a valid Ollama or OpenAI-compatible API endpoint (e.g. /api/chat/completions, not a web UI page).',
      );
      log.error({ err: translated, originalMessage: err.message }, 'LLM chat stream failed — ByteString error translated');
      throw translated;
    }

    log.error({ err }, 'LLM chat stream failed');
    throw err;
  }
}

export function buildInfrastructureContext(
  endpoints: NormalizedEndpoint[],
  containers: NormalizedContainer[],
  insights: Insight[],
): string {
  const endpointSummary = endpoints
    .map((ep) => `- ${ep.name} (${ep.status}): ${ep.containersRunning} running, ${ep.containersStopped} stopped`)
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

  return `You are an AI assistant specializing in Docker container infrastructure management. You have access to the following infrastructure data:

## Endpoints
${endpointSummary || 'No endpoints available.'}

## Container Summary
${containerSummary}

## Container Details
${containerDetails || 'No containers available.'}

## Recent Insights
${recentInsights || 'No recent insights.'}

Provide concise, actionable recommendations. When suggesting changes, always explain the potential impact and risks. Never perform destructive actions without explicit user confirmation.`;
}

export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const llmConfig = getEffectiveLlmConfig();

    // When custom endpoint is enabled, test that instead of Ollama
    if (llmConfig.customEnabled && llmConfig.customEndpointUrl) {
      const baseUrl = new URL(llmConfig.customEndpointUrl);
      const modelsUrl = `${baseUrl.origin}/v1/models`;
      const response = await llmFetch(modelsUrl, {
        headers: {
          ...getAuthHeaders(llmConfig.customEndpointToken),
        },
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    }

    const ollama = new Ollama({ host: llmConfig.ollamaUrl });
    await ollama.list();
    return true;
  } catch {
    log.warn('LLM backend is not available');
    return false;
  }
}

/**
 * Ensure the configured model is available in Ollama, pulling it if needed.
 * Called at backend startup so the LLM Assistant is ready without manual intervention.
 */
export async function ensureModel(): Promise<void> {
  const llmConfig = getEffectiveLlmConfig();
  const { model, ollamaUrl } = llmConfig;

  // Custom endpoints manage their own models — skip Ollama pull
  if (llmConfig.customEnabled && llmConfig.customEndpointUrl) {
    log.info({ model, customEndpoint: llmConfig.customEndpointUrl }, 'Custom LLM endpoint configured — skipping Ollama model pull');
    return;
  }

  try {
    const ollama = new Ollama({ host: ollamaUrl });
    const { models } = await ollama.list();
    const installed = models.some((m) => m.name === model || m.name.startsWith(`${model}:`));

    if (installed) {
      log.info({ model }, 'Ollama model already available');
      return;
    }

    log.info({ model }, 'Pulling Ollama model (this may take a few minutes on first run)...');
    await ollama.pull({ model });
    log.info({ model }, 'Ollama model pulled successfully');
  } catch (err) {
    log.warn({ err, model }, 'Failed to ensure Ollama model — LLM features may be unavailable');
  }
}
