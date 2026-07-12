/**
 * DB-backed tests for getSettingsByKeys (#1506) — the single-query batch
 * lookup used by the public status page config instead of N getSetting calls.
 *
 * Run with:
 *   POSTGRES_TEST_URL=postgresql://app_user:changeme-postgres-app@localhost:5433/portainer_dashboard_test \
 *   npx vitest run src/services/settings-store-batch.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { getTestDb, truncateTestTables, closeTestDb } from '../db/test-db-helper.js';
import type { AppDb } from '../db/app-db.js';

let testDb: AppDb;

vi.mock('../db/app-db-router.js', () => ({
  getDbForDomain: () => testDb,
}));

const { getSettingsByKeys, setSetting } = await import('./settings-store.js');

describe('getSettingsByKeys', () => {
  beforeAll(async () => {
    testDb = await getTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await truncateTestTables('settings');
  });

  it('returns an empty array for an empty key list without querying', async () => {
    expect(await getSettingsByKeys([])).toEqual([]);
  });

  it('fetches only the requested keys in one query', async () => {
    await setSetting('status.page.enabled', 'true', 'status_page');
    await setSetting('status.page.title', 'Fleet Status', 'status_page');
    await setSetting('unrelated.key', 'x', 'general');

    const rows = await getSettingsByKeys(['status.page.enabled', 'status.page.title']);

    expect(rows).toHaveLength(2);
    const byKey = new Map(rows.map((row) => [row.key, row.value]));
    expect(byKey.get('status.page.enabled')).toBe('true');
    expect(byKey.get('status.page.title')).toBe('Fleet Status');
    expect(byKey.has('unrelated.key')).toBe(false);
  });

  it('silently omits missing keys', async () => {
    await setSetting('status.page.enabled', 'false', 'status_page');

    const rows = await getSettingsByKeys(['status.page.enabled', 'status.page.does_not_exist']);

    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe('status.page.enabled');
  });
});
