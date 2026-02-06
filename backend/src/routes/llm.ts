import { FastifyInstance } from 'fastify';
import { getConfig } from '../config/index.js';
import { Ollama } from 'ollama';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('route:llm');

export async function llmRoutes(fastify: FastifyInstance) {
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
        };

        const token = config.OLLAMA_BEARER_TOKEN;
        if (token.includes(':')) {
          headers['Authorization'] = `Basic ${Buffer.from(token).toString('base64')}`;
        } else {
          headers['Authorization'] = `Bearer ${token}`;
        }

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
