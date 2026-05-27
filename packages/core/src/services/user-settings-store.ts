/**
 * Per-user key/value preferences (issue #1297).
 *
 * Backs the `user_settings` table introduced in migration 036. Each row is
 * scoped to a single user; nothing here is admin-readable across users —
 * that's a deliberate isolation (callers always look up the row for the
 * current request.user.sub, never another user's id).
 */
import { getDbForDomain } from '../db/app-db-router.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('user-settings-store');

function db() {
  return getDbForDomain('settings');
}

interface UserSettingRow {
  user_id: string;
  key: string;
  value: string;
  updated_at: string;
}

/**
 * Returns the raw string `value` for (userId, key), or null if unset.
 *
 * Callers MUST validate the returned string against their own Zod schema
 * before trusting it — the store does no semantic validation by design,
 * so that adding a new preference key doesn't require a store update.
 */
export async function getUserSetting(
  userId: string,
  key: string,
): Promise<string | null> {
  const row = await db().queryOne<UserSettingRow>(
    'SELECT value FROM user_settings WHERE user_id = ? AND key = ?',
    [userId, key],
  );
  return row?.value ?? null;
}

/**
 * Upserts (userId, key, value). Uses parameterized SQL — the caller is
 * responsible for validating `value` (e.g. via Zod) before calling.
 */
export async function setUserSetting(
  userId: string,
  key: string,
  value: string,
): Promise<void> {
  await db().execute(
    `INSERT INTO user_settings (user_id, key, value, updated_at)
     VALUES (?, ?, ?, NOW())
     ON CONFLICT (user_id, key) DO UPDATE SET
       value = EXCLUDED.value,
       updated_at = NOW()`,
    [userId, key, value],
  );
  log.debug({ userId, key }, 'User setting saved');
}

/**
 * Deletes a single (userId, key) row. Used by tests and account cleanup.
 */
export async function deleteUserSetting(
  userId: string,
  key: string,
): Promise<void> {
  await db().execute(
    'DELETE FROM user_settings WHERE user_id = ? AND key = ?',
    [userId, key],
  );
}
