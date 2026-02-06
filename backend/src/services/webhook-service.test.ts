import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signPayload } from './webhook-service.js';

// In-memory store for the mock DB
const webhookStore: Map<string, Record<string, unknown>> = new Map();
const deliveryStore: Map<string, Record<string, unknown>> = new Map();

vi.mock('../db/sqlite.js', () => {
  const mockDb = {
    prepare: vi.fn((sql: string) => ({
      run: vi.fn((...args: unknown[]) => {
        if (sql.includes('INSERT INTO webhooks')) {
          const row = {
            id: args[0],
            name: args[1],
            url: args[2],
            secret: args[3],
            events: args[4],
            enabled: args[5],
            description: args[6],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          webhookStore.set(row.id as string, row);
          return { changes: 1 };
        }
        if (sql.includes('INSERT INTO webhook_deliveries')) {
          const row = {
            id: args[0],
            webhook_id: args[1],
            event_type: args[2],
            payload: args[3],
            status: 'pending',
            attempt: 0,
            max_attempts: 5,
            created_at: new Date().toISOString(),
          };
          deliveryStore.set(row.id as string, row);
          return { changes: 1 };
        }
        if (sql.includes('DELETE FROM webhooks')) {
          const deleted = webhookStore.delete(args[0] as string);
          return { changes: deleted ? 1 : 0 };
        }
        if (sql.includes('UPDATE webhooks')) {
          return { changes: 1 };
        }
        return { changes: 0 };
      }),
      get: vi.fn((...args: unknown[]) => {
        if (sql.includes('FROM webhooks WHERE id')) {
          return webhookStore.get(args[0] as string) ?? undefined;
        }
        if (sql.includes('COUNT(*)')) {
          return { count: deliveryStore.size };
        }
        return undefined;
      }),
      all: vi.fn(() => {
        if (sql.includes('FROM webhooks')) return [...webhookStore.values()];
        if (sql.includes('FROM webhook_deliveries')) return [...deliveryStore.values()];
        return [];
      }),
    })),
  };
  return { getDb: vi.fn(() => mockDb) };
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
    it('should create a webhook with generated secret', () => {
      const webhook = createWebhook({
        name: 'Test Webhook',
        url: 'https://example.com/hook',
        events: ['insight.created'],
      });

      expect(webhook).toBeDefined();
      expect(webhook.name).toBe('Test Webhook');
      expect(webhook.url).toBe('https://example.com/hook');
      expect(webhook.secret).toBeTruthy();
    });

    it('should create a webhook with custom secret', () => {
      const webhook = createWebhook({
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
    it('should return all webhooks', () => {
      createWebhook({ name: 'Hook 1', url: 'https://a.com/h', events: ['*'] });
      createWebhook({ name: 'Hook 2', url: 'https://b.com/h', events: ['*'] });

      const webhooks = listWebhooks();
      expect(webhooks).toHaveLength(2);
    });
  });

  describe('deleteWebhook', () => {
    it('should delete an existing webhook', () => {
      const webhook = createWebhook({ name: 'To Delete', url: 'https://x.com/h', events: ['*'] });
      const result = deleteWebhook(webhook.id);
      expect(result).toBe(true);
    });

    it('should return false for non-existent webhook', () => {
      const result = deleteWebhook('non-existent-id');
      expect(result).toBe(false);
    });
  });

  describe('createDelivery', () => {
    it('should create a delivery record', () => {
      const webhook = createWebhook({ name: 'Delivery Test', url: 'https://x.com/h', events: ['*'] });
      const event = { type: 'insight.created', timestamp: new Date().toISOString(), data: { test: true } };
      const deliveryId = createDelivery(webhook.id, event);
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
