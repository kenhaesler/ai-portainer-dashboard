import nodemailer from 'nodemailer';
import { z } from 'zod';
import { getDbForDomain } from '../db/app-db-router.js';
import { getConfig } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';
import type { Insight } from '../models/monitoring.js';
import { withSpan } from './trace-context.js';

const log = createChildLogger('notification-service');

// Rate limiting: in-memory map keyed by `${containerId}:${eventType}`, value is last-sent timestamp
const cooldownMap = new Map<string, number>();
const COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

interface NotificationPayload {
  title: string;
  body: string;
  severity: string;
  containerId?: string | null;
  containerName?: string | null;
  endpointId?: number | null;
  eventType: string;
}

interface TeamsAdaptiveCard {
  type: string;
  attachments: Array<{
    contentType: string;
    contentUrl: null;
    content: {
      $schema: string;
      type: string;
      version: string;
      body: Array<Record<string, unknown>>;
      actions?: Array<Record<string, unknown>>;
    };
  }>;
}

function getSeverityColor(severity: string): string {
  switch (severity) {
    case 'critical': return 'attention';
    case 'warning': return 'warning';
    default: return 'good';
  }
}

async function getSettingValue(key: string): Promise<string | null> {
  try {
    const settingsDb = getDbForDomain('settings');
    const row = await settingsDb.queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
    return row?.value ?? null;
  } catch {
    return null;
  }
}

async function isChannelEnabled(channel: 'teams' | 'email' | 'discord' | 'telegram'): Promise<boolean> {
  if (channel === 'teams') {
    const dbValue = await getSettingValue('notifications.teams_enabled');
    if (dbValue !== null) return dbValue === 'true';
    const config = getConfig();
    return config.TEAMS_NOTIFICATIONS_ENABLED;
  }
  if (channel === 'discord') {
    const dbValue = await getSettingValue('notifications.discord_enabled');
    if (dbValue !== null) return dbValue === 'true';
    const config = getConfig();
    return config.DISCORD_NOTIFICATIONS_ENABLED;
  }
  if (channel === 'telegram') {
    const dbValue = await getSettingValue('notifications.telegram_enabled');
    if (dbValue !== null) return dbValue === 'true';
    const config = getConfig();
    return config.TELEGRAM_NOTIFICATIONS_ENABLED;
  }
  const dbValue = await getSettingValue('notifications.email_enabled');
  if (dbValue !== null) return dbValue === 'true';
  const config = getConfig();
  return config.EMAIL_NOTIFICATIONS_ENABLED;
}

function validateWebhookUrl(url: string): boolean {
  if (!z.string().url().safeParse(url).success) return false;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;
  if (!parsed.hostname.endsWith('.webhook.office.com')) return false;
  if (!parsed.pathname || parsed.pathname === '/') return false;
  return true;
}

function isPrivateOrLocalHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === 'localhost' || normalized.endsWith('.local')) return true;
  if (normalized === '::1') return true;

  // IPv4 private and loopback ranges
  if (/^127\./.test(normalized)) return true;
  if (/^10\./.test(normalized)) return true;
  if (/^192\.168\./.test(normalized)) return true;
  if (/^169\.254\./.test(normalized)) return true;
  if (/^0\./.test(normalized)) return true;
  const match172 = normalized.match(/^172\.(\d{1,3})\./);
  if (match172) {
    const secondOctet = Number(match172[1]);
    if (secondOctet >= 16 && secondOctet <= 31) return true;
  }

  return false;
}

async function getSafeSmtpHost(): Promise<string | undefined> {
  const configHost = getConfig().SMTP_HOST;
  if (!configHost) return undefined;

  const dbHost = await getSettingValue('notifications.smtp_host');
  if (dbHost && dbHost !== configHost) {
    log.warn('Ignoring settings SMTP host override for SSRF protection');
  }

  if (isPrivateOrLocalHost(configHost)) {
    log.warn('Configured SMTP host is private/local and has been blocked');
    return undefined;
  }

  return configHost;
}

async function getTeamsWebhookUrl(): Promise<string | undefined> {
  const dbValue = await getSettingValue('notifications.teams_webhook_url');
  const webhookUrl = dbValue || getConfig().TEAMS_WEBHOOK_URL;
  if (!webhookUrl) return undefined;
  if (!validateWebhookUrl(webhookUrl)) {
    log.warn('Teams webhook URL must be a valid HTTPS URL');
    return undefined;
  }
  return webhookUrl;
}

function validateDiscordWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.hostname === 'discord.com' || parsed.hostname === 'discordapp.com')
      && parsed.pathname.startsWith('/api/webhooks/') && parsed.protocol === 'https:';
  } catch { return false; }
}

function validateTelegramToken(token: string): boolean {
  return /^\d+:[A-Za-z0-9_-]{30,50}$/.test(token);
}

async function getDiscordWebhookUrl(): Promise<string | undefined> {
  const dbValue = await getSettingValue('notifications.discord_webhook_url');
  const webhookUrl = dbValue || getConfig().DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return undefined;
  if (!validateDiscordWebhookUrl(webhookUrl)) {
    log.warn('Discord webhook URL must be a valid HTTPS discord.com/discordapp.com URL');
    return undefined;
  }
  return webhookUrl;
}

async function getSmtpConfig() {
  const config = getConfig();
  return {
    host: await getSafeSmtpHost(),
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    user: config.SMTP_USER,
    password: config.SMTP_PASSWORD,
    from: config.SMTP_FROM,
    recipients: await getSettingValue('notifications.email_recipients') || config.EMAIL_RECIPIENTS,
  };
}

async function logNotification(
  channel: string,
  payload: NotificationPayload,
  status: 'sent' | 'failed',
  error?: string,
): Promise<void> {
  try {
    const db = getDbForDomain('notifications');
    await db.execute(
      `INSERT INTO notification_log (channel, event_type, title, body, severity, container_id, container_name, endpoint_id, status, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        channel,
        payload.eventType,
        payload.title,
        payload.body,
        payload.severity,
        payload.containerId ?? null,
        payload.containerName ?? null,
        payload.endpointId ?? null,
        status,
        error ?? null,
      ],
    );
  } catch (err) {
    log.warn({ err }, 'Failed to log notification');
  }
}

export function buildTeamsCard(payload: NotificationPayload): TeamsAdaptiveCard {
  const color = getSeverityColor(payload.severity);
  const timestamp = new Date().toISOString();

  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            {
              type: 'TextBlock',
              size: 'Medium',
              weight: 'Bolder',
              text: payload.title,
              color,
            },
            {
              type: 'TextBlock',
              text: payload.body,
              wrap: true,
            },
            {
              type: 'FactSet',
              facts: [
                ...(payload.containerName ? [{ title: 'Container', value: payload.containerName }] : []),
                ...(payload.endpointId ? [{ title: 'Endpoint', value: String(payload.endpointId) }] : []),
                { title: 'Severity', value: payload.severity.toUpperCase() },
                { title: 'Time', value: timestamp },
              ],
            },
          ],
        },
      },
    ],
  };
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildEmailHtml(payload: NotificationPayload): string {
  const severityColors: Record<string, string> = {
    critical: '#ef4444',
    warning: '#f59e0b',
    info: '#3b82f6',
  };
  const color = severityColors[payload.severity] || '#6b7280';
  const timestamp = new Date().toISOString();
  const title = escapeHtml(payload.title);
  const body = escapeHtml(payload.body);
  const containerName = payload.containerName ? escapeHtml(payload.containerName) : '';
  const severity = escapeHtml(payload.severity.toUpperCase());

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="border-left: 4px solid ${color}; padding: 16px; background: #f9fafb; border-radius: 4px;">
    <h2 style="margin: 0 0 8px 0; color: ${color};">${title}</h2>
    <p style="margin: 0 0 16px 0; color: #374151;">${body}</p>
    <table style="font-size: 14px; color: #6b7280;">
      ${containerName ? `<tr><td style="padding: 2px 12px 2px 0; font-weight: 600;">Container</td><td>${containerName}</td></tr>` : ''}
      ${payload.endpointId ? `<tr><td style="padding: 2px 12px 2px 0; font-weight: 600;">Endpoint</td><td>${payload.endpointId}</td></tr>` : ''}
      <tr><td style="padding: 2px 12px 2px 0; font-weight: 600;">Severity</td><td>${severity}</td></tr>
      <tr><td style="padding: 2px 12px 2px 0; font-weight: 600;">Time</td><td>${timestamp}</td></tr>
    </table>
  </div>
  <p style="margin-top: 16px; font-size: 12px; color: #9ca3af;">Sent by AI Portainer Dashboard</p>
</body>
</html>`.trim();
}

export async function sendTeamsNotification(payload: NotificationPayload): Promise<void> {
  return withSpan('teams.notify', 'teams-notification', 'client', () =>
    sendTeamsNotificationInner(payload),
  );
}

async function sendTeamsNotificationInner(payload: NotificationPayload): Promise<void> {
  const webhookUrl = await getTeamsWebhookUrl();
  if (!webhookUrl) {
    throw new Error('Teams webhook URL not configured');
  }

  const card = buildTeamsCard(payload);

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(card),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'Unknown error');
    throw new Error(`Teams webhook failed (${response.status}): ${text}`);
  }

  await logNotification('teams', payload, 'sent');
  log.info({ title: payload.title }, 'Teams notification sent');
}

export async function sendEmailNotification(payload: NotificationPayload): Promise<void> {
  return withSpan('email.send', 'email-notification', 'client', () =>
    sendEmailNotificationInner(payload),
  );
}

async function sendEmailNotificationInner(payload: NotificationPayload): Promise<void> {
  const smtp = await getSmtpConfig();
  if (!smtp.host) {
    throw new Error('SMTP host not configured');
  }

  const recipients = smtp.recipients
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);

  if (recipients.length === 0) {
    throw new Error('No email recipients configured');
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    ...(smtp.user && smtp.password
      ? { auth: { user: smtp.user, pass: smtp.password } }
      : {}),
  });

  const html = buildEmailHtml(payload);

  await transporter.sendMail({
    from: smtp.from,
    to: recipients.join(', '),
    subject: `[${payload.severity.toUpperCase()}] ${payload.title}`,
    html,
  });

  await logNotification('email', payload, 'sent');
  log.info({ title: payload.title, recipients: recipients.length }, 'Email notification sent');
}

export async function sendDiscordNotification(payload: NotificationPayload): Promise<void> {
  return withSpan('discord.notify', 'discord-notification', 'client', () =>
    sendDiscordNotificationInner(payload),
  );
}

async function sendDiscordNotificationInner(payload: NotificationPayload): Promise<void> {
  const webhookUrl = await getDiscordWebhookUrl();
  if (!webhookUrl) {
    throw new Error('Discord webhook URL not configured or invalid');
  }

  const colorMap: Record<string, number> = {
    critical: 0xef4444, warning: 0xeab308, info: 0x3b82f6,
  };
  const color = colorMap[payload.severity] ?? 0x22c55e;

  const embed = {
    title: payload.title,
    description: payload.body,
    color,
    fields: [
      ...(payload.containerName ? [{ name: 'Container', value: payload.containerName, inline: true }] : []),
      ...(payload.endpointId ? [{ name: 'Endpoint', value: String(payload.endpointId), inline: true }] : []),
      { name: 'Severity', value: payload.severity, inline: true },
    ],
    timestamp: new Date().toISOString(),
  };

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'Unknown error');
    throw new Error(`Discord webhook failed (${response.status}): ${text}`);
  }

  await logNotification('discord', payload, 'sent');
  log.info({ title: payload.title }, 'Discord notification sent');
}

export async function sendTelegramNotification(payload: NotificationPayload): Promise<void> {
  return withSpan('telegram.notify', 'telegram-notification', 'client', () =>
    sendTelegramNotificationInner(payload),
  );
}

async function sendTelegramNotificationInner(payload: NotificationPayload): Promise<void> {
  const config = getConfig();
  const token = await getSettingValue('notifications.telegram_bot_token') || config.TELEGRAM_BOT_TOKEN;
  const chatId = await getSettingValue('notifications.telegram_chat_id') || config.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error('Telegram bot token or chat ID not configured');
  }
  if (!validateTelegramToken(token)) {
    throw new Error('Telegram bot token format is invalid');
  }

  const emojiMap: Record<string, string> = {
    critical: '\u{1F534}', warning: '\u{1F7E1}', info: '\u{1F535}',
  };
  const emoji = emojiMap[payload.severity] ?? '\u{1F7E2}';

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const text = [
    `${emoji} <b>${esc(payload.title)}</b>`,
    '',
    esc(payload.body),
    '',
    ...(payload.containerName ? [`<b>Container:</b> ${esc(payload.containerName)}`] : []),
    ...(payload.endpointId ? [`<b>Endpoint:</b> ${payload.endpointId}`] : []),
    `<b>Severity:</b> ${esc(payload.severity)}`,
    `<b>Time:</b> ${new Date().toISOString()}`,
  ].join('\n');

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Telegram API failed (${response.status}): ${errText}`);
  }

  await logNotification('telegram', payload, 'sent');
  log.info({ title: payload.title }, 'Telegram notification sent');
}

function isRateLimited(containerId: string | null | undefined, eventType: string): boolean {
  if (!containerId) return false;
  const key = `${containerId}:${eventType}`;
  const lastSent = cooldownMap.get(key);
  if (!lastSent) return false;
  return Date.now() - lastSent < COOLDOWN_MS;
}

function recordSent(containerId: string | null | undefined, eventType: string): void {
  if (!containerId) return;
  const key = `${containerId}:${eventType}`;
  cooldownMap.set(key, Date.now());
}

export async function notifyInsight(insight: Insight): Promise<void> {
  const eventType = insight.category.startsWith('security:') ? 'security' : insight.category === 'anomaly' ? 'anomaly' : 'state_change';

  if (isRateLimited(insight.container_id, eventType)) {
    log.debug({ containerId: insight.container_id, eventType }, 'Notification rate-limited');
    return;
  }

  const payload: NotificationPayload = {
    title: insight.title,
    body: insight.description,
    severity: insight.severity,
    containerId: insight.container_id,
    containerName: insight.container_name,
    endpointId: insight.endpoint_id,
    eventType,
  };

  const errors: string[] = [];
  let successCount = 0;

  if (await isChannelEnabled('teams')) {
    try {
      await sendTeamsNotification(payload);
      successCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`teams: ${msg}`);
      await logNotification('teams', payload, 'failed', msg);
      log.warn({ err }, 'Teams notification failed');
    }
  }

  if (await isChannelEnabled('email')) {
    try {
      await sendEmailNotification(payload);
      successCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`email: ${msg}`);
      await logNotification('email', payload, 'failed', msg);
      log.warn({ err }, 'Email notification failed');
    }
  }

  if (await isChannelEnabled('discord')) {
    try {
      await sendDiscordNotification(payload);
      successCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`discord: ${msg}`);
      await logNotification('discord', payload, 'failed', msg);
      log.warn({ err }, 'Discord notification failed');
    }
  }

  if (await isChannelEnabled('telegram')) {
    try {
      await sendTelegramNotification(payload);
      successCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`telegram: ${msg}`);
      await logNotification('telegram', payload, 'failed', msg);
      log.warn({ err }, 'Telegram notification failed');
    }
  }

  // Only record cooldown if at least one notification was delivered
  if (successCount > 0) {
    recordSent(insight.container_id, eventType);
  }
}

export async function sendTestNotification(channel: 'teams' | 'email' | 'discord' | 'telegram'): Promise<{ success: boolean; error?: string }> {
  const payload: NotificationPayload = {
    title: 'Test Notification',
    body: 'This is a test notification from AI Portainer Dashboard. If you see this, your notification channel is configured correctly.',
    severity: 'info',
    eventType: 'test',
  };

  try {
    if (channel === 'teams') {
      await sendTeamsNotification(payload);
    } else if (channel === 'discord') {
      await sendDiscordNotification(payload);
    } else if (channel === 'telegram') {
      await sendTelegramNotification(payload);
    } else {
      await sendEmailNotification(payload);
    }
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logNotification(channel, payload, 'failed', msg);
    return { success: false, error: msg };
  }
}

// Exported for testing
export function _resetCooldownMap(): void {
  cooldownMap.clear();
}

export function _getCooldownMap(): Map<string, number> {
  return cooldownMap;
}
