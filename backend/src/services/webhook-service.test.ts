import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signPayload } from './webhook-service.js';

// In-memory store for the mock DB
const webhookStore: Map<string, Record<string, unknown>> = new Map();
const deliveryStore: Map<string, Record<string, unknown>> = new Map();

vi.mock('../db/app-db-router.js', () => {
  const mockDb = {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('INSERT INTO webhooks')) {
        const row = {
          id: params[0],
          name: params[1],
          url: params[2],
          secret: params[3],
          events: params[4],
          enabled: params[5],
          description: params[6],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        webhookStore.set(row.id as string, row);
        return { changes: 1 };
      }
      if (sql.includes('INSERT INTO webhook_deliveries')) {
        const row = {
          id: params[0],
          webhook_id: params[1],
          event_type: params[2],
          payload: params[3],
          status: 'pending',
          attempt: 0,
          max_attempts: 5,
          created_at: new Date().toISOString(),
        };
        deliveryStore.set(row.id as string, row);
        return { changes: 1 };
      }
      if (sql.includes('DELETE FROM webhooks')) {
        const deleted = webhookStore.delete(params[0] as string);
        return { changes: deleted ? 1 : 0 };
      }
      if (sql.includes('UPDATE webhooks')) {
        return { changes: 1 };
      }
      return { changes: 0 };
    }),
    queryOne: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM webhooks WHERE id')) {
        return webhookStore.get(params[0] as string) ?? null;
      }
      if (sql.includes('COUNT(*)')) {
        return { count: deliveryStore.size };
      }
      return null;
    }),
    query: vi.fn(async (sql: string) => {
      if (sql.includes('FROM webhooks')) return [...webhookStore.values()];
      if (sql.includes('FROM webhook_deliveries')) return [...deliveryStore.values()];
      return [];
    }),
  };
  return { getDbForDomain: vi.fn(() => mockDb) };
});

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('./event-bus.js', () => ({
  onEvent: vi.fn(() => vi.fn()),
  emitEvent: vi.fn(),
}));

import {
  createWebhook,
  listWebhooks,
  deleteWebhook,
  createDelivery,
  startWebhookListener,
  stopWebhookListener,
} from './webhook-service.js';

describe('webhook-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    webhookStore.clear();
    deliveryStore.clear();
  });

  describe('signPayload', () => {
    it('should produce a deterministic HMAC-SHA256 signature', () => {
      const payload = '{"type":"test"}';
      const secret = 'my-secret';
      const sig1 = signPayload(payload, secret);
      const sig2 = signPayload(payload, secret);
      expect(sig1).toBe(sig2);
      expect(sig1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should produce different signatures for different secrets', () => {
      const payload = '{"type":"test"}';
      const sig1 = signPayload(payload, 'secret-a');
      const sig2 = signPayload(payload, 'secret-b');
      expect(sig1).not.toBe(sig2);
    });
  });

  describe('createWebhook', () => {
    it('should create a webhook with generated secret', async () => {
      const webhook = await createWebhook({
        name: 'Test Webhook',
        url: 'https://example.com/hook',
        events: ['insight.created'],
      });

      expect(webhook).toBeDefined();
      expect(webhook.name).toBe('Test Webhook');
      expect(webhook.url).toBe('https://example.com/hook');
      expect(webhook.secret).toBeTruthy();
    });

    it('should create a webhook with custom secret', async () => {
      const webhook = await createWebhook({
        name: 'Custom Secret',
        url: 'https://example.com/hook',
        events: ['*'],
        secret: 'my-custom-secret',
      });

      expect(webhook).toBeDefined();
      expect(webhook.secret).toBe('my-custom-secret');
    });
  });

  describe('listWebhooks', () => {
    it('should return all webhooks', async () => {
      await createWebhook({ name: 'Hook 1', url: 'https://a.com/h', events: ['*'] });
      await createWebhook({ name: 'Hook 2', url: 'https://b.com/h', events: ['*'] });

      const webhooks = await listWebhooks();
      expect(webhooks).toHaveLength(2);
    });
  });

  describe('deleteWebhook', () => {
    it('should delete an existing webhook', async () => {
      const webhook = await createWebhook({ name: 'To Delete', url: 'https://x.com/h', events: ['*'] });
      const result = await deleteWebhook(webhook.id);
      expect(result).toBe(true);
    });

    it('should return false for non-existent webhook', async () => {
      const result = await deleteWebhook('non-existent-id');
      expect(result).toBe(false);
    });
  });

  describe('createDelivery', () => {
    it('should create a delivery record', async () => {
      const webhook = await createWebhook({ name: 'Delivery Test', url: 'https://x.com/h', events: ['*'] });
      const event = { type: 'insight.created', timestamp: new Date().toISOString(), data: { test: true } };
      const deliveryId = await createDelivery(webhook.id, event);
      expect(deliveryId).toBeTruthy();
      expect(typeof deliveryId).toBe('string');
    });
  });

  describe('startWebhookListener / stopWebhookListener', () => {
    it('should start and stop without errors', () => {
      expect(() => startWebhookListener()).not.toThrow();
      expect(() => stopWebhookListener()).not.toThrow();
    });
  });
});
