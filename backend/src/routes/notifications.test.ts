import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { validatorCompiler } from 'fastify-type-provider-zod';
import { notificationRoutes } from './notifications.js';

const mockAll = vi.fn().mockReturnValue([]);
const mockGet = vi.fn().mockReturnValue({ count: 0 });

vi.mock('../db/sqlite.js', () => ({
  getDb: () => ({
    prepare: () => ({
      all: (...args: unknown[]) => mockAll(...args),
      get: (...args: unknown[]) => mockGet(...args),
      run: vi.fn(),
    }),
  }),
}));

const mockSendTest = vi.fn();

vi.mock('../services/notification-service.js', () => ({
  sendTestNotification: (...args: unknown[]) => mockSendTest(...args),
}));

describe('Notification Routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.decorate('authenticate', async () => undefined);
    app.decorate('requireRole', () => async () => undefined);
    await app.register(notificationRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockAll.mockReturnValue([]);
    mockGet.mockReturnValue({ count: 0 });
  });

  describe('GET /api/notifications/history', () => {
    it('returns paginated notification history', async () => {
      const entries = [
        { id: 1, channel: 'teams', event_type: 'anomaly', title: 'CPU Spike', status: 'sent', created_at: '2024-01-01' },
      ];
      mockAll.mockReturnValue(entries);
      mockGet.mockReturnValue({ count: 1 });

      const response = await app.inject({
        method: 'GET',
        url: '/api/notifications/history',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.entries).toEqual(entries);
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

    it('accepts channel filter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/notifications/history?channel=email',
        headers: { authorization: 'Bearer test' },
      });

      expect(response.statusCode).toBe(200);
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
