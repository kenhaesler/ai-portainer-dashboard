import { Ollama } from 'ollama';
import { randomUUID } from 'crypto';
import { createChildLogger } from '../utils/logger.js';
import { getEffectiveLlmConfig } from './settings-store.js';
import { insertLlmTrace } from './llm-trace-store.js';
import { withSpan } from './trace-context.js';
import type { NormalizedEndpoint, NormalizedContainer } from './portainer-normalizers.js';
import type { Insight } from '../models/monitoring.js';

const log = createChildLogger('llm-client');

/** Rough token estimate: ~4 chars per token for English text */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function getAuthHeaders(token: string | undefined): Record<string, string> {
  if (!token) return {};

  // Check if token is in username:password format (Basic auth)
  if (token.includes(':')) {
    const base64Credentials = Buffer.from(token).toString('base64');
    return { 'Authorization': `Basic ${base64Credentials}` };
  }

  // Otherwise use Bearer token
  return { 'Authorization': `Bearer ${token}` };
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
      const response = await fetch(llmConfig.customEndpointUrl, {
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

        for (const line of lines) {
          try {
            const json = JSON.parse(line);
            const content = json.choices?.[0]?.delta?.content || json.message?.content || '';
            if (content) {
              fullResponse += content;
              onChunk(content);
            }
          } catch {
            // Skip invalid JSON lines
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
      const response = await fetch(modelsUrl, {
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
