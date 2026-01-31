import { getDb } from '../db/sqlite.js';
import { createChildLogger } from '../utils/logger.js';
import type { Setting } from '../models/settings.js';

const log = createChildLogger('settings-store');

export function getSetting(key: string): Setting | undefined {
  const db = getDb();
  return db
    .prepare('SELECT * FROM settings WHERE key = ?')
    .get(key) as Setting | undefined;
}

export function setSetting(key: string, value: string, category: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO settings (key, value, category, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      category = excluded.category,
      updated_at = datetime('now')
  `).run(key, value, category);

  log.debug({ key, category }, 'Setting saved');
}

export function getSettings(category?: string): Setting[] {
  const db = getDb();

  if (category) {
    return db
      .prepare('SELECT * FROM settings WHERE category = ? ORDER BY key ASC')
      .all(category) as Setting[];
  }

  return db
    .prepare('SELECT * FROM settings ORDER BY category ASC, key ASC')
    .all() as Setting[];
}

export function deleteSetting(key: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM settings WHERE key = ?').run(key);

  if (result.changes > 0) {
    log.info({ key }, 'Setting deleted');
    return true;
  }
  return false;
}
