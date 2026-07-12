/**
 * Real-PostgreSQL tests for the notification_log / webhook_deliveries
 * retention sweeps (#1505).
 *
 * Run with:
 *   POSTGRES_TEST_URL=postgresql://app_user:...@localhost:5434/portainer_dashboard_test \
 *   npx vitest run src/__tests__/retention-cleanup.test.ts
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTestDb, truncateTestTables, closeTestDb } from '@dashboard/core/db/test-db-helper.js';
import type { AppDb } from '@dashboard/core/db/app-db.js';

let testDb: AppDb;

vi.mock('@dashboard/core/db/app-db-router.js', () => ({
  getDbForDomain: () => testDb,
}));

import { cleanOldNotificationLog } from '../services/notification-service.js';
import { cleanOldWebhookDeliveries } from '../services/webhook-service.js';

async function seedNotification(title: string, daysAgo: number): Promise<void> {
  await testDb.execute(
    `INSERT INTO notification_log (channel, event_type, title, body, created_at)
     VALUES ('teams', 'insight.created', ?, 'body', NOW() - make_interval(days => ?))`,
    [title, daysAgo],
  );
}

async function seedDelivery(id: string, daysAgo: number): Promise<void> {
  await testDb.execute(
    `INSERT INTO webhook_deliveries (id, webhook_id, event_type, payload, status, created_at)
     VALUES (?, 'wh-1', 'insight.created', '{}'::jsonb, 'success', NOW() - make_interval(days => ?))`,
    [id, daysAgo],
  );
}

beforeAll(async () => {
  testDb = await getTestDb();
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await truncateTestTables('notification_log', 'webhook_deliveries', 'webhooks');
  // Parent webhook for the FK on webhook_deliveries
  await testDb.execute(
    `INSERT INTO webhooks (id, name, url, secret) VALUES ('wh-1', 'test', 'https://example.com/hook', 's3cret')`,
  );
});

describe('cleanOldNotificationLog (#1505)', () => {
  it('prunes notification log entries past the retention window', async () => {
    await seedNotification('ancient', 45);
    await seedNotification('boundary-old', 31);
    await seedNotification('recent', 5);

    const deleted = await cleanOldNotificationLog(30);

    expect(deleted).toBe(2);
    const remaining = await testDb.query<{ title: string }>('SELECT title FROM notification_log');
    expect(remaining.map((r) => r.title)).toEqual(['recent']);
  });

  it('returns 0 on an already-clean table', async () => {
    await seedNotification('recent', 1);
    expect(await cleanOldNotificationLog(30)).toBe(0);
  });
});

describe('cleanOldWebhookDeliveries (#1505)', () => {
  it('prunes deliveries past the retention window regardless of status', async () => {
    await seedDelivery('d-old-success', 60);
    await seedDelivery('d-old-2', 31);
    await seedDelivery('d-recent', 2);
    // A stale pending row far past any retry backoff is dead weight too
    await testDb.execute(
      `INSERT INTO webhook_deliveries (id, webhook_id, event_type, payload, status, created_at)
       VALUES ('d-old-pending', 'wh-1', 'insight.created', '{}'::jsonb, 'pending', NOW() - make_interval(days => ?))`,
      [90],
    );

    const deleted = await cleanOldWebhookDeliveries(30);

    expect(deleted).toBe(3);
    const remaining = await testDb.query<{ id: string }>('SELECT id FROM webhook_deliveries');
    expect(remaining.map((r) => r.id)).toEqual(['d-recent']);
  });

  it('keeps everything inside the window', async () => {
    await seedDelivery('d-1', 10);
    await seedDelivery('d-2', 29);

    expect(await cleanOldWebhookDeliveries(30)).toBe(0);
    const remaining = await testDb.query<{ id: string }>('SELECT id FROM webhook_deliveries');
    expect(remaining).toHaveLength(2);
  });
});
