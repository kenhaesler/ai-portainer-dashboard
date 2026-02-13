import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getConfig } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createChildLogger('sqlite');

let db: Database.Database | null = null;
let walCheckpointTimer: ReturnType<typeof setInterval> | null = null;

const LEGACY_MIGRATION_ALIASES: Record<string, string[]> = {
  '010_notification_log.sql': ['009_notification_log.sql'],
  '011_pcap_captures.sql': ['010_pcap_captures.sql'],
  '012_monitoring_telemetry.sql': ['011_monitoring_telemetry.sql'],
  '013_webhooks.sql': ['011_webhooks.sql'],
  '014_incidents.sql': ['012_incidents.sql'],
  '015_users.sql': ['012_users.sql'],
  '016_default_landing_page.sql': ['013_default_landing_page.sql'],
  '017_kpi_snapshots.sql': ['013_kpi_snapshots.sql'],
  '018_image_staleness.sql': ['014_image_staleness.sql'],
  '019_llm_traces.sql': ['014_llm_traces.sql'],
  '020_network_metrics.sql': ['015_network_metrics.sql'],
  '021_drop_llm_feedback.sql': ['016_drop_llm_feedback.sql'],
  '022_trace_source.sql': ['017_trace_source.sql'],
  '023_investigation_ai_summary.sql': ['018_investigation_ai_summary.sql'],
  '024_security_audit_ignore_list.sql': ['019_security_audit_ignore_list.sql'],
  '025_actions_pending_unique.sql': ['020_actions_pending_unique.sql'],
  '026_pcap_analysis.sql': ['021_pcap_analysis.sql'],
  '027_pcap_fix_status_constraint.sql': ['022_pcap_fix_status_constraint.sql'],
  '028_ebpf_coverage.sql': ['023_ebpf_coverage.sql'],
  '029_mcp_servers.sql': ['024_mcp_servers.sql'],
  '030_prompt_defaults.sql': ['025_prompt_defaults.sql'],
  '031_ebpf_coverage_statuses.sql': ['026_ebpf_coverage_statuses.sql'],
  '032_prompt_profiles.sql': ['026_prompt_profiles.sql'],
  '033_llm_feedback.sql': ['027_llm_feedback.sql'],
  '034_feedback_context.sql': ['028_feedback_context.sql'],
  '035_ebpf_beyla_lifecycle.sql': ['029_ebpf_beyla_lifecycle.sql'],
  '036_trace_typed_otlp_attributes.sql': ['029_trace_typed_otlp_attributes.sql'],
  '037_ebpf_otlp_endpoint_override.sql': ['030_ebpf_otlp_endpoint_override.sql'],
  '038_trace_extended_beyla_attributes.sql': ['031_trace_extended_beyla_attributes.sql'],
  '039_update_builtin_profile_prompts.sql': ['032_update_builtin_profile_prompts.sql'],
  '040_reports_infrastructure_patterns.sql': ['033_reports_infrastructure_patterns.sql'],
};

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

    // Performance pragmas
    db.pragma('cache_size = -64000'); // 64MB cache (negative = KB)
    db.pragma('temp_store = MEMORY'); // Temp tables in RAM
    db.pragma('mmap_size = 268435456'); // 256MB memory-mapped I/O

    log.info({ path: config.SQLITE_PATH }, 'SQLite database opened in WAL mode');

    runMigrations(db);

    // Periodic WAL checkpoint to prevent unbounded WAL growth
    walCheckpointTimer = setInterval(() => {
      try {
        db?.pragma('wal_checkpoint(TRUNCATE)');
      } catch {
        // Ignore checkpoint errors (e.g. if db is closing)
      }
    }, 5 * 60 * 1000); // Every 5 minutes
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
  const markApplied = database.prepare('INSERT INTO _migrations (name) VALUES (?)');

  for (const file of files) {
    if (applied.has(file)) continue;

    const legacyAliases = LEGACY_MIGRATION_ALIASES[file] ?? [];
    if (legacyAliases.some((legacyName) => applied.has(legacyName))) {
      log.info({ migration: file, aliases: legacyAliases }, 'Legacy migration alias detected, marking as applied');
      markApplied.run(file);
      applied.add(file);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    log.info({ migration: file }, 'Applying migration');

    database.exec(sql);
    markApplied.run(file);
    applied.add(file);

    log.info({ migration: file }, 'Migration applied');
  }
}

/**
 * Cached prepared statement helper.
 * Lazily prepares and caches statements by SQL string to avoid
 * repeated parsing on hot paths. The cache is cleared when the DB is closed.
 */
const stmtCache = new Map<string, Database.Statement>();

export function prepareStmt<BindParams extends unknown[] = unknown[]>(
  sql: string,
): Database.Statement<BindParams> {
  let stmt = stmtCache.get(sql);
  if (!stmt) {
    stmt = getDb().prepare(sql);
    stmtCache.set(sql, stmt);
  }
  return stmt as Database.Statement<BindParams>;
}

export function closeDb() {
  if (walCheckpointTimer) {
    clearInterval(walCheckpointTimer);
    walCheckpointTimer = null;
  }
  stmtCache.clear();
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
