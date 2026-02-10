import { Namespace } from 'socket.io';
import { createChildLogger } from '../utils/logger.js';
import { Ollama } from 'ollama';
import * as portainer from '../services/portainer-client.js';
import { normalizeEndpoint, normalizeContainer } from '../services/portainer-normalizers.js';
import { cachedFetch, getCacheKey, TTL } from '../services/portainer-cache.js';
import { getEffectiveLlmConfig } from '../services/settings-store.js';
import { getEffectivePrompt } from '../services/prompt-store.js';
import { insertLlmTrace } from '../services/llm-trace-store.js';
import { getDb } from '../db/sqlite.js';
import { randomUUID } from 'crypto';
import { getToolSystemPrompt, parseToolCalls, executeToolCalls, type ToolCallResult } from '../services/llm-tools.js';
import { collectAllTools, routeToolCalls, getMcpToolPrompt, type OllamaToolCall } from '../services/mcp-tool-bridge.js';
import { isPromptInjection, sanitizeLlmOutput } from '../services/prompt-guard.js';
import { getAuthHeaders } from '../services/llm-client.js';

const log = createChildLogger('socket:llm');

/** Configured via Settings → LLM → Max Tool Iterations (env: LLM_MAX_TOOL_ITERATIONS) */

/** Rough token estimate: ~4 chars per token for English text */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
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

/**
 * Detect when a response is raw tool-call JSON that the model hallucinated
 * (e.g. with invalid tool names).  Avoids false positives on natural language
 * that merely *mentions* tool_calls.
 */
export function looksLikeToolCallAttempt(text: string): boolean {
  const trimmed = text.trim();
  // Raw JSON object containing tool_calls
  if (trimmed.startsWith('{') && trimmed.includes('"tool_calls"')) return true;
  // JSON wrapped in a code fence
  const fenceContent = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenceContent && fenceContent[1].includes('"tool_calls"')) return true;
  return false;
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
      .map(c => {
        const ips = Object.values(c.networkIPs);
        const ipSuffix = ips.length > 0 ? ` [${ips.join(', ')}]` : '';
        return `- ${c.name} (${c.image}): ${c.state} on ${c.endpointName}${ipSuffix}`;
      })
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

  if (llmConfig.customEnabled && llmConfig.customEndpointUrl) {
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
        max_tokens: llmConfig.maxTokens,
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

      for (const raw of lines) {
        // Strip SSE "data: " prefix (OpenAI-compatible streaming format)
        let payload = raw.trim();
        if (payload.startsWith('data: ')) payload = payload.slice(6);
        else if (payload.startsWith('data:')) payload = payload.slice(5);

        // Skip SSE end sentinel and comment lines
        if (payload === '[DONE]' || payload.startsWith(':')) continue;

        try {
          const json = JSON.parse(payload);
          const text = json.choices?.[0]?.delta?.content || json.message?.content || '';
          if (text) {
            fullResponse += text;
            onChunk(text);
          }
        } catch {
          // Skip non-JSON lines (e.g. SSE event types)
        }
      }
    }
  } else {
    const ollama = new Ollama({ host: llmConfig.ollamaUrl });
    const response = await ollama.chat({
      model: selectedModel,
      messages,
      stream: true,
      options: { num_predict: llmConfig.maxTokens },
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

async function streamOllamaRawCall(
  llmConfig: ReturnType<typeof getEffectiveLlmConfig>,
  selectedModel: string,
  messages: ChatMessage[],
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const baseUrl = llmConfig.ollamaUrl.replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(llmConfig.customEndpointToken),
    },
    body: JSON.stringify({
      model: selectedModel,
      messages,
      stream: true,
      options: { num_predict: llmConfig.maxTokens },
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
  let fullResponse = '';
  let buffer = '';

  while (true) {
    if (signal?.aborted) break;
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      try {
        const json = JSON.parse(line);
        const text = json?.message?.content || '';
        if (text) {
          fullResponse += text;
          onChunk(text);
          continue;
        }
        const toolCallJson = normalizeToolCallsFromOllama(json);
        if (toolCallJson) {
          fullResponse += toolCallJson;
          // Don't emit tool call JSON as a chat chunk — the main loop
          // will detect and execute tool calls via parseToolCalls().
        }
      } catch {
        // Skip malformed NDJSON fragments.
      }
    }
  }

  // Flush any final buffered line.
  const remaining = buffer.trim();
  if (remaining) {
    try {
      const json = JSON.parse(remaining);
      const text = json?.message?.content || '';
      if (text) {
        fullResponse += text;
        onChunk(text);
      } else {
        const toolCallJson = normalizeToolCallsFromOllama(json);
        if (toolCallJson) {
          fullResponse += toolCallJson;
          // Don't emit tool call JSON as a chat chunk.
        }
      }
    } catch {
      // Ignore trailing partial JSON.
    }
  }

  return fullResponse;
}

function normalizeToolCallsFromOllama(json: any): string | null {
  const calls = json?.message?.tool_calls;
  if (!Array.isArray(calls) || calls.length === 0) return null;

  const normalized = calls
    .map((call: any) => {
      const tool = call?.function?.name || call?.tool || call?.name;
      if (!tool || typeof tool !== 'string') return null;

      let args = call?.function?.arguments ?? call?.arguments ?? {};
      if (typeof args === 'string') {
        try {
          args = JSON.parse(args);
        } catch {
          args = {};
        }
      }
      if (!args || typeof args !== 'object') {
        args = {};
      }

      return { tool, arguments: args };
    })
    .filter(Boolean);

  if (normalized.length === 0) return null;
  return JSON.stringify({ tool_calls: normalized });
}

/**
 * Converts raw chat context JSON into clear natural-language instructions
 * placed at the TOP of the system prompt so smaller LLMs don't lose it.
 */
export function formatChatContext(ctx: Record<string, unknown>): string {
  const page = ctx.page as string | undefined;

  // Metrics dashboard — container-focused context
  if (page === 'metrics-dashboard' && ctx.containerName) {
    const metrics = ctx.currentMetrics as { cpuAvg?: number; memoryAvg?: number } | undefined;
    const lines = [
      `## ACTIVE FOCUS — READ THIS FIRST`,
      ``,
      `The user is currently viewing the **Metrics Dashboard** for a specific container.`,
      `- **Container name**: ${ctx.containerName}`,
    ];
    if (ctx.containerId) lines.push(`- **Container ID**: ${ctx.containerId}`);
    if (ctx.endpointId) lines.push(`- **Endpoint ID**: ${ctx.endpointId}`);
    if (ctx.timeRange) lines.push(`- **Selected time range**: ${ctx.timeRange}`);
    if (metrics?.cpuAvg !== undefined) lines.push(`- **Current avg CPU**: ${Number(metrics.cpuAvg).toFixed(1)}%`);
    if (metrics?.memoryAvg !== undefined) lines.push(`- **Current avg Memory**: ${Number(metrics.memoryAvg).toFixed(1)}%`);
    lines.push(``);
    lines.push(`**IMPORTANT**: All questions from this user are about the container "${ctx.containerName}" unless they explicitly mention a different container. When using tools like get_container_logs or get_container_metrics, use container_name="${ctx.containerName}" automatically — do NOT ask the user which container they mean.`);
    return lines.join('\n');
  }

  // Generic fallback — structured but still readable
  if (Object.keys(ctx).length > 0) {
    const lines = [`## Additional Context`];
    for (const [key, value] of Object.entries(ctx)) {
      if (value !== undefined && value !== null) {
        lines.push(`- **${key}**: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
      }
    }
    return lines.join('\n');
  }

  return '';
}

/**
 * Call Ollama with native tool calling (non-streaming).
 * Returns the response message which may contain tool_calls.
 */
async function callOllamaWithNativeTools(
  llmConfig: ReturnType<typeof getEffectiveLlmConfig>,
  selectedModel: string,
  messages: ChatMessage[],
): Promise<{ content: string; toolCalls: OllamaToolCall[] }> {
  const tools = collectAllTools();
  log.debug({ toolCount: tools.length, toolNames: tools.map(t => t.function.name) }, 'Collected tools for native Ollama call');

  if (tools.length === 0) {
    return { content: '', toolCalls: [] };
  }

  const ollama = new Ollama({ host: llmConfig.ollamaUrl });
  const response = await ollama.chat({
    model: selectedModel,
    messages,
    tools: tools.map(t => ({
      type: 'function' as const,
      function: t.function,
    })),
    stream: false,
    options: { num_predict: llmConfig.maxTokens },
  });

  const content = response.message?.content || '';
  const rawCalls = response.message?.tool_calls;

  if (!Array.isArray(rawCalls) || rawCalls.length === 0) {
    return { content, toolCalls: [] };
  }

  const toolCalls: OllamaToolCall[] = rawCalls.map((call: any) => ({
    function: {
      name: call.function?.name || '',
      arguments: call.function?.arguments || {},
    },
  }));

  return { content, toolCalls };
}

export function setupLlmNamespace(ns: Namespace) {
  ns.on('connection', (socket) => {
    const userId = socket.data.user?.sub || 'unknown';
    log.info({ userId }, 'LLM client connected');

    let abortController: AbortController | null = null;

    socket.on('chat:message', async (data: { text: string; context?: any; model?: string }) => {
      // ── Input guard: block prompt injection attempts ──
      const guardResult = isPromptInjection(data.text);
      if (guardResult.blocked) {
        log.warn({ userId, reason: guardResult.reason, score: guardResult.score }, 'Chat message blocked by prompt guard');
        socket.emit('chat:blocked', {
          reason: 'Your message was flagged as a potential prompt injection attempt.',
          score: guardResult.score,
        });
        return;
      }

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
      const mcpToolPrompt = getMcpToolPrompt();

      const additionalContext = data.context ? formatChatContext(data.context) : '';
      const basePrompt = getEffectivePrompt('chat_assistant');
      const systemPromptCore = `${basePrompt}\n\n${additionalContext}\n\n${infrastructureContext}`;
      const systemPromptWithTools = `${systemPromptCore}\n\n${toolPrompt}${mcpToolPrompt}`;
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
        let plainRetryAttempted = false;
        let lastToolResults: ToolCallResult[] = [];

        let finalResponse = '';
        let toolIteration = 0;

        // ── Phase 1: Try native Ollama tool calling (non-streaming) ──
        // This only works with local Ollama (not custom endpoints).
        if (!llmConfig.customEnabled && toolsEnabled) {
          try {
            log.debug({ userId, model: selectedModel }, 'Attempting native Ollama tool calling');
            const nativeResult = await callOllamaWithNativeTools(llmConfig, selectedModel, messages);
            log.debug({ userId, toolCallCount: nativeResult.toolCalls.length, hasContent: !!nativeResult.content }, 'Native tool call result');
            if (nativeResult.toolCalls.length > 0) {
              // Native tool calls detected — execute them
              const toolNames = nativeResult.toolCalls.map(tc => tc.function.name);
              log.debug({ userId, tools: toolNames }, 'Native Ollama tool calls detected');
              socket.emit('chat:tool_call', { tools: toolNames, status: 'executing' });

              const results = await routeToolCalls(nativeResult.toolCalls);
              lastToolResults = results;

              socket.emit('chat:tool_call', {
                tools: toolNames,
                status: 'complete',
                results: results.map(r => ({ tool: r.tool, success: r.success, error: r.error })),
              });

              // Add tool context and get final streamed response.
              // Use a neutral assistant message — nativeResult.content often
              // contains "I can't run this" text that poisons the follow-up.
              // Use role: 'system' for tool results since the follow-up streaming
              // call doesn't use native tool format and small models may not
              // understand role: 'tool' outside of a native tool conversation.
              messages = [
                ...messages,
                { role: 'assistant', content: `I executed the following tools: ${toolNames.join(', ')}` },
                {
                  role: 'system',
                  content: `## Tool Execution Results\n\nThe tools have been executed successfully. Present these results to the user in a clear, helpful response.\n\n${formatToolResults(results)}`,
                },
              ];
              toolIteration++;
              // Fall through to streaming loop for final response
            } else if (nativeResult.content) {
              // No native tool calls — check if the model embedded text-based
              // tool calls in its content (models that follow system prompt
              // instructions but don't support Ollama's native tool format).
              const textToolCalls = toolsEnabled ? parseToolCalls(nativeResult.content) : null;

              if (textToolCalls) {
                log.debug({ userId, tools: textToolCalls.map(t => t.tool) }, 'Text-based tool calls found in Phase 1 content');
                socket.emit('chat:tool_call', {
                  tools: textToolCalls.map(t => t.tool),
                  status: 'executing',
                });

                const ollamaFormatCalls: OllamaToolCall[] = textToolCalls.map(tc => ({
                  function: { name: tc.tool, arguments: tc.arguments },
                }));
                const results = await routeToolCalls(ollamaFormatCalls);
                lastToolResults = results;

                socket.emit('chat:tool_call', {
                  tools: textToolCalls.map(t => t.tool),
                  status: 'complete',
                  results: results.map(r => ({ tool: r.tool, success: r.success, error: r.error })),
                });

                messages = [
                  ...messages,
                  { role: 'assistant', content: nativeResult.content },
                  {
                    role: 'system',
                    content: `## Tool Results\n\nThe following tools were executed. Use these results to answer the user's question:\n\n${formatToolResults(results)}`,
                  },
                ];
                toolIteration++;
                // Fall through to streaming loop for final response with tool results
              } else if (looksLikeToolCallAttempt(nativeResult.content)) {
                // Hallucinated tool names — fall through to Phase 2 without tools
                log.debug({ userId }, 'Phase 1 content contains hallucinated tool call JSON, falling through to Phase 2 without tools');
                toolsEnabled = false;
                messages = [
                  { role: 'system', content: systemPromptWithoutTools },
                  ...history.slice(-20),
                ];
                // Fall through to streaming loop
              } else {
                // No tool calls at all — send content as final response
                finalResponse = sanitizeLlmOutput(nativeResult.content);
                socket.emit('chat:chunk', finalResponse);
                history.push({ role: 'assistant', content: finalResponse });
                socket.emit('chat:end', { id: randomUUID(), content: finalResponse });

                const latencyMs = Date.now() - startTime;
                const promptTokens = estimateTokens(messages.map(m => m.content).join(''));
                const completionTokens = estimateTokens(finalResponse);
                try {
                  insertLlmTrace({
                    trace_id: randomUUID(), session_id: socket.id, model: selectedModel,
                    prompt_tokens: promptTokens, completion_tokens: completionTokens,
                    total_tokens: promptTokens + completionTokens, latency_ms: latencyMs,
                    status: 'success', user_query: data.text.slice(0, 500),
                    response_preview: finalResponse.slice(0, 500),
                  });
                } catch (traceErr) { log.warn({ err: traceErr }, 'Failed to record LLM trace'); }
                return; // Done — skip streaming loop
              }
            }
          } catch (nativeErr) {
            log.warn({ err: nativeErr, userId, message: nativeErr instanceof Error ? nativeErr.message : String(nativeErr) }, 'Native Ollama tool calling failed, falling back to text-based');
            // Fall through to text-based streaming
          }
        }

        // ── Phase 2: Text-based streaming with tool call parsing (fallback) ──
        // Tool calling loop: stream response, check for tool calls, execute, repeat.
        // Every iteration streams chunks to the client. If tool calls are detected,
        // we emit chat:tool_response_pending to clear the streamed tool-call JSON,
        // then the next iteration streams the follow-up response progressively.
        while (toolIteration < llmConfig.maxToolIterations) {
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
              if (!llmConfig.customEnabled) {
                iterationResponse = await streamOllamaRawCall(
                  llmConfig,
                  selectedModel,
                  messages,
                  (text) => {
                    socket.emit('chat:chunk', text);
                  },
                  abortController.signal,
                );
                // Continue regular flow: parse tool calls or finalize natural response.
              } else {
                toolsEnabled = false;
                messages = [
                  { role: 'system', content: systemPromptWithoutTools },
                  ...history.slice(-20),
                ];
                continue;
              }
            }
            else {
              throw streamErr;
            }
          }

          if (abortController.signal.aborted) break;

          // Check if the response contains tool calls
          const toolCalls = toolsEnabled ? parseToolCalls(iterationResponse) : null;

          if (!toolCalls) {
            const failedToolAttempt = looksLikeToolCallAttempt(iterationResponse);
            if ((!iterationResponse.trim() || failedToolAttempt) && !plainRetryAttempted) {
              plainRetryAttempted = true;
              toolsEnabled = false;
              if (failedToolAttempt) {
                // Clear the raw JSON that was already streamed to the frontend
                socket.emit('chat:tool_response_pending');
              }
              messages = [
                { role: 'system', content: systemPromptWithoutTools },
                ...history.slice(-20),
              ];
              continue;
            }
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

          // Convert to OllamaToolCall format for proper MCP routing
          const ollamaFormatCalls: OllamaToolCall[] = toolCalls.map(tc => ({
            function: { name: tc.tool, arguments: tc.arguments },
          }));
          const results = await routeToolCalls(ollamaFormatCalls);
          lastToolResults = results;

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

        if (!finalResponse && toolIteration >= llmConfig.maxToolIterations) {
          // Graceful degradation: ask the LLM to summarize whatever tool
          // results have been accumulated so far instead of a hard error.
          log.info({ userId, toolIteration, maxIterations: llmConfig.maxToolIterations }, 'Tool iteration limit reached, generating partial summary');
          try {
            const summaryMessages: ChatMessage[] = [
              ...messages,
              {
                role: 'system',
                content: 'You have run out of tool calls. Summarize the information you have gathered so far into a clear, helpful answer for the user. Do not attempt any more tool calls. Do not output tool_calls JSON.',
              },
            ];
            finalResponse = await streamLlmCall(
              llmConfig,
              selectedModel,
              summaryMessages,
              (text) => { socket.emit('chat:chunk', text); },
              abortController.signal,
            );
          } catch (summaryErr) {
            log.warn({ err: summaryErr, userId }, 'Failed to generate partial summary after tool limit');
            if (lastToolResults.length > 0) {
              finalResponse = `Here is the raw data I was able to gather:\n\n${formatToolResults(lastToolResults)}`;
            } else {
              finalResponse = 'I was unable to complete the request within the allowed number of tool calls. Please try a more specific question.';
            }
            socket.emit('chat:chunk', finalResponse);
          }
          // Append a visible notice so the user knows the response was truncated
          const limitNotice = `\n\n---\n*This response was truncated because the tool call limit (${llmConfig.maxToolIterations}) was reached. You can increase \`LLM_MAX_TOOL_ITERATIONS\` in your environment configuration to allow more tool calls per question.*`;
          finalResponse += limitNotice;
          socket.emit('chat:chunk', limitNotice);
        }
        if (!finalResponse.trim()) {
          if (lastToolResults.length > 0) {
            finalResponse = `I could not generate a complete natural-language summary, but I retrieved live results:\n\n${formatToolResults(lastToolResults)}`;
          } else {
            finalResponse = 'I could not generate a complete response for that request. Please try again.';
          }
        }

        // Sanitize final output before sending
        finalResponse = sanitizeLlmOutput(finalResponse);

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
        // Translate cryptic ByteString error (non-Latin1 characters in HTTP headers/responses)
        let errorMessage = err instanceof Error ? err.message : 'LLM unavailable';
        if (err instanceof Error && /bytestring/i.test(err.message)) {
          errorMessage = 'LLM endpoint returned invalid characters. Check that the API URL points to a valid OpenAI-compatible endpoint (not a web UI page), and that the API token does not contain special characters.';
        }
        log.error({ err, userId }, 'LLM chat error');
        socket.emit('chat:error', { message: errorMessage });

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
