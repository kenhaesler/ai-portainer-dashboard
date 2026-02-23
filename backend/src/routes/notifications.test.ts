import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { getTestDb, truncateTestTables, closeTestDb } from '../core/db/test-db-helper.js';
import type { AppDb } from '../core/db/app-db.js';
import { notificationRoutes } from './notifications.js';

let testDb: AppDb;

// Kept: app-db-router mock — tests control database routing
vi.mock('../core/db/app-db-router.js', () => ({
  getDbForDomain: () => testDb,
}));

const mockSendTest = vi.fn();

// Kept: notification-service mock — side-effect isolation
vi.mock('../services/notification-service.js', () => ({
  sendTestNotification: (...args: unknown[]) => mockSendTest(...args),
}));

describe('Notification Routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    testDb = await getTestDb();
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.decorate('authenticate', async () => undefined);
    app.decorate('requireRole', () => async () => undefined);
    await app.register(notificationRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await truncateTestTables('notification_log');
  });

  describe('GET /api/notifications/history', () => {
    it('returns paginated notification history', async () => {
      await testDb.execute(
        `INSERT INTO notification_log (channel, event_type, title, body, status)
         VALUES ('teams', 'anomaly', 'CPU Spike', 'High CPU on api', 'sent')`,
        [],
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/notifications/history',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.entries).toHaveLength(1);
      expect(body.entries[0].channel).toBe('teams');
      expect(body.entries[0].title).toBe('CPU Spike');
      expect(body.total).toBe(1);
      expect(body.limit).toBe(50);
      expect(body.offset).toBe(0);
    });

    it('accepts limit and offset query params', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/notifications/history?limit=10&offset=5',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.limit).toBe(10);
      expect(body.offset).toBe(5);
    });

    it('filters by channel', async () => {
      await testDb.execute(
        `INSERT INTO notification_log (channel, event_type, title, body, status)
         VALUES ('email', 'alert', 'Email Alert', 'Email body', 'sent'),
                ('teams', 'alert', 'Teams Alert', 'Teams body', 'sent')`,
        [],
      );

      const response = await app.inject({
        method: 'GET',
        url: '/api/notifications/history?channel=email',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.entries).toHaveLength(1);
      expect(body.entries[0].channel).toBe('email');
    });

    it('returns empty results when no history exists', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/notifications/history',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.entries).toEqual([]);
      expect(body.total).toBe(0);
    });
  });

  describe('POST /api/notifications/test', () => {
    it('returns success when test notification succeeds', async () => {
      mockSendTest.mockResolvedValue({ success: true });

      const response = await app.inject({
        method: 'POST',
        url: '/api/notifications/test',
        headers: { authorization: 'Bearer test' },
        payload: { channel: 'teams' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(mockSendTest).toHaveBeenCalledWith('teams');
    });

    it('returns error when test notification fails', async () => {
      mockSendTest.mockResolvedValue({ success: false, error: 'Webhook URL not configured' });

      const response = await app.inject({
        method: 'POST',
        url: '/api/notifications/test',
        headers: { authorization: 'Bearer test' },
        payload: { channel: 'teams' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error).toBe('Webhook URL not configured');
    });

    it('works with email channel', async () => {
      mockSendTest.mockResolvedValue({ success: true });

      const response = await app.inject({
        method: 'POST',
        url: '/api/notifications/test',
        headers: { authorization: 'Bearer test' },
        payload: { channel: 'email' },
      });

      expect(response.statusCode).toBe(200);
      expect(mockSendTest).toHaveBeenCalledWith('email');
    });

    it('rejects invalid channel values', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/notifications/test',
        headers: { authorization: 'Bearer test' },
        payload: { channel: 'invalid' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects missing channel', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/notifications/test',
        headers: { authorization: 'Bearer test' },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
