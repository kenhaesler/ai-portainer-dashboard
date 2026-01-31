import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getConfig } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createChildLogger('sqlite');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const config = getConfig();
    const dbDir = path.dirname(config.SQLITE_PATH);

    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    db = new Database(config.SQLITE_PATH);

    // Enable WAL mode for concurrent reads
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');

    log.info({ path: config.SQLITE_PATH }, 'SQLite database opened in WAL mode');

    runMigrations(db);
  }
  return db;
}

function runMigrations(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const migrationsDir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    log.info('No migrations directory found, skipping');
    return;
  }

  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied = new Set(
    database
      .prepare('SELECT name FROM _migrations')
      .all()
      .map((row: any) => row.name)
  );

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    log.info({ migration: file }, 'Applying migration');

    database.exec(sql);
    database.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);

    log.info({ migration: file }, 'Migration applied');
  }
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
    log.info('SQLite database closed');
  }
}

export function isDbHealthy(): boolean {
  try {
    const database = getDb();
    const result = database.prepare('SELECT 1 as ok').get() as { ok: number };
    return result.ok === 1;
  } catch {
    return false;
  }
}
