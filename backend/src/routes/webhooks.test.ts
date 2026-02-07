import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { webhookRoutes } from './webhooks.js';

vi.mock('../services/webhook-service.js', () => ({
  createWebhook: vi.fn(),
  listWebhooks: vi.fn(),
  getWebhookById: vi.fn(),
  updateWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
  getDeliveriesForWebhook: vi.fn(),
  signPayload: vi.fn(() => 'mockedsignature'),
}));

vi.mock('../services/event-bus.js', () => ({
  onEvent: vi.fn(() => vi.fn()),
  emitEvent: vi.fn(),
}));

import {
  createWebhook,
  listWebhooks,
  getWebhookById,
  updateWebhook,
  deleteWebhook,
  getDeliveriesForWebhook,
} from '../services/webhook-service.js';

const mockCreateWebhook = vi.mocked(createWebhook);
const mockListWebhooks = vi.mocked(listWebhooks);
const mockGetWebhookById = vi.mocked(getWebhookById);
const mockUpdateWebhook = vi.mocked(updateWebhook);
const mockDeleteWebhook = vi.mocked(deleteWebhook);
const mockGetDeliveries = vi.mocked(getDeliveriesForWebhook);

async function buildTestApp() {
  let currentRole: 'viewer' | 'operator' | 'admin' = 'admin';
  const app = Fastify();
  app.decorate('authenticate', async () => undefined);
  app.decorate('requireRole', (minRole: 'viewer' | 'operator' | 'admin') => async (request, reply) => {
    const rank = { viewer: 0, operator: 1, admin: 2 };
    const userRole = request.user?.role ?? 'viewer';
    if (rank[userRole] < rank[minRole]) {
      reply.code(403).send({ error: 'Insufficient permissions' });
    }
  });
  app.decorateRequest('user', undefined);
  app.addHook('preHandler', async (request) => {
    request.user = {
      sub: 'user-1',
      username: 'tester',
      sessionId: 'session-1',
      role: currentRole,
    };
  });
  await app.register(webhookRoutes);
  return {
    app,
    setRole: (role: 'viewer' | 'operator' | 'admin') => {
      currentRole = role;
    },
  };
}

describe('webhookRoutes', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>['app'];
  let setRole: Awaited<ReturnType<typeof buildTestApp>>['setRole'];

  beforeEach(async () => {
    vi.clearAllMocks();
    const built = await buildTestApp();
    app = built.app;
    setRole = built.setRole;
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /api/webhooks', () => {
    it('should list webhooks with masked secrets', async () => {
      mockListWebhooks.mockReturnValue([
        {
          id: 'wh-1',
          name: 'Test Hook',
          url: 'https://example.com/hook',
          secret: 'abcdefghijklmnop1234567890',
          events: '["insight.created"]',
          enabled: 1,
          description: null,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
      ]);

      const res = await app.inject({ method: 'GET', url: '/api/webhooks' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe('Test Hook');
      expect(body[0].secret).toBe('abcdefgh...');
      expect(body[0].events).toEqual(['insight.created']);
    });
  });

  describe('POST /api/webhooks', () => {
    it('should create a webhook', async () => {
      mockCreateWebhook.mockReturnValue({
        id: 'wh-new',
        name: 'New Hook',
        url: 'https://example.com/hook',
        secret: '1234567890abcdef',
        events: '["*"]',
        enabled: 1,
        description: null,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          name: 'New Hook',
          url: 'https://example.com/hook',
          events: ['*'],
        },
      });
      expect(res.statusCode).toBe(201);
      expect(mockCreateWebhook).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New Hook', url: 'https://example.com/hook' }),
      );
    });

    it('should reject invalid event types', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          name: 'Bad Hook',
          url: 'https://example.com/hook',
          events: ['invalid.event.type'],
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('should reject non-admin users', async () => {
      setRole('viewer');

      const res = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: {
          name: 'New Hook',
          url: 'https://example.com/hook',
          events: ['*'],
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'Insufficient permissions' });
    });
  });

  describe('GET /api/webhooks/:id', () => {
    it('should return 404 for non-existent webhook', async () => {
      mockGetWebhookById.mockReturnValue(undefined);

      const res = await app.inject({ method: 'GET', url: '/api/webhooks/non-existent' });
      expect(res.statusCode).toBe(404);
    });

    it('should return webhook details', async () => {
      mockGetWebhookById.mockReturnValue({
        id: 'wh-1',
        name: 'Test',
        url: 'https://example.com/hook',
        secret: 'secretvalue123456',
        events: '["insight.created"]',
        enabled: 1,
        description: 'Test webhook',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      });

      const res = await app.inject({ method: 'GET', url: '/api/webhooks/wh-1' });
      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe('Test');
    });
  });

  describe('PATCH /api/webhooks/:id', () => {
    it('should update a webhook', async () => {
      mockUpdateWebhook.mockReturnValue({
        id: 'wh-1',
        name: 'Updated',
        url: 'https://example.com/hook',
        secret: 'secretvalue123456',
        events: '["*"]',
        enabled: 1,
        description: null,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      });

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/webhooks/wh-1',
        payload: { name: 'Updated' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().name).toBe('Updated');
    });

    it('should return 404 for non-existent webhook', async () => {
      mockUpdateWebhook.mockReturnValue(undefined);

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/webhooks/non-existent',
        payload: { name: 'Updated' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('should reject non-admin users', async () => {
      setRole('viewer');
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/webhooks/wh-1',
        payload: { name: 'Updated' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'Insufficient permissions' });
    });
  });

  describe('DELETE /api/webhooks/:id', () => {
    it('should delete a webhook', async () => {
      mockDeleteWebhook.mockReturnValue(true);

      const res = await app.inject({ method: 'DELETE', url: '/api/webhooks/wh-1' });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });

    it('should return 404 for non-existent webhook', async () => {
      mockDeleteWebhook.mockReturnValue(false);

      const res = await app.inject({ method: 'DELETE', url: '/api/webhooks/non-existent' });
      expect(res.statusCode).toBe(404);
    });

    it('should reject non-admin users', async () => {
      setRole('viewer');
      const res = await app.inject({ method: 'DELETE', url: '/api/webhooks/wh-1' });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'Insufficient permissions' });
    });
  });

  describe('POST /api/webhooks/:id/test', () => {
    it('should reject non-admin users', async () => {
      setRole('viewer');
      const res = await app.inject({ method: 'POST', url: '/api/webhooks/wh-1/test' });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'Insufficient permissions' });
    });
  });

  describe('GET /api/webhooks/:id/deliveries', () => {
    it('should return delivery history', async () => {
      mockGetWebhookById.mockReturnValue({
        id: 'wh-1',
        name: 'Test',
        url: 'https://example.com/hook',
        secret: 'secret',
        events: '["*"]',
        enabled: 1,
        description: null,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      });

      mockGetDeliveries.mockReturnValue({
        deliveries: [
          {
            id: 'del-1',
            webhook_id: 'wh-1',
            event_type: 'insight.created',
            payload: '{}',
            status: 'delivered',
            http_status: 200,
            response_body: null,
            attempt: 1,
            max_attempts: 5,
            next_retry_at: null,
            delivered_at: '2025-01-01T00:00:00Z',
            created_at: '2025-01-01T00:00:00Z',
          },
        ],
        total: 1,
      });

      const res = await app.inject({ method: 'GET', url: '/api/webhooks/wh-1/deliveries' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.deliveries).toHaveLength(1);
      expect(body.total).toBe(1);
    });
  });

  describe('GET /api/webhooks/event-types', () => {
    it('should list available event types', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/webhooks/event-types' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.length).toBeGreaterThan(0);
      expect(body[0]).toHaveProperty('type');
      expect(body[0]).toHaveProperty('description');
    });
  });
});
