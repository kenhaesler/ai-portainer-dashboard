import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { getTestDb, truncateTestTables, closeTestDb } from '../../../core/db/test-db-helper.js';
import type { AppDb } from '../../../core/db/app-db.js';

let testDb: AppDb;

// Kept: app-db-router mock — redirects to test PostgreSQL instance
vi.mock('../../../core/db/app-db-router.js', () => ({
  getDbForDomain: () => testDb,
}));

// Kept: event-bus mock — side-effect isolation
vi.mock('../../../core/services/event-bus.js', () => ({
  onEvent: vi.fn(() => vi.fn()),
  emitEvent: vi.fn(),
}));

import {
  signPayload,
  createWebhook,
  listWebhooks,
  deleteWebhook,
  createDelivery,
  startWebhookListener,
  stopWebhookListener,
} from '../services/webhook-service.js';

beforeAll(async () => { testDb = await getTestDb(); });
afterAll(async () => { await closeTestDb(); });
beforeEach(async () => { await truncateTestTables('webhook_deliveries', 'webhooks'); });

describe('webhook-service', () => {
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
