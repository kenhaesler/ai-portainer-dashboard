import crypto from 'node:crypto';
import { getDbForDomain } from '@dashboard/core/db/app-db-router.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import { eventBus } from '@dashboard/core/services/typed-event-bus.js';
import { getSetting } from '@dashboard/core/services/settings-store.js';
import { toWebhookEvent, type WebhookEvent } from '@dashboard/contracts';
import { withSpan } from '@dashboard/core/tracing/trace-context.js';
import { validateOutboundWebhookUrl } from '@dashboard/core/utils/network-security.js';

const log = createChildLogger('webhook-service');

function db() {
  return getDbForDomain('webhooks');
}

export interface Webhook {
  id: string;
  name: string;
  url: string;
  secret: string;
  events: string[]; // JSONB returns native array (pg driver auto-parses)
  enabled: boolean;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebhookDelivery {
  id: string;
  webhook_id: string;
  event_type: string;
  /** Stored as JSONB — the pg driver returns an object, not the original string. */
  payload: string | Record<string, unknown>;
  status: string;
  http_status: number | null;
  response_body: string | null;
  attempt: number;
  max_attempts: number;
  next_retry_at: string | null;
  delivered_at: string | null;
  created_at: string;
}

export interface CreateWebhookInput {
  name: string;
  url: string;
  secret?: string;
  events: string[];
  enabled?: boolean;
  description?: string;
}

export interface UpdateWebhookInput {
  name?: string;
  url?: string;
  secret?: string;
  events?: string[];
  enabled?: boolean;
  description?: string;
}

function generateSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function signPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

// --- CRUD ---

export async function createWebhook(input: CreateWebhookInput): Promise<Webhook> {
  const id = crypto.randomUUID();
  const secret = input.secret || generateSecret();
  const events = JSON.stringify(input.events);

  await db().execute(`
    INSERT INTO webhooks (id, name, url, secret, events, enabled, description)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [id, input.name, input.url, secret, events, input.enabled !== false, input.description ?? null]);

  return (await getWebhookById(id))!;
}

export async function getWebhookById(id: string): Promise<Webhook | undefined> {
  const row = await db().queryOne<Webhook>('SELECT * FROM webhooks WHERE id = ?', [id]);
  return row ?? undefined;
}

export async function listWebhooks(): Promise<Webhook[]> {
  return db().query<Webhook>('SELECT * FROM webhooks ORDER BY created_at DESC');
}

export async function updateWebhook(id: string, input: UpdateWebhookInput): Promise<Webhook | undefined> {
  const existing = await getWebhookById(id);
  if (!existing) return undefined;

  const updates: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) { updates.push('name = ?'); values.push(input.name); }
  if (input.url !== undefined) { updates.push('url = ?'); values.push(input.url); }
  if (input.secret !== undefined) { updates.push('secret = ?'); values.push(input.secret); }
  if (input.events !== undefined) { updates.push('events = ?'); values.push(JSON.stringify(input.events)); }
  if (input.enabled !== undefined) { updates.push('enabled = ?'); values.push(input.enabled); }
  if (input.description !== undefined) { updates.push('description = ?'); values.push(input.description); }

  if (updates.length === 0) return existing;

  updates.push('updated_at = NOW()');
  values.push(id);

  await db().execute(`UPDATE webhooks SET ${updates.join(', ')} WHERE id = ?`, values);
  return getWebhookById(id);
}

export async function deleteWebhook(id: string): Promise<boolean> {
  const result = await db().execute('DELETE FROM webhooks WHERE id = ?', [id]);
  return result.changes > 0;
}

// --- Delivery ---

function getBackoffDelay(attempt: number): number {
  // Exponential backoff: 10s, 30s, 90s, 270s, 810s
  return Math.min(10 * Math.pow(3, attempt), 3600) * 1000;
}

export async function createDelivery(webhookId: string, event: WebhookEvent): Promise<string> {
  const id = crypto.randomUUID();
  const payload = JSON.stringify(event);

  const maxRetriesSetting = await getSetting('webhooks.max_retries');
  const maxRetries = maxRetriesSetting?.value ? parseInt(maxRetriesSetting.value, 10) : 5;

  await db().execute(`
    INSERT INTO webhook_deliveries (id, webhook_id, event_type, payload, status, attempt, max_attempts)
    VALUES (?, ?, ?, ?, 'pending', 0, ?)
  `, [id, webhookId, event.type, payload, maxRetries]);

  return id;
}

export async function deliverWebhook(deliveryId: string): Promise<boolean> {
  return withSpan('webhook.deliver', 'webhook-delivery', 'client', () =>
    deliverWebhookInner(deliveryId),
  );
}

async function deliverWebhookInner(deliveryId: string): Promise<boolean> {
  const delivery = await db().queryOne<WebhookDelivery>('SELECT * FROM webhook_deliveries WHERE id = ?', [deliveryId]);
  if (!delivery) return false;

  const webhook = await getWebhookById(delivery.webhook_id);
  if (!webhook) {
    await db().execute("UPDATE webhook_deliveries SET status = 'failed' WHERE id = ?", [deliveryId]);
    return false;
  }

  const attempt = delivery.attempt + 1;

  // SECURITY: re-validate the destination at delivery time, not just at
  // create/update — and BEFORE doing any other work. This covers rows stored
  // before the SSRF guard was hardened and blocks a webhook whose URL is (or
  // was repointed to) an internal / loopback / metadata target before we ever
  // issue the request.
  const urlError = validateOutboundWebhookUrl(webhook.url);
  if (urlError) {
    log.warn({ deliveryId, webhookId: webhook.id, reason: urlError }, 'Webhook delivery blocked: unsafe destination URL');
    await db().execute(
      "UPDATE webhook_deliveries SET status = 'failed', response_body = ?, attempt = ? WHERE id = ?",
      [`Blocked: ${urlError}`, attempt, deliveryId],
    );
    return false;
  }

  // payload is a JSONB column, so the pg driver hands back an object —
  // re-serialize and sign exactly the bytes we send, so the HMAC signature
  // always verifies against the delivered body.
  const payloadText = typeof delivery.payload === 'string'
    ? delivery.payload
    : JSON.stringify(delivery.payload);
  const signature = signPayload(payloadText, webhook.secret);

  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
        'X-Webhook-Event': delivery.event_type,
        'X-Webhook-Delivery': deliveryId,
        'User-Agent': 'AI-Portainer-Dashboard/1.0',
      },
      body: payloadText,
      signal: AbortSignal.timeout(10000),
      // SECURITY: never follow redirects — a public webhook host could 307 the
      // signed POST into a private/metadata target, bypassing the URL
      // validation above (which only sees the original destination).
      redirect: 'error',
    });

    const responseBody = await response.text().catch(() => '');

    if (response.ok) {
      await db().execute(`
        UPDATE webhook_deliveries
        SET status = 'delivered', http_status = ?, response_body = ?, attempt = ?, delivered_at = NOW()
        WHERE id = ?
      `, [response.status, responseBody.slice(0, 1000), attempt, deliveryId]);
      log.info({ deliveryId, webhookId: webhook.id, status: response.status }, 'Webhook delivered');
      return true;
    }

    // Failed but retryable
    if (attempt < delivery.max_attempts) {
      const delayMs = getBackoffDelay(attempt);
      const nextRetry = new Date(Date.now() + delayMs).toISOString();
      await db().execute(`
        UPDATE webhook_deliveries
        SET status = 'retrying', http_status = ?, response_body = ?, attempt = ?, next_retry_at = ?
        WHERE id = ?
      `, [response.status, responseBody.slice(0, 1000), attempt, nextRetry, deliveryId]);
      log.warn({ deliveryId, attempt, nextRetry, httpStatus: response.status }, 'Webhook delivery failed, will retry');
    } else {
      await db().execute(`
        UPDATE webhook_deliveries
        SET status = 'failed', http_status = ?, response_body = ?, attempt = ?
        WHERE id = ?
      `, [response.status, responseBody.slice(0, 1000), attempt, deliveryId]);
      log.error({ deliveryId, attempt, httpStatus: response.status }, 'Webhook delivery permanently failed');
    }
    return false;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    if (attempt < delivery.max_attempts) {
      const delayMs = getBackoffDelay(attempt);
      const nextRetry = new Date(Date.now() + delayMs).toISOString();
      await db().execute(`
        UPDATE webhook_deliveries
        SET status = 'retrying', response_body = ?, attempt = ?, next_retry_at = ?
        WHERE id = ?
      `, [errorMsg.slice(0, 1000), attempt, nextRetry, deliveryId]);
      log.warn({ deliveryId, attempt, err: errorMsg }, 'Webhook delivery error, will retry');
    } else {
      await db().execute(`
        UPDATE webhook_deliveries
        SET status = 'failed', response_body = ?, attempt = ?
        WHERE id = ?
      `, [errorMsg.slice(0, 1000), attempt, deliveryId]);
      log.error({ deliveryId, attempt, err: errorMsg }, 'Webhook delivery permanently failed');
    }
    return false;
  }
}

export async function getPendingRetries(): Promise<WebhookDelivery[]> {
  return db().query<WebhookDelivery>(`
    SELECT * FROM webhook_deliveries
    WHERE status = 'retrying' AND next_retry_at <= NOW()
    ORDER BY next_retry_at ASC
    LIMIT 50
  `);
}

export async function getDeliveriesForWebhook(webhookId: string, limit = 50, offset = 0): Promise<{ deliveries: WebhookDelivery[]; total: number }> {
  const deliveries = await db().query<WebhookDelivery>(`
    SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
  `, [webhookId, limit, offset]);

  const total = await db().queryOne<{ count: number }>('SELECT COUNT(*)::integer as count FROM webhook_deliveries WHERE webhook_id = ?', [webhookId]);

  return { deliveries, total: total?.count ?? 0 };
}

// --- Dispatch engine ---

export async function dispatchEvent(event: WebhookEvent): Promise<void> {
  const webhooks = (await listWebhooks()).filter((w) => w.enabled);

  for (const webhook of webhooks) {
    const subscribedEvents: string[] = webhook.events;
    const matches = subscribedEvents.some((pattern) => {
      if (pattern === '*') return true;
      if (pattern.endsWith('.*')) {
        const prefix = pattern.slice(0, -2);
        return event.type.startsWith(prefix + '.');
      }
      return pattern === event.type;
    });

    if (!matches) continue;

    const deliveryId = await createDelivery(webhook.id, event);

    // Fire and forget the delivery — errors are caught inside deliverWebhook
    deliverWebhook(deliveryId).catch((err) => {
      log.error({ err, deliveryId }, 'Unexpected error in webhook delivery');
    });
  }
}

export async function processRetries(): Promise<number> {
  const pending = await getPendingRetries();
  let processed = 0;

  for (const delivery of pending) {
    await deliverWebhook(delivery.id);
    processed++;
  }

  return processed;
}

// --- Event listener ---

let unsubscribe: (() => void) | null = null;

export function startWebhookListener(): void {
  if (unsubscribe) return;
  unsubscribe = eventBus.onAny((event) => {
    const webhookEvent = toWebhookEvent(event);
    dispatchEvent(webhookEvent).catch((err) => {
      log.error({ err, eventType: webhookEvent.type }, 'Failed to dispatch webhook event');
    });
  });
  log.info('Webhook event listener started');
}

export function stopWebhookListener(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
    log.info('Webhook event listener stopped');
  }
}
