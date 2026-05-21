import { getDbForDomain } from '../db/app-db-router.js';
import { stripGroupPrefix } from './oidc.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('oidc-group-tracking');

export interface DiscoveredOidcGroup {
  group_name: string;
  user_count: number;
  last_seen_at: string;
}

/**
 * Sync the set of groups currently claimed by an OIDC user.
 *
 * Runs inside a single transaction:
 *  1. Strip URI prefixes from incoming groups (deduping the result).
 *  2. Upsert each (userSub, group) pair, refreshing last_seen_at.
 *  3. Delete rows whose group_name is no longer in the current claim set,
 *     so leaving a group is reflected on the next login.
 *
 * Callers should treat failures as non-fatal — group tracking is a UX
 * affordance, not a security control.
 */
export async function syncUserGroups(userSub: string, rawGroups: string[]): Promise<void> {
  const stripped = Array.from(
    new Set(
      rawGroups
        .map((g) => stripGroupPrefix(g).trim())
        .filter((g) => g.length > 0),
    ),
  );

  const db = getDbForDomain('auth');
  await db.transaction(async (tx) => {
    for (const group of stripped) {
      await tx.execute(
        `INSERT INTO oidc_user_groups (user_sub, group_name)
         VALUES (?, ?)
         ON CONFLICT (user_sub, group_name)
         DO UPDATE SET last_seen_at = NOW()`,
        [userSub, group],
      );
    }

    if (stripped.length === 0) {
      await tx.execute('DELETE FROM oidc_user_groups WHERE user_sub = ?', [userSub]);
    } else {
      // Build the NOT IN clause dynamically because the AppDb adapter expands `?`
      // placeholders positionally and does not support array params natively.
      const placeholders = stripped.map(() => '?').join(', ');
      await tx.execute(
        `DELETE FROM oidc_user_groups
         WHERE user_sub = ?
           AND group_name NOT IN (${placeholders})`,
        [userSub, ...stripped],
      );
    }
  });

  log.debug({ userSub, groupCount: stripped.length }, 'Synced OIDC user groups');
}

/**
 * Aggregate the oidc_user_groups table into the response shape consumed by
 * the Settings → Security group dropdown.
 *
 * Sort: most-recently-seen first, then alphabetical by group name.
 * COUNT(*) is cast to integer per project convention (pg returns bigint as
 * string otherwise).
 */
export async function listDiscoveredGroups(): Promise<DiscoveredOidcGroup[]> {
  const db = getDbForDomain('auth');
  const rows = await db.query<{
    group_name: string;
    user_count: number;
    last_seen_at: string;
  }>(
    `SELECT group_name,
            COUNT(DISTINCT user_sub)::integer AS user_count,
            MAX(last_seen_at)                 AS last_seen_at
     FROM oidc_user_groups
     GROUP BY group_name
     ORDER BY last_seen_at DESC, group_name ASC`,
  );
  return rows;
}
