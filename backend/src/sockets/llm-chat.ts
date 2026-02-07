import { Namespace } from 'socket.io';
import { createChildLogger } from '../utils/logger.js';
import { Ollama } from 'ollama';
import * as portainer from '../services/portainer-client.js';
import { normalizeEndpoint, normalizeContainer } from '../services/portainer-normalizers.js';
import { cachedFetch, getCacheKey, TTL } from '../services/portainer-cache.js';
import { getEffectiveLlmConfig } from '../services/settings-store.js';
import { insertLlmTrace } from '../services/llm-trace-store.js';
import { getDb } from '../db/sqlite.js';
import { randomUUID } from 'crypto';
import { getToolSystemPrompt, parseToolCalls, executeToolCalls, type ToolCallResult } from '../services/llm-tools.js';

const log = createChildLogger('socket:llm');

const MAX_TOOL_ITERATIONS = 3;

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

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export function isRecoverableToolCallParseError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('error parsing tool call') ||
    (msg.includes('tool call') && msg.includes('unexpected end of json input'))
  );
}

// Per-session conversation history
const sessions = new Map<string, ChatMessage[]>();

async function buildInfrastructureContext(): Promise<string> {
  try {
    // Fetch infrastructure data
    const endpoints = await cachedFetch(
      getCacheKey('endpoints'),
      TTL.ENDPOINTS,
      () => portainer.getEndpoints(),
    );
    const normalizedEndpoints = endpoints.map(normalizeEndpoint);

    // Fetch containers from all active endpoints
    const allContainers = [];
    for (const ep of normalizedEndpoints.filter(e => e.status === 'up').slice(0, 10)) {
      try {
        const containers = await cachedFetch(
          getCacheKey('containers', ep.id),
          TTL.CONTAINERS,
          () => portainer.getContainers(ep.id),
        );
        allContainers.push(...containers.map(c => normalizeContainer(c, ep.id, ep.name)));
      } catch (err) {
        log.warn({ endpointId: ep.id }, 'Failed to fetch containers for endpoint');
      }
    }

    // Fetch insights from database
    const db = getDb();
    const insights = db.prepare(`
      SELECT * FROM insights
      ORDER BY created_at DESC LIMIT 50
    `).all() as Array<{
      id: string;
      endpoint_id: number | null;
      endpoint_name: string | null;
      container_id: string | null;
      container_name: string | null;
      severity: 'critical' | 'warning' | 'info';
      category: string;
      title: string;
      description: string;
      suggested_action: string | null;
      is_acknowledged: number;
      created_at: string;
    }>;

    // Build context summary
    const endpointSummary = normalizedEndpoints
      .map(ep => `- ${ep.name} (${ep.status}): ${ep.containersRunning} running, ${ep.containersStopped} stopped, ${ep.stackCount} stacks`)
      .join('\n');

    const runningContainers = allContainers.filter(c => c.state === 'running');
    const stoppedContainers = allContainers.filter(c => c.state === 'stopped');
    const unhealthyContainers = allContainers.filter(c =>
      c.state === 'dead' || c.state === 'paused' || c.state === 'unknown'
    );

    const containerSummary = `Total: ${allContainers.length}, Running: ${runningContainers.length}, Stopped: ${stoppedContainers.length}, Unhealthy: ${unhealthyContainers.length}`;

    // Group containers by stack
    const stacks = new Map<string, typeof allContainers>();
    for (const container of allContainers) {
      const stack = container.labels['com.docker.compose.project'];
      if (stack) {
        if (!stacks.has(stack)) stacks.set(stack, []);
        stacks.get(stack)!.push(container);
      }
    }

    const stackSummary = Array.from(stacks.entries())
      .map(([name, containers]) => `- ${name}: ${containers.length} containers (${containers.filter(c => c.state === 'running').length} running)`)
      .join('\n');

    // Get recent insights (already sorted by database query)
    const recentInsights = insights
      .slice(0, 10)
      .map(i => `- [${i.severity.toUpperCase()}] ${i.title}: ${i.description}${i.container_name ? ` (${i.container_name} on ${i.endpoint_name})` : ''}`)
      .join('\n');

    // Sample container details (top 20 most important ones)
    const containerDetails = [
      ...unhealthyContainers.slice(0, 5),
      ...runningContainers.filter(c => c.labels['com.docker.compose.project']).slice(0, 10),
      ...runningContainers.slice(0, 5)
    ]
      .slice(0, 20)
      .map(c => `- ${c.name} (${c.image}): ${c.state} on ${c.endpointName}`)
      .join('\n');

    return `## Infrastructure Overview

### Endpoints (${normalizedEndpoints.length})
${endpointSummary || 'No endpoints configured.'}

### Containers Summary
${containerSummary}

### Stacks (${stacks.size})
${stackSummary || 'No stacks detected.'}

### Key Container Details
${containerDetails || 'No containers available.'}

### Recent Issues & Insights (${insights.length} total)
${recentInsights || 'No recent insights.'}

## Your Role
You are an AI infrastructure assistant with deep integration into this Portainer dashboard. You have real-time access to:
- All endpoints and their health status
- Container states, resource usage, and configurations
- Stack compositions and relationships
- Historical insights and detected issues (displayed in the **AI Monitor** page)
- Container logs, metrics, and health checks
- Remediation actions queue (viewed in the **Remediation** page)

When answering questions:
1. Reference specific containers, endpoints, or stacks by name
2. Analyze patterns across the infrastructure based on the insights above
3. Provide actionable recommendations based on current state
4. Explain the reasoning behind your suggestions
5. Warn about potential risks or side effects
6. When critical issues are detected, inform the user that remediation actions may have been automatically suggested
7. Guide users to check the **AI Monitor** page for real-time insights and the **Remediation** page for pending actions

**Important:** The system automatically generates remediation action suggestions for critical issues (unhealthy containers, OOM errors, high CPU, restart loops). These appear in the Remediation page for human approval before execution.

Use markdown formatting for clarity. For code blocks, use proper language tags.`;

  } catch (err) {
    log.error({ err }, 'Failed to build infrastructure context');
    return '## Infrastructure Context Unavailable\n\nUnable to fetch current infrastructure data. Operating with limited context.';
  }
}

// Stream an LLM call and collect the full response
async function streamLlmCall(
  llmConfig: ReturnType<typeof getEffectiveLlmConfig>,
  selectedModel: string,
  messages: ChatMessage[],
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  let fullResponse = '';

  if (llmConfig.customEnabled && llmConfig.customEndpointUrl && llmConfig.customEndpointToken) {
    const response = await fetch(llmConfig.customEndpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(llmConfig.customEndpointToken),
      },
      body: JSON.stringify({
        model: selectedModel,
        messages,
        stream: true,
      }),
      signal,
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
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter((line) => line.trim() !== '');

      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          const text = json.choices?.[0]?.delta?.content || json.message?.content || '';
          if (text) {
            fullResponse += text;
            onChunk(text);
          }
        } catch {
          // Skip invalid JSON lines
        }
      }
    }
  } else {
    const ollama = new Ollama({ host: llmConfig.ollamaUrl });
    const response = await ollama.chat({
      model: selectedModel,
      messages,
      stream: true,
    });

    for await (const chunk of response) {
      if (signal?.aborted) break;
      const text = chunk.message?.content || '';
      fullResponse += text;
      onChunk(text);
    }
  }

  return fullResponse;
}

export function setupLlmNamespace(ns: Namespace) {
  ns.on('connection', (socket) => {
    const userId = socket.data.user?.sub || 'unknown';
    log.info({ userId }, 'LLM client connected');

    let abortController: AbortController | null = null;

    socket.on('chat:message', async (data: { text: string; context?: any; model?: string }) => {
      const llmConfig = getEffectiveLlmConfig();
      const selectedModel = data.model || llmConfig.model;

      // Get or create session history
      if (!sessions.has(socket.id)) {
        sessions.set(socket.id, []);
      }
      const history = sessions.get(socket.id)!;

      // Build infrastructure context
      const infrastructureContext = await buildInfrastructureContext();
      const toolPrompt = getToolSystemPrompt();

      const additionalContext = data.context ? `\n## Additional Context\n${JSON.stringify(data.context, null, 2)}` : '';
      const systemPromptCore = `You are an AI assistant specializing in Docker container infrastructure management, deeply integrated with this Portainer dashboard.

${infrastructureContext}

${additionalContext}

Provide concise, actionable responses. Use markdown formatting for code blocks and lists. When suggesting actions, explain the reasoning and potential impact.`;
      const systemPromptWithTools = `${systemPromptCore}\n\n${toolPrompt}`;
      const systemPromptWithoutTools = `${systemPromptCore}\n\nTool calling is temporarily unavailable for this response. Do not output tool_calls JSON. Provide the best direct answer you can from available context.`;

      history.push({ role: 'user', content: data.text });

      const startTime = Date.now();

      try {
        abortController = new AbortController();
        socket.emit('chat:start');

        let messages: ChatMessage[] = [
          { role: 'system', content: systemPromptWithTools },
          ...history.slice(-20),
        ];
        let toolsEnabled = true;

        let finalResponse = '';
        let toolIteration = 0;

        // Tool calling loop: stream response, check for tool calls, execute, repeat.
        // Every iteration streams chunks to the client. If tool calls are detected,
        // we emit chat:tool_response_pending to clear the streamed tool-call JSON,
        // then the next iteration streams the follow-up response progressively.
        while (toolIteration < MAX_TOOL_ITERATIONS) {
          let iterationResponse = '';

          try {
            iterationResponse = await streamLlmCall(
              llmConfig,
              selectedModel,
              messages,
              (text) => {
                socket.emit('chat:chunk', text);
              },
              abortController.signal,
            );
          } catch (streamErr) {
            if (toolsEnabled && isRecoverableToolCallParseError(streamErr)) {
              log.warn({ err: streamErr, userId }, 'LLM tool-call parse failed; retrying without tool mode');
              toolsEnabled = false;
              messages = [
                { role: 'system', content: systemPromptWithoutTools },
                ...history.slice(-20),
              ];
              continue;
            }
            throw streamErr;
          }

          if (abortController.signal.aborted) break;

          // Check if the response contains tool calls
          const toolCalls = toolsEnabled ? parseToolCalls(iterationResponse) : null;

          if (!toolCalls) {
            // No tool calls — this is the final response (already streamed above)
            finalResponse = iterationResponse;
            break;
          }

          // Tool calls detected — clear the streamed tool-call JSON from the frontend
          socket.emit('chat:tool_response_pending');

          // Execute tool calls
          log.debug({ userId, tools: toolCalls.map(t => t.tool), iteration: toolIteration }, 'Executing tool calls');
          socket.emit('chat:tool_call', {
            tools: toolCalls.map(t => t.tool),
            status: 'executing',
          });

          const results = await executeToolCalls(toolCalls);

          socket.emit('chat:tool_call', {
            tools: toolCalls.map(t => t.tool),
            status: 'complete',
            results: results.map(r => ({
              tool: r.tool,
              success: r.success,
              error: r.error,
            })),
          });

          // Add assistant's tool request and tool results to messages for next iteration
          messages = [
            ...messages,
            { role: 'assistant', content: iterationResponse },
            {
              role: 'system',
              content: `## Tool Results\n\nThe following tools were executed. Use these results to answer the user's question:\n\n${formatToolResults(results)}`,
            },
          ];

          toolIteration++;
        }

        if (!finalResponse && toolIteration >= MAX_TOOL_ITERATIONS) {
          finalResponse = 'I was unable to complete the request within the allowed number of tool calls. Please try a more specific question.';
          socket.emit('chat:chunk', finalResponse);
        }

        history.push({ role: 'assistant', content: finalResponse });

        socket.emit('chat:end', {
          id: randomUUID(),
          content: finalResponse,
        });

        // Record LLM trace
        const latencyMs = Date.now() - startTime;
        const promptTokens = estimateTokens(messages.map((m) => m.content).join(''));
        const completionTokens = estimateTokens(finalResponse);
        try {
          insertLlmTrace({
            trace_id: randomUUID(),
            session_id: socket.id,
            model: selectedModel,
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens,
            latency_ms: latencyMs,
            status: 'success',
            user_query: data.text.slice(0, 500),
            response_preview: finalResponse.slice(0, 500),
          });
        } catch (traceErr) {
          log.warn({ err: traceErr }, 'Failed to record LLM trace');
        }

        log.debug({ userId, messageLength: data.text.length, responseLength: finalResponse.length, toolIterations: toolIteration }, 'LLM chat completed');
      } catch (err) {
        log.error({ err, userId }, 'LLM chat error');
        socket.emit('chat:error', {
          message: err instanceof Error ? err.message : 'LLM unavailable',
        });

        // Record error trace
        try {
          insertLlmTrace({
            trace_id: randomUUID(),
            session_id: socket.id,
            model: selectedModel,
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
            latency_ms: Date.now() - startTime,
            status: 'error',
            user_query: data.text.slice(0, 500),
            response_preview: err instanceof Error ? err.message.slice(0, 500) : 'Unknown error',
          });
        } catch (traceErr) {
          log.warn({ err: traceErr }, 'Failed to record LLM error trace');
        }
      } finally {
        abortController = null;
      }
    });

    socket.on('chat:cancel', () => {
      if (abortController) {
        abortController.abort();
        socket.emit('chat:cancelled');
        log.debug({ userId }, 'LLM chat cancelled by user');
      }
    });

    socket.on('chat:clear', () => {
      sessions.delete(socket.id);
      socket.emit('chat:cleared');
      log.debug({ userId }, 'LLM chat history cleared');
    });

    socket.on('disconnect', () => {
      sessions.delete(socket.id);
      log.info({ userId }, 'LLM client disconnected');
    });
  });
}

function formatToolResults(results: ToolCallResult[]): string {
  return results.map((r) => {
    if (!r.success) {
      return `### ${r.tool} (FAILED)\nError: ${r.error}`;
    }
    return `### ${r.tool}\n\`\`\`json\n${JSON.stringify(r.data, null, 2)}\n\`\`\``;
  }).join('\n\n');
}
