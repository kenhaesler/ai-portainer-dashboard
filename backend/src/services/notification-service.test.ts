import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildTeamsCard,
  buildEmailHtml,
  sendTeamsNotification,
  sendEmailNotification,
  notifyInsight,
  sendTestNotification,
  _resetCooldownMap,
  _getCooldownMap,
} from './notification-service.js';
import type { Insight } from '../models/monitoring.js';

const COOLDOWN_MS = 15 * 60 * 1000;

// Mock dependencies
vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockGetConfig = vi.fn().mockReturnValue({
  TEAMS_WEBHOOK_URL: 'https://teams.example.com/webhook',
  TEAMS_NOTIFICATIONS_ENABLED: false,
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: 587,
  SMTP_SECURE: true,
  SMTP_USER: 'user@example.com',
  SMTP_PASSWORD: 'password',
  SMTP_FROM: 'AI Dashboard <noreply@example.com>',
  EMAIL_NOTIFICATIONS_ENABLED: false,
  EMAIL_RECIPIENTS: 'admin@example.com',
});

vi.mock('../config/index.js', () => ({
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
}));

const mockDbPrepare = vi.fn();
const mockDbRun = vi.fn();
const mockDbGet = vi.fn();
vi.mock('../db/sqlite.js', () => ({
  getDb: () => ({
    prepare: (...args: unknown[]) => {
      mockDbPrepare(...args);
      return {
        run: mockDbRun,
        get: mockDbGet,
      };
    },
  }),
}));

// Mock nodemailer
const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'test-id' });
vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({
      sendMail: mockSendMail,
    }),
  },
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('notification-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetCooldownMap();
    // Default: settings not found in DB -> fall back to env config
    mockDbGet.mockReturnValue(undefined);
    mockGetConfig.mockReturnValue({
      TEAMS_WEBHOOK_URL: 'https://teams.example.com/webhook',
      TEAMS_NOTIFICATIONS_ENABLED: false,
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: 587,
      SMTP_SECURE: true,
      SMTP_USER: 'user@example.com',
      SMTP_PASSWORD: 'password',
      SMTP_FROM: 'AI Dashboard <noreply@example.com>',
      EMAIL_NOTIFICATIONS_ENABLED: false,
      EMAIL_RECIPIENTS: 'admin@example.com',
    });
  });

  describe('buildTeamsCard', () => {
    it('should build a valid adaptive card payload', () => {
      const card = buildTeamsCard({
        title: 'CPU Anomaly',
        body: 'CPU usage is 95%',
        severity: 'critical',
        containerName: 'web-app',
        endpointId: 1,
        eventType: 'anomaly',
      });

      expect(card.type).toBe('message');
      expect(card.attachments).toHaveLength(1);
      expect(card.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive');

      const content = card.attachments[0].content;
      expect(content.type).toBe('AdaptiveCard');
      expect(content.version).toBe('1.4');

      // Title block
      const titleBlock = content.body[0];
      expect(titleBlock.text).toBe('CPU Anomaly');
      expect(titleBlock.color).toBe('attention');

      // Body block
      const bodyBlock = content.body[1];
      expect(bodyBlock.text).toBe('CPU usage is 95%');

      // Facts
      const factSet = content.body[2] as { facts: Array<{ title: string; value: string }> };
      const factTitles = factSet.facts.map((f) => f.title);
      expect(factTitles).toContain('Container');
      expect(factTitles).toContain('Endpoint');
      expect(factTitles).toContain('Severity');
      expect(factTitles).toContain('Time');
    });

    it('should use warning color for warning severity', () => {
      const card = buildTeamsCard({
        title: 'Warning',
        body: 'test',
        severity: 'warning',
        eventType: 'anomaly',
      });

      expect(card.attachments[0].content.body[0].color).toBe('warning');
    });

    it('should use good color for info severity', () => {
      const card = buildTeamsCard({
        title: 'Info',
        body: 'test',
        severity: 'info',
        eventType: 'test',
      });

      expect(card.attachments[0].content.body[0].color).toBe('good');
    });

    it('should omit container/endpoint facts when not provided', () => {
      const card = buildTeamsCard({
        title: 'Test',
        body: 'test body',
        severity: 'info',
        eventType: 'test',
      });

      const factSet = card.attachments[0].content.body[2] as { facts: Array<{ title: string }> };
      const factTitles = factSet.facts.map((f) => f.title);
      expect(factTitles).not.toContain('Container');
      expect(factTitles).not.toContain('Endpoint');
    });
  });

  describe('buildEmailHtml', () => {
    it('should generate HTML with the correct title and body', () => {
      const html = buildEmailHtml({
        title: 'Memory Alert',
        body: 'Memory at 90%',
        severity: 'warning',
        containerName: 'api-server',
        endpointId: 2,
        eventType: 'anomaly',
      });

      expect(html).toContain('Memory Alert');
      expect(html).toContain('Memory at 90%');
      expect(html).toContain('api-server');
      expect(html).toContain('WARNING');
      expect(html).toContain('#f59e0b'); // warning color
    });

    it('should use red color for critical severity', () => {
      const html = buildEmailHtml({
        title: 'Critical',
        body: 'test',
        severity: 'critical',
        eventType: 'anomaly',
      });

      expect(html).toContain('#ef4444');
    });

    it('should use blue color for info severity', () => {
      const html = buildEmailHtml({
        title: 'Info',
        body: 'test',
        severity: 'info',
        eventType: 'test',
      });

      expect(html).toContain('#3b82f6');
    });

    it('should omit container row when not provided', () => {
      const html = buildEmailHtml({
        title: 'Test',
        body: 'test',
        severity: 'info',
        eventType: 'test',
      });

      expect(html).not.toContain('Container');
    });
  });

  describe('sendTeamsNotification', () => {
    it('should POST adaptive card to webhook URL', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('1') });

      await sendTeamsNotification({
        title: 'Test',
        body: 'Test body',
        severity: 'info',
        eventType: 'test',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://teams.example.com/webhook',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      // Verify body is valid JSON
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.type).toBe('message');
    });

    it('should throw on webhook failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Bad Request'),
      });

      await expect(
        sendTeamsNotification({
          title: 'Test',
          body: 'Test body',
          severity: 'info',
          eventType: 'test',
        }),
      ).rejects.toThrow('Teams webhook failed (400): Bad Request');
    });

    it('should log notification on success', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('1') });

      await sendTeamsNotification({
        title: 'Test',
        body: 'body',
        severity: 'info',
        eventType: 'test',
      });

      // Verify notification_log insert was called
      expect(mockDbPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO notification_log'));
    });
  });

  describe('sendEmailNotification', () => {
    it('should send email via nodemailer', async () => {
      await sendEmailNotification({
        title: 'Test Alert',
        body: 'Test body',
        severity: 'warning',
        eventType: 'test',
      });

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'AI Dashboard <noreply@example.com>',
          to: 'admin@example.com',
          subject: '[WARNING] Test Alert',
        }),
      );

      // HTML should be included
      const callArgs = mockSendMail.mock.calls[0][0];
      expect(callArgs.html).toContain('Test Alert');
    });

    it('should throw if no SMTP host configured', async () => {
      mockGetConfig.mockReturnValue({
        SMTP_HOST: undefined,
        SMTP_PORT: 587,
        SMTP_SECURE: true,
        SMTP_USER: undefined,
        SMTP_PASSWORD: undefined,
        SMTP_FROM: 'test@example.com',
        EMAIL_RECIPIENTS: 'admin@example.com',
      });

      await expect(
        sendEmailNotification({
          title: 'Test',
          body: 'body',
          severity: 'info',
          eventType: 'test',
        }),
      ).rejects.toThrow('SMTP host not configured');
    });

    it('should throw if no recipients configured', async () => {
      mockGetConfig.mockReturnValue({
        SMTP_HOST: 'smtp.example.com',
        SMTP_PORT: 587,
        SMTP_SECURE: true,
        SMTP_USER: undefined,
        SMTP_PASSWORD: undefined,
        SMTP_FROM: 'test@example.com',
        EMAIL_RECIPIENTS: '',
      });

      await expect(
        sendEmailNotification({
          title: 'Test',
          body: 'body',
          severity: 'info',
          eventType: 'test',
        }),
      ).rejects.toThrow('No email recipients configured');
    });
  });

  describe('rate limiting', () => {
    it('should not rate-limit the first notification for a container', () => {
      const map = _getCooldownMap();
      expect(map.has('container-1:anomaly')).toBe(false);
    });

    it('should rate-limit duplicate notifications within cooldown period', () => {
      const map = _getCooldownMap();
      map.set('container-1:anomaly', Date.now());

      const lastSent = map.get('container-1:anomaly')!;
      expect(Date.now() - lastSent).toBeLessThan(COOLDOWN_MS);
    });

    it('should allow notification after cooldown expires', () => {
      const map = _getCooldownMap();
      // Set a timestamp well in the past (20 minutes ago)
      map.set('container-1:anomaly', Date.now() - 20 * 60 * 1000);

      const lastSent = map.get('container-1:anomaly')!;
      expect(Date.now() - lastSent).toBeGreaterThan(COOLDOWN_MS);
    });

    it('should clear all cooldowns on reset', () => {
      const map = _getCooldownMap();
      map.set('c1:anomaly', Date.now());
      map.set('c2:security', Date.now());

      _resetCooldownMap();

      expect(_getCooldownMap().size).toBe(0);
    });
  });

  describe('notifyInsight', () => {
    it('should skip when both channels are disabled', async () => {
      const insight: Insight = {
        id: 'test-1',
        endpoint_id: 1,
        endpoint_name: 'local',
        container_id: 'abc123',
        container_name: 'web-app',
        severity: 'critical',
        category: 'anomaly',
        title: 'CPU Spike',
        description: 'CPU at 95%',
        suggested_action: null,
        is_acknowledged: 0,
        created_at: new Date().toISOString(),
      };

      await notifyInsight(insight);

      // Neither fetch nor sendMail should be called
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('should send Teams notification when enabled for security insight', async () => {
      mockGetConfig.mockReturnValue({
        TEAMS_WEBHOOK_URL: 'https://teams.example.com/webhook',
        TEAMS_NOTIFICATIONS_ENABLED: true,
        EMAIL_NOTIFICATIONS_ENABLED: false,
        SMTP_HOST: undefined,
        SMTP_PORT: 587,
        SMTP_SECURE: true,
        SMTP_USER: undefined,
        SMTP_PASSWORD: undefined,
        SMTP_FROM: 'test@example.com',
        EMAIL_RECIPIENTS: '',
      });

      mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('1') });

      const insight: Insight = {
        id: 'test-2',
        endpoint_id: 1,
        endpoint_name: 'local',
        container_id: 'abc123',
        container_name: 'web-app',
        severity: 'warning',
        category: 'security:privileged',
        title: 'Privileged Container',
        description: 'Container running in privileged mode',
        suggested_action: null,
        is_acknowledged: 0,
        created_at: new Date().toISOString(),
      };

      await notifyInsight(insight);

      expect(mockFetch).toHaveBeenCalled();
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('should rate-limit duplicate notifications for the same container', async () => {
      mockGetConfig.mockReturnValue({
        TEAMS_WEBHOOK_URL: 'https://teams.example.com/webhook',
        TEAMS_NOTIFICATIONS_ENABLED: true,
        EMAIL_NOTIFICATIONS_ENABLED: false,
        SMTP_HOST: undefined,
        SMTP_PORT: 587,
        SMTP_SECURE: true,
        SMTP_USER: undefined,
        SMTP_PASSWORD: undefined,
        SMTP_FROM: 'test@example.com',
        EMAIL_RECIPIENTS: '',
      });

      mockFetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('1') });

      const insight: Insight = {
        id: 'test-3',
        endpoint_id: 1,
        endpoint_name: 'local',
        container_id: 'container-rl',
        container_name: 'web-app',
        severity: 'warning',
        category: 'anomaly',
        title: 'CPU Anomaly',
        description: 'CPU at 90%',
        suggested_action: null,
        is_acknowledged: 0,
        created_at: new Date().toISOString(),
      };

      // First call should send
      await notifyInsight(insight);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call should be rate-limited
      mockFetch.mockClear();
      await notifyInsight({ ...insight, id: 'test-4' });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('sendTestNotification', () => {
    it('should return success for teams test', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('1') });

      const result = await sendTestNotification('teams');

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return error on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Error'),
      });

      const result = await sendTestNotification('teams');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Teams webhook failed');
    });

    it('should return success for email test', async () => {
      const result = await sendTestNotification('email');

      expect(result.success).toBe(true);
      expect(mockSendMail).toHaveBeenCalled();
    });
  });
});
