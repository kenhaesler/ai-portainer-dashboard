import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getTestDb, truncateTestTables, closeTestDb } from '../db/test-db-helper.js';
import type { AppDb } from '../db/app-db.js';
import { syncUserGroups, listDiscoveredGroups } from './oidc-group-tracking.js';

describe('oidc-group-tracking', () => {
  let db: AppDb;

  beforeAll(async () => {
    db = await getTestDb();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  beforeEach(async () => {
    await truncateTestTables('oidc_user_groups');
  });

  describe('syncUserGroups', () => {
    it('inserts rows on first login', async () => {
      await syncUserGroups('user-1', ['Admins', 'Devs']);

      const rows = await db.query<{ user_sub: string; group_name: string }>(
        'SELECT user_sub, group_name FROM oidc_user_groups ORDER BY group_name',
      );

      expect(rows).toEqual([
        { user_sub: 'user-1', group_name: 'Admins' },
        { user_sub: 'user-1', group_name: 'Devs' },
      ]);
    });

    it('refreshes last_seen_at on repeat login without duplicating rows', async () => {
      await syncUserGroups('user-1', ['Admins']);

      const [before] = await db.query<{ last_seen_at: string }>(
        'SELECT last_seen_at FROM oidc_user_groups WHERE user_sub = ? AND group_name = ?',
        ['user-1', 'Admins'],
      );

      await new Promise((r) => setTimeout(r, 10));
      await syncUserGroups('user-1', ['Admins']);

      const after = await db.query<{ last_seen_at: string }>(
        'SELECT last_seen_at FROM oidc_user_groups WHERE user_sub = ? AND group_name = ?',
        ['user-1', 'Admins'],
      );

      expect(after).toHaveLength(1);
      expect(new Date(after[0].last_seen_at).getTime()).toBeGreaterThan(
        new Date(before.last_seen_at).getTime(),
      );
    });

    it('removes rows for groups the user no longer claims', async () => {
      await syncUserGroups('user-1', ['Admins', 'Devs']);
      await syncUserGroups('user-1', ['Admins']);

      const rows = await db.query<{ group_name: string }>(
        'SELECT group_name FROM oidc_user_groups WHERE user_sub = ?',
        ['user-1'],
      );

      expect(rows).toEqual([{ group_name: 'Admins' }]);
    });

    it('strips URI prefixes before storage', async () => {
      await syncUserGroups('user-1', [
        'urn:pingidentity.com:groups:G-Admins',
        'https://idp.example.com/groups/G-Devs',
      ]);

      const rows = await db.query<{ group_name: string }>(
        'SELECT group_name FROM oidc_user_groups ORDER BY group_name',
      );

      expect(rows.map((r) => r.group_name)).toEqual(['G-Admins', 'G-Devs']);
    });

    it('deduplicates groups that collapse to the same stripped name', async () => {
      await syncUserGroups('user-1', [
        'urn:pingidentity.com:groups:G-Admins',
        'G-Admins',
      ]);

      const rows = await db.query(
        'SELECT * FROM oidc_user_groups WHERE user_sub = ?',
        ['user-1'],
      );

      expect(rows).toHaveLength(1);
    });

    it('is a no-op for an empty group list and still clears prior rows', async () => {
      await syncUserGroups('user-1', ['Admins']);
      await syncUserGroups('user-1', []);

      const rows = await db.query(
        'SELECT * FROM oidc_user_groups WHERE user_sub = ?',
        ['user-1'],
      );

      expect(rows).toHaveLength(0);
    });
  });

  describe('listDiscoveredGroups', () => {
    it('aggregates distinct user counts and most-recent last_seen_at', async () => {
      await syncUserGroups('user-1', ['Admins', 'Devs']);
      await syncUserGroups('user-2', ['Admins']);
      await syncUserGroups('user-3', ['Devs']);

      const result = await listDiscoveredGroups();

      const admins = result.find((g) => g.group_name === 'Admins')!;
      const devs = result.find((g) => g.group_name === 'Devs')!;

      expect(admins.user_count).toBe(2);
      expect(devs.user_count).toBe(2);
      expect(typeof admins.last_seen_at).toBe('string');
    });

    it('orders by last_seen_at DESC then group_name ASC', async () => {
      await syncUserGroups('user-1', ['Zeta']);
      await new Promise((r) => setTimeout(r, 5));
      await syncUserGroups('user-1', ['Zeta', 'Alpha']);

      const result = await listDiscoveredGroups();

      // Zeta and Alpha both updated in the second call → identical last_seen_at,
      // so alphabetical wins between them.
      expect(result.map((g) => g.group_name)).toEqual(['Alpha', 'Zeta']);
    });

    it('returns an empty array when no groups have been observed', async () => {
      const result = await listDiscoveredGroups();
      expect(result).toEqual([]);
    });
  });
});
