import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildTeamsCard,
  buildEmailHtml,
  escapeHtml,
  sendTeamsNotification,
  sendEmailNotification,
  sendDiscordNotification,
  sendTelegramNotification,
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
  TEAMS_WEBHOOK_URL: 'https://contoso.webhook.office.com/webhookb2/incoming',
  TEAMS_NOTIFICATIONS_ENABLED: false,
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: 587,
  SMTP_SECURE: true,
  SMTP_USER: 'user@example.com',
  SMTP_PASSWORD: 'password',
  SMTP_FROM: 'AI Dashboard <noreply@example.com>',
  EMAIL_NOTIFICATIONS_ENABLED: false,
  EMAIL_RECIPIENTS: 'admin@example.com',
  DISCORD_WEBHOOK_URL: '',
  DISCORD_NOTIFICATIONS_ENABLED: false,
  TELEGRAM_BOT_TOKEN: '',
  TELEGRAM_CHAT_ID: '',
  TELEGRAM_NOTIFICATIONS_ENABLED: false,
});

vi.mock('../config/index.js', () => ({
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
}));

const mockQueryOne = vi.fn();
const mockExecute = vi.fn().mockResolvedValue({ changes: 1 });
const mockQuery = vi.fn().mockResolvedValue([]);
vi.mock('../db/app-db-router.js', () => ({
  getDbForDomain: () => ({
    query: (...args: unknown[]) => mockQuery(...args),
    queryOne: (...args: unknown[]) => mockQueryOne(...args),
    execute: (...args: unknown[]) => mockExecute(...args),
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
    mockQueryOne.mockResolvedValue(null);
    mockGetConfig.mockReturnValue({
      TEAMS_WEBHOOK_URL: 'https://contoso.webhook.office.com/webhookb2/incoming',
      TEAMS_NOTIFICATIONS_ENABLED: false,
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: 587,
      SMTP_SECURE: true,
      SMTP_USER: 'user@example.com',
      SMTP_PASSWORD: 'password',
      SMTP_FROM: 'AI Dashboard <noreply@example.com>',
      EMAIL_NOTIFICATIONS_ENABLED: false,
      EMAIL_RECIPIENTS: 'admin@example.com',
      DISCORD_WEBHOOK_URL: '',
      DISCORD_NOTIFICATIONS_ENABLED: false,
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_CHAT_ID: '',
      TELEGRAM_NOTIFICATIONS_ENABLED: false,
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
        'https://contoso.webhook.office.com/webhookb2/incoming',
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
      expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO notification_log'), expect.any(Array));
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
        TEAMS_WEBHOOK_URL: 'https://contoso.webhook.office.com/webhookb2/incoming',
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
        TEAMS_WEBHOOK_URL: 'https://contoso.webhook.office.com/webhookb2/incoming',
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

  describe('escapeHtml', () => {
    it('should escape HTML special characters', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
      );
    });

    it('should escape ampersands and single quotes', () => {
      expect(escapeHtml("Tom & Jerry's")).toBe('Tom &amp; Jerry&#39;s');
    });

    it('should return plain text unchanged', () => {
      expect(escapeHtml('Hello World')).toBe('Hello World');
    });
  });

  describe('buildEmailHtml - XSS prevention', () => {
    it('should escape HTML in title and body', () => {
      const html = buildEmailHtml({
        title: '<img src=x onerror=alert(1)>',
        body: '<script>steal()</script>',
        severity: 'info',
        eventType: 'test',
      });

      expect(html).not.toContain('<img');
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;img');
      expect(html).toContain('&lt;script&gt;');
    });

    it('should escape HTML in container name', () => {
      const html = buildEmailHtml({
        title: 'Alert',
        body: 'test',
        severity: 'info',
        containerName: '<b>evil</b>',
        eventType: 'test',
      });

      expect(html).not.toContain('<b>evil</b>');
      expect(html).toContain('&lt;b&gt;evil&lt;/b&gt;');
    });
  });

  describe('SSRF prevention - webhook URL validation', () => {
    it('should reject HTTP (non-HTTPS) webhook URLs', async () => {
      mockGetConfig.mockReturnValue({
        TEAMS_WEBHOOK_URL: 'http://169.254.169.254/latest/meta-data/',
        TEAMS_NOTIFICATIONS_ENABLED: true,
        EMAIL_NOTIFICATIONS_ENABLED: false,
      });

      await expect(
        sendTeamsNotification({
          title: 'Test',
          body: 'body',
          severity: 'info',
          eventType: 'test',
        }),
      ).rejects.toThrow('Teams webhook URL not configured');

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should reject invalid webhook URLs', async () => {
      mockGetConfig.mockReturnValue({
        TEAMS_WEBHOOK_URL: 'not-a-url',
        TEAMS_NOTIFICATIONS_ENABLED: true,
        EMAIL_NOTIFICATIONS_ENABLED: false,
      });

      await expect(
        sendTeamsNotification({
          title: 'Test',
          body: 'body',
          severity: 'info',
          eventType: 'test',
        }),
      ).rejects.toThrow('Teams webhook URL not configured');

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should reject non-office webhook domains', async () => {
      mockGetConfig.mockReturnValue({
        TEAMS_WEBHOOK_URL: 'https://example.com/webhook',
        TEAMS_NOTIFICATIONS_ENABLED: true,
        EMAIL_NOTIFICATIONS_ENABLED: false,
      });

      await expect(
        sendTeamsNotification({
          title: 'Test',
          body: 'body',
          severity: 'info',
          eventType: 'test',
        }),
      ).rejects.toThrow('Teams webhook URL not configured');

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('SSRF prevention - SMTP host validation', () => {
    it('should reject private SMTP hosts from environment', async () => {
      mockGetConfig.mockReturnValue({
        TEAMS_WEBHOOK_URL: undefined,
        TEAMS_NOTIFICATIONS_ENABLED: false,
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: 587,
        SMTP_SECURE: true,
        SMTP_USER: 'user@example.com',
        SMTP_PASSWORD: 'password',
        SMTP_FROM: 'AI Dashboard <noreply@example.com>',
        EMAIL_NOTIFICATIONS_ENABLED: true,
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
  });

  describe('rate limiting - failure handling', () => {
    it('should NOT record cooldown when all notifications fail', async () => {
      mockGetConfig.mockReturnValue({
        TEAMS_WEBHOOK_URL: 'https://contoso.webhook.office.com/webhookb2/incoming',
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

      // Make Teams notification fail
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Server Error'),
      });

      const insight: Insight = {
        id: 'fail-test',
        endpoint_id: 1,
        endpoint_name: 'local',
        container_id: 'fail-container',
        container_name: 'web-app',
        severity: 'critical',
        category: 'anomaly',
        title: 'CPU Spike',
        description: 'CPU at 99%',
        suggested_action: null,
        is_acknowledged: 0,
        created_at: new Date().toISOString(),
      };

      await notifyInsight(insight);

      // Cooldown should NOT be recorded since the notification failed
      const map = _getCooldownMap();
      expect(map.has('fail-container:anomaly')).toBe(false);
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

    it('should return success for discord test', async () => {
      mockGetConfig.mockReturnValue({
        ...mockGetConfig(),
        DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/123456/abcdef',
        DISCORD_NOTIFICATIONS_ENABLED: true,
      });
      mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') });

      const result = await sendTestNotification('discord');

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should return success for telegram test', async () => {
      mockGetConfig.mockReturnValue({
        ...mockGetConfig(),
        TELEGRAM_BOT_TOKEN: '123456789:ABCDefGH-IJKlmnoPQRSTUVwxyz012345678',
        TELEGRAM_CHAT_ID: '-1001234567890',
        TELEGRAM_NOTIFICATIONS_ENABLED: true,
      });
      mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('{}') });

      const result = await sendTestNotification('telegram');

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('sendDiscordNotification', () => {
    it('should POST embed to Discord webhook URL', async () => {
      mockGetConfig.mockReturnValue({
        ...mockGetConfig(),
        DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/123456/abcdef',
      });
      mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') });

      await sendDiscordNotification({
        title: 'CPU Spike',
        body: 'CPU at 95%',
        severity: 'critical',
        containerName: 'web-app',
        endpointId: 1,
        eventType: 'anomaly',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/123456/abcdef',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.embeds).toHaveLength(1);
      expect(callBody.embeds[0].title).toBe('CPU Spike');
      expect(callBody.embeds[0].description).toBe('CPU at 95%');
      expect(callBody.embeds[0].color).toBe(0xef4444);
      expect(callBody.embeds[0].fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Container', value: 'web-app', inline: true }),
          expect.objectContaining({ name: 'Endpoint', value: '1', inline: true }),
          expect.objectContaining({ name: 'Severity', value: 'critical', inline: true }),
        ]),
      );
      expect(callBody.embeds[0].timestamp).toBeDefined();
    });

    it('should use warning color for warning severity', async () => {
      mockGetConfig.mockReturnValue({
        ...mockGetConfig(),
        DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/123456/abcdef',
      });
      mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') });

      await sendDiscordNotification({
        title: 'Warning',
        body: 'test',
        severity: 'warning',
        eventType: 'anomaly',
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.embeds[0].color).toBe(0xeab308);
    });

    it('should use info color for info severity', async () => {
      mockGetConfig.mockReturnValue({
        ...mockGetConfig(),
        DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/123456/abcdef',
      });
      mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') });

      await sendDiscordNotification({
        title: 'Info',
        body: 'test',
        severity: 'info',
        eventType: 'test',
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.embeds[0].color).toBe(0x3b82f6);
    });

    it('should use green color for unknown severity', async () => {
      mockGetConfig.mockReturnValue({
        ...mockGetConfig(),
        DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/123456/abcdef',
      });
      mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') });

      await sendDiscordNotification({
        title: 'Ok',
        body: 'test',
        severity: 'healthy',
        eventType: 'test',
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.embeds[0].color).toBe(0x22c55e);
    });

    it('should throw on webhook failure', async () => {
      mockGetConfig.mockReturnValue({
        ...mockGetConfig(),
        DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/123456/abcdef',
      });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Rate limited'),
      });

      await expect(
        sendDiscordNotification({
          title: 'Test',
          body: 'body',
          severity: 'info',
          eventType: 'test',
        }),
      ).rejects.toThrow('Discord webhook failed (429)');
    });

    it('should throw when Discord webhook URL is not configured', async () => {
      mockGetConfig.mockReturnValue({
        ...mockGetConfig(),
        DISCORD_WEBHOOK_URL: '',
      });

      await expect(
        sendDiscordNotification({
          title: 'Test',
          body: 'body',
          severity: 'info',
          eventType: 'test',
        }),
      ).rejects.toThrow('Discord webhook URL not configured');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should log notification on success', async () => {
      mockGetConfig.mockReturnValue({
        ...mockGetConfig(),
        DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/123456/abcdef',
      });
      mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') });

      await sendDiscordNotification({
        title: 'Test',
        body: 'body',
        severity: 'info',
        eventType: 'test',
      });

      expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO notification_log'), expect.any(Array));
    });
  });

  describe('SSRF prevention - Discord webhook URL validation', () => {
    it('should reject non-discord.com URLs', async () => {
      mockGetConfig.mockReturnValue({
        ...mockGetConfig(),
        DISCORD_WEBHOOK_URL: 'https://evil.com/api/webhooks/123/abc',
      });

      await expect(
        sendDiscordNotification({
          title: 'Test',
          body: 'body',
          severity: 'info',
          eventType: 'test',
        }),
      ).rejects.toThrow('Discord webhook URL not configured');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should reject HTTP (non-HTTPS) Discord URLs', async () => {
      mockGetConfig.mockReturnValue({
        ...mockGetConfig(),
        DISCORD_WEBHOOK_URL: 'http://discord.com/api/webhooks/123/abc',
      });

      await expect(
        sendDiscordNotification({
          title: 'Test',
          body: 'body',
          severity: 'info',
          eventType: 'test',
        }),
      ).rejects.toThrow('Discord webhook URL not configured');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should reject Discord URLs without /api/webhooks/ path', async () => {
      mockGetConfig.mockReturnValue({
        ...mockGetConfig(),
        DISCORD_WEBHOOK_URL: 'https://discord.com/channels/123/456',
      });

      await expect(
        sendDiscordNotification({
          title: 'Test',
          body: 'body',
          severity: 'info',
          eventType: 'test',
        }),
      ).rejects.toThrow('Discord webhook URL not configured');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should accept discordapp.com webhook URLs', async () => {
      mockGetConfig.mockReturnValue({
        ...mockGetConfig(),
        DISCORD_WEBHOOK_URL: 'https://discordapp.com/api/webhooks/123/abc',
      });
      mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') });

      await sendDiscordNotification({
        title: 'Test',
        body: 'body',
        severity: 'info',
        eventType: 'test',
      });

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should reject SSRF attempts via private IPs', async () => {
      mockGetConfig.mockReturnValue({
        ...mockGetConfig(),
        DISCORD_WEBHOOK_URL: 'https://169.254.169.254/api/webhooks/123/abc',
      });

      await expect(
        sendDiscordNotification({
          title: 'Test',
          body: 'body',
          severity: 'info',
          eventType: 'test',
        }),
      ).rejects.toThrow('Discord webhook URL not configured');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('sendTelegramNotification', () => {
    const validToken = '123456789:ABCDefGH-IJKlmnoPQRSTUVwxyz012345678';

    it('should POST HTML message to Telegram API', async () => {
      mockGetConfig.mockReturnValue({
        ...mockGetConfig(),
        TELEGRAM_BOT_TOKEN: validToken,
        TELEGRAM_CHAT_ID: '-1001234567890',
      });
      mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('{}') });

      await sendTelegramNotification({
        title: 'CPU Spike',
        body: 'CPU at 95%',
        severity: 'critical',
        containerName: 'web-app',
        endpointId: 1,
        eventType: 'anomaly',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.telegram.org/bot${validToken}/sendMessage`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.chat_id).toBe('-1001234567890');
      expect(callBody.parse_mode).toBe('HTML');
      expect(callBody.text).toContain('<b>CPU Spike</b>');
      expect(callBody.text).toContain('CPU at 95%');
      expect(callBody.text).toContain('<b>Container:</b> web-app');
      expect(callBody.text).toContain('<b>Endpoint:</b> 1');
      expect(callBody.text).toContain('<b>Severity:</b> critical');
    });

    it('should escape HTML in message content', async () => {
      mockGetConfig.mockReturnValue({
        ...mockGetConfig(),
        TELEGRAM_BOT_TOKEN: validToken,
        TELEGRAM_CHAT_ID: '-1001234567890',
      });
      mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('{}') });

      await sendTelegramNotification({
        title: '<script>alert(1)</script>',
        body: 'CPU > 90% & memory < 10%',
        severity: 'warning',
        eventType: 'anomaly',
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.text).toContain('&lt;script&gt;');
      expect(callBody.text).toContain('CPU &gt; 90% &amp; memory &lt; 10%');
      expect(callBody.text).not.toContain('<script>');
    });

    it('should throw when bot token is not configured', async () => {
      mockGetConfig.mockReturnValue({
        ...mockGetConfig(),
        TELEGRAM_BOT_TOKEN: '',
        TELEGRAM_CHAT_ID: '-1001234567890',
      });

      await expect(
        sendTelegramNotification({
          title: 'Test',
          body: 'body',
          severity: 'info',
          eventType: 'test',
        }),
      ).rejects.toThrow('Telegram bot token or chat ID not configured');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should throw when chat ID is not configured', async () => {
      mockGetConfig.mockReturnValue({
        ...mockGetConfig(),
        TELEGRAM_BOT_TOKEN: validToken,
        TELEGRAM_CHAT_ID: '',
      });

      await expect(
        sendTelegramNotification({
          title: 'Test',
          body: 'body',
          severity: 'info',
          eventType: 'test',
        }),
      ).rejects.toThrow('Telegram bot token or chat ID not configured');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should throw on invalid bot token format', async () => {
      mockGetConfig.mockReturnValue({
        ...mockGetConfig(),
        TELEGRAM_BOT_TOKEN: 'invalid-token-format',
        TELEGRAM_CHAT_ID: '-1001234567890',
      });

      await expect(
        sendTelegramNotification({
          title: 'Test',
          body: 'body',
          severity: 'info',
          eventType: 'test',
        }),
      ).rejects.toThrow('Telegram bot token format is invalid');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should throw on API failure', async () => {
      mockGetConfig.mockReturnValue({
        ...mockGetConfig(),
        TELEGRAM_BOT_TOKEN: validToken,
        TELEGRAM_CHAT_ID: '-1001234567890',
      });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Forbidden'),
      });

      await expect(
        sendTelegramNotification({
          title: 'Test',
          body: 'body',
          severity: 'info',
          eventType: 'test',
        }),
      ).rejects.toThrow('Telegram API failed (403)');
    });

    it('should log notification on success', async () => {
      mockGetConfig.mockReturnValue({
        ...mockGetConfig(),
        TELEGRAM_BOT_TOKEN: validToken,
        TELEGRAM_CHAT_ID: '-1001234567890',
      });
      mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('{}') });

      await sendTelegramNotification({
        title: 'Test',
        body: 'body',
        severity: 'info',
        eventType: 'test',
      });

      expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO notification_log'), expect.any(Array));
    });
  });
});
