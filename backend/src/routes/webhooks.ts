import { FastifyInstance } from 'fastify';
import {
  createWebhook,
  listWebhooks,
  getWebhookById,
  updateWebhook,
  deleteWebhook,
  getDeliveriesForWebhook,
  signPayload,
  type Webhook,
} from '../services/webhook-service.js';
import { emitEvent } from '../services/event-bus.js';
import { onEvent, type WebhookEvent } from '../services/event-bus.js';
import { validateOutboundWebhookUrl } from '../utils/network-security.js';

const VALID_EVENT_TYPES = [
  'insight.created',
  'anomaly.detected',
  'container.state_change',
  'remediation.requested',
  'remediation.approved',
  'remediation.rejected',
  'remediation.completed',
  '*',
];

function sanitizeWebhook(webhook: Webhook) {
  return {
    ...webhook,
    secret: webhook.secret.slice(0, 8) + '...',
    events: JSON.parse(webhook.events),
  };
}

export async function webhookRoutes(fastify: FastifyInstance) {
  // List all webhooks
  fastify.get('/api/webhooks', {
    schema: {
      tags: ['Webhooks'],
      summary: 'List all configured webhooks',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async () => {
    const webhooks = listWebhooks();
    return webhooks.map(sanitizeWebhook);
  });

  // Create a webhook
  fastify.post('/api/webhooks', {
    schema: {
      tags: ['Webhooks'],
      summary: 'Create a new webhook',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['name', 'url', 'events'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          url: { type: 'string', format: 'uri' },
          secret: { type: 'string' },
          events: { type: 'array', items: { type: 'string' }, minItems: 1 },
          enabled: { type: 'boolean' },
          description: { type: 'string', maxLength: 500 },
        },
      },
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const body = request.body as {
      name: string;
      url: string;
      secret?: string;
      events: string[];
      enabled?: boolean;
      description?: string;
    };

    // Validate event types
    for (const evt of body.events) {
      if (!VALID_EVENT_TYPES.includes(evt) && !evt.endsWith('.*')) {
        return reply.status(400).send({ error: `Invalid event type: ${evt}` });
      }
    }
    const urlValidationError = validateOutboundWebhookUrl(body.url);
    if (urlValidationError) {
      return reply.status(400).send({ error: urlValidationError });
    }

    const webhook = createWebhook(body);
    return reply.status(201).send(sanitizeWebhook(webhook));
  });

  // Get a single webhook
  fastify.get('/api/webhooks/:id', {
    schema: {
      tags: ['Webhooks'],
      summary: 'Get webhook details',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const webhook = getWebhookById(id);
    if (!webhook) return reply.status(404).send({ error: 'Webhook not found' });
    return sanitizeWebhook(webhook);
  });

  // Update a webhook
  fastify.patch('/api/webhooks/:id', {
    schema: {
      tags: ['Webhooks'],
      summary: 'Update a webhook',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          url: { type: 'string', format: 'uri' },
          secret: { type: 'string' },
          events: { type: 'array', items: { type: 'string' }, minItems: 1 },
          enabled: { type: 'boolean' },
          description: { type: 'string', maxLength: 500 },
        },
      },
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      name?: string;
      url?: string;
      secret?: string;
      events?: string[];
      enabled?: boolean;
      description?: string;
    };

    if (body.events) {
      for (const evt of body.events) {
        if (!VALID_EVENT_TYPES.includes(evt) && !evt.endsWith('.*')) {
          return reply.status(400).send({ error: `Invalid event type: ${evt}` });
        }
      }
    }
    if (body.url) {
      const urlValidationError = validateOutboundWebhookUrl(body.url);
      if (urlValidationError) {
        return reply.status(400).send({ error: urlValidationError });
      }
    }

    const webhook = updateWebhook(id, body);
    if (!webhook) return reply.status(404).send({ error: 'Webhook not found' });
    return sanitizeWebhook(webhook);
  });

  // Delete a webhook
  fastify.delete('/api/webhooks/:id', {
    schema: {
      tags: ['Webhooks'],
      summary: 'Delete a webhook',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = deleteWebhook(id);
    if (!deleted) return reply.status(404).send({ error: 'Webhook not found' });
    return { success: true };
  });

  // Get delivery history for a webhook
  fastify.get('/api/webhooks/:id/deliveries', {
    schema: {
      tags: ['Webhooks'],
      summary: 'Get webhook delivery history',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'number', default: 50 },
          offset: { type: 'number', default: 0 },
        },
      },
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { limit = 50, offset = 0 } = request.query as { limit?: number; offset?: number };

    const webhook = getWebhookById(id);
    if (!webhook) return reply.status(404).send({ error: 'Webhook not found' });

    return getDeliveriesForWebhook(id, limit, offset);
  });

  // Send a test event to a webhook
  fastify.post('/api/webhooks/:id/test', {
    schema: {
      tags: ['Webhooks'],
      summary: 'Send a test event to a webhook',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    preHandler: [fastify.authenticate, fastify.requireRole('admin')],
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const webhook = getWebhookById(id);
    if (!webhook) return reply.status(404).send({ error: 'Webhook not found' });
    const urlValidationError = validateOutboundWebhookUrl(webhook.url);
    if (urlValidationError) {
      return reply.status(400).send({ error: urlValidationError });
    }

    const testPayload = JSON.stringify({
      type: 'webhook.test',
      timestamp: new Date().toISOString(),
      data: {
        message: 'This is a test event from AI Portainer Dashboard',
        webhookId: id,
        webhookName: webhook.name,
      },
    });

    const signature = signPayload(testPayload, webhook.secret);

    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': `sha256=${signature}`,
          'X-Webhook-Event': 'webhook.test',
          'X-Webhook-Delivery': crypto.randomUUID(),
          'User-Agent': 'AI-Portainer-Dashboard/1.0',
        },
        body: testPayload,
        signal: AbortSignal.timeout(10000),
      });

      const body = await response.text().catch(() => '');

      return {
        success: response.ok,
        httpStatus: response.status,
        responseBody: body.slice(0, 500),
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  // SSE event stream
  fastify.get('/api/events/stream', {
    schema: {
      tags: ['Events'],
      summary: 'Server-Sent Events stream of dashboard events',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    reply.raw.write(':ok\n\n');

    const handler = (event: WebhookEvent) => {
      reply.raw.write(`event: ${event.type}\n`);
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const unsubscribe = onEvent(handler);

    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      reply.raw.write(':heartbeat\n\n');
    }, 30000);

    request.raw.on('close', () => {
      unsubscribe();
      clearInterval(heartbeat);
    });
  });

  // Get available event types
  fastify.get('/api/webhooks/event-types', {
    schema: {
      tags: ['Webhooks'],
      summary: 'List available webhook event types',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [fastify.authenticate],
  }, async () => {
    return VALID_EVENT_TYPES.map((type) => ({
      type,
      description: getEventTypeDescription(type),
    }));
  });
}

function getEventTypeDescription(type: string): string {
  const descriptions: Record<string, string> = {
    'insight.created': 'A new monitoring insight was generated',
    'anomaly.detected': 'An anomaly was detected in container metrics',
    'container.state_change': 'A container changed state (started, stopped, etc.)',
    'remediation.requested': 'A remediation action was requested',
    'remediation.approved': 'A remediation action was approved',
    'remediation.rejected': 'A remediation action was rejected',
    'remediation.completed': 'A remediation action was completed',
    '*': 'All events',
  };
  return descriptions[type] || type;
}
