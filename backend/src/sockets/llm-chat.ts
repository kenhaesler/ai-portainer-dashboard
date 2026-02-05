import { Namespace } from 'socket.io';
import { createChildLogger } from '../utils/logger.js';
import { getConfig } from '../config/index.js';
import { Ollama } from 'ollama';
import * as portainer from '../services/portainer-client.js';
import { normalizeEndpoint, normalizeContainer } from '../services/portainer-normalizers.js';
import { cachedFetch, getCacheKey, TTL } from '../services/portainer-cache.js';
import { getDb } from '../db/sqlite.js';
import { randomUUID } from 'crypto';

const log = createChildLogger('socket:llm');

function getAuthHeaders(): Record<string, string> {
  const config = getConfig();
  const token = config.OLLAMA_BEARER_TOKEN;

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
        allContainers.push(...containers.map(c => normalizeContainer(c, ep)));
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
    const stoppedContainers = allContainers.filter(c => c.state === 'stopped' || c.state === 'exited');
    const unhealthyContainers = allContainers.filter(c =>
      c.state === 'dead' || c.state === 'paused' || c.state === 'restarting'
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
      .map(c => `- ${c.name} (${c.image}): ${c.state}, CPU: ${c.cpuUsage?.toFixed(1) || 'N/A'}%, Mem: ${c.memoryUsage?.toFixed(1) || 'N/A'}% on ${c.endpointName}`)
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
- Historical insights and detected issues
- Container logs, metrics, and health checks

When answering questions:
1. Reference specific containers, endpoints, or stacks by name
2. Analyze patterns across the infrastructure
3. Provide actionable recommendations based on current state
4. Explain the reasoning behind your suggestions
5. Warn about potential risks or side effects

Use markdown formatting for clarity. For code blocks, use proper language tags.`;

  } catch (err) {
    log.error({ err }, 'Failed to build infrastructure context');
    return '## Infrastructure Context Unavailable\n\nUnable to fetch current infrastructure data. Operating with limited context.';
  }
}

export function setupLlmNamespace(ns: Namespace) {
  ns.on('connection', (socket) => {
    const userId = socket.data.user?.sub || 'unknown';
    log.info({ userId }, 'LLM client connected');

    let abortController: AbortController | null = null;

    socket.on('chat:message', async (data: { text: string; context?: any }) => {
      const config = getConfig();

      // Get or create session history
      if (!sessions.has(socket.id)) {
        sessions.set(socket.id, []);
      }
      const history = sessions.get(socket.id)!;

      // Build infrastructure context
      const infrastructureContext = await buildInfrastructureContext();

      // Build system prompt with infrastructure context
      const systemPrompt = `You are an AI assistant specializing in Docker container infrastructure management, deeply integrated with this Portainer dashboard.

${infrastructureContext}

${data.context ? `\n## Additional Context\n${JSON.stringify(data.context, null, 2)}` : ''}

Provide concise, actionable responses. Use markdown formatting for code blocks and lists. When suggesting actions, explain the reasoning and potential impact.`;

      history.push({ role: 'user', content: data.text });

      const messages = [
        { role: 'system' as const, content: systemPrompt },
        ...history.slice(-20), // Keep last 20 messages
      ];

      try {
        abortController = new AbortController();
        socket.emit('chat:start');

        let fullResponse = '';

        // Use authenticated fetch if API endpoint and token are configured
        if (config.OLLAMA_API_ENDPOINT && config.OLLAMA_BEARER_TOKEN) {
          const response = await fetch(config.OLLAMA_API_ENDPOINT, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...getAuthHeaders(),
            },
            body: JSON.stringify({
              model: config.OLLAMA_MODEL,
              messages,
              stream: true,
            }),
            signal: abortController.signal,
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
            if (abortController?.signal.aborted) break;

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
                  socket.emit('chat:chunk', text);
                }
              } catch {
                // Skip invalid JSON lines
              }
            }
          }
        } else {
          // Use Ollama SDK for local/unauthenticated access
          const ollama = new Ollama({ host: config.OLLAMA_BASE_URL });
          const response = await ollama.chat({
            model: config.OLLAMA_MODEL,
            messages,
            stream: true,
          });

          for await (const chunk of response) {
            if (abortController?.signal.aborted) break;
            const text = chunk.message?.content || '';
            fullResponse += text;
            socket.emit('chat:chunk', text);
          }
        }

        history.push({ role: 'assistant', content: fullResponse });

        // Emit with correct format: { id, content }
        socket.emit('chat:end', {
          id: randomUUID(),
          content: fullResponse
        });

        log.debug({ userId, messageLength: data.text.length, responseLength: fullResponse.length }, 'LLM chat completed');
      } catch (err) {
        log.error({ err, userId }, 'LLM chat error');
        socket.emit('chat:error', {
          error: err instanceof Error ? err.message : 'LLM unavailable',
        });
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
