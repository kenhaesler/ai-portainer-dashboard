import { FastifyInstance } from 'fastify';
import { getConfig } from '../config/index.js';
import { Ollama } from 'ollama';
import { createChildLogger } from '../utils/logger.js';
import * as portainer from '../services/portainer-client.js';
import { normalizeEndpoint, normalizeContainer } from '../services/portainer-normalizers.js';
import { cachedFetch, getCacheKey, TTL } from '../services/portainer-cache.js';

const log = createChildLogger('route:llm');

const QUERY_SYSTEM_PROMPT = `You are a dashboard query interpreter. The user asks natural language questions about their Docker infrastructure. You MUST respond with ONLY valid JSON — no markdown, no explanation, no code fences.

Available pages and their routes:
- "/" - Home dashboard with KPIs
- "/workloads" - Workload Explorer: all containers, filterable by state, name, image
- "/fleet" - Fleet Overview: all endpoints/environments
- "/health" - Container Health: health checks, unhealthy containers
- "/images" - Image Footprint: Docker images, sizes, registries
- "/topology" - Network Topology: container network connections
- "/ai-monitor" - AI Monitor: AI-generated insights, anomalies
- "/metrics" - Metrics Dashboard: CPU, memory, network metrics over time
- "/remediation" - Remediation: suggested and pending remediation actions
- "/traces" - Trace Explorer: distributed traces
- "/assistant" - LLM Assistant: AI chat for infrastructure questions
- "/edge-logs" - Edge Agent Logs
- "/settings" - Settings

Response format — choose ONE:

For navigation actions:
{"action":"navigate","page":"/route","description":"Brief explanation of where to look"}

For inline answers (simple factual questions):
{"action":"answer","text":"The answer text","description":"Based on current infrastructure data"}

INFRASTRUCTURE CONTEXT:
`;

function getAuthHeaders(): Record<string, string> {
  const config = getConfig();
  const token = config.OLLAMA_BEARER_TOKEN;
  if (!token) return {};
  if (token.includes(':')) {
    return { 'Authorization': `Basic ${Buffer.from(token).toString('base64')}` };
  }
  return { 'Authorization': `Bearer ${token}` };
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
      body: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', minLength: 2 },
        },
      },
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const config = getConfig();
    const { query } = request.body;

    try {
      const infraContext = await getInfrastructureSummary();
      const systemPrompt = QUERY_SYSTEM_PROMPT + infraContext;

      const messages = [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: query },
      ];

      let fullResponse = '';

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
        const ollama = new Ollama({ host: config.OLLAMA_BASE_URL });
        const response = await ollama.chat({
          model: config.OLLAMA_MODEL,
          messages,
          stream: false,
          format: 'json',
        });
        fullResponse = response.message?.content || '';
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
          text: parsed.text,
          description: parsed.description || '',
        };
      }

      // Fallback: treat as answer
      return {
        action: 'answer',
        text: fullResponse,
        description: 'Raw LLM response',
      };
    } catch (err) {
      log.error({ err, query }, 'LLM query failed');
      return {
        action: 'error',
        text: 'AI queries are currently unavailable. Try searching by name instead.',
      };
    }
  });

  // List available models
  fastify.get('/api/llm/models', {
    schema: {
      tags: ['LLM'],
      summary: 'List available LLM models from Ollama',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async () => {
    const config = getConfig();

    try {
      // If using custom API endpoint, try OpenAI-compatible /v1/models
      if (config.OLLAMA_API_ENDPOINT && config.OLLAMA_BEARER_TOKEN) {
        const baseUrl = new URL(config.OLLAMA_API_ENDPOINT);
        const modelsUrl = `${baseUrl.origin}/v1/models`;

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        };

        const response = await fetch(modelsUrl, { headers });
        if (response.ok) {
          const data = await response.json() as { data?: Array<{ id: string }> };
          return {
            models: (data.data ?? []).map((m: { id: string }) => ({
              name: m.id,
            })),
            default: config.OLLAMA_MODEL,
          };
        }
      }

      // Default: use Ollama SDK
      const ollama = new Ollama({ host: config.OLLAMA_BASE_URL });
      const response = await ollama.list();
      return {
        models: response.models.map((m) => ({
          name: m.name,
          size: m.size,
          modified: m.modified_at,
        })),
        default: config.OLLAMA_MODEL,
      };
    } catch (err) {
      log.error({ err }, 'Failed to fetch models');
      // Return at least the configured default
      return {
        models: [{ name: config.OLLAMA_MODEL }],
        default: config.OLLAMA_MODEL,
      };
    }
  });
}
