/**
 * AppDb Router — returns the correct database adapter per domain.
 *
 * During the incremental migration, some domains use SQLite and others use PostgreSQL.
 * Once all domains are migrated, the router returns PostgreSQL for everything.
 * In Phase 4 cleanup (#654), this file is deleted and services call getAppDb() directly.
 *
 * Domains group related tables that must be migrated together:
 * - 'traces': spans (Phase 1)
 * - 'audit': audit_log (Phase 1)
 * - 'llm-traces': llm_traces (Phase 1)
 * - 'monitoring': monitoring_cycles, monitoring_snapshots (Phase 1)
 * - 'notifications': notification_log (Phase 1)
 * - 'auth': sessions, users (Phase 2)
 * - 'settings': settings (Phase 2)
 * - 'insights': insights (Phase 2)
 * - 'actions': actions (Phase 2)
 * - 'investigations': investigations (Phase 2)
 * - 'incidents': incidents (Phase 2)
 * - 'webhooks': webhooks, webhook_deliveries (Phase 3)
 * - 'pcap': pcap_captures (Phase 3)
 * - 'feedback': llm_feedback, llm_prompt_suggestions (Phase 3)
 * - 'mcp': mcp_servers (Phase 3)
 * - 'prompts': prompt_profiles (Phase 3)
 * - 'ebpf': ebpf_coverage (Phase 3)
 * - 'image-staleness': image_staleness (Phase 3)
 * - 'status-page': status_page_* (Phase 3)
 * - 'reports': reports, infrastructure_patterns (Phase 3)
 * - 'backup': backup metadata (Phase 3)
 * - 'remediation': remediation-related (Phase 3)
 */
import type { AppDb } from './app-db.js';
import { SqliteAdapter } from './sqlite-adapter.js';
import { PostgresAdapter } from './postgres-adapter.js';

export type AppDbDomain =
  | 'traces' | 'audit' | 'llm-traces' | 'monitoring' | 'notifications'
  | 'auth' | 'settings' | 'insights' | 'actions' | 'investigations' | 'incidents'
  | 'webhooks' | 'pcap' | 'feedback' | 'mcp' | 'prompts' | 'ebpf'
  | 'image-staleness' | 'status-page' | 'reports' | 'backup' | 'remediation';

/**
 * Domains that have been migrated to PostgreSQL.
 * Add domains here as each phase completes.
 * Phase 1: traces, audit, llm-traces, monitoring, notifications
 * Phase 2: auth, settings, insights, actions, investigations, incidents
 * Phase 3: webhooks, pcap, feedback, mcp, prompts, ebpf, image-staleness, status-page, reports, backup, remediation
 */
const PG_DOMAINS: Set<AppDbDomain> = new Set([
  // Phase 1 — migrated
  'traces', 'audit', 'llm-traces', 'monitoring', 'notifications',
  // Phase 2 — migrated
  'auth', 'settings', 'insights', 'actions', 'investigations', 'incidents',
  // Phase 3 — uncomment after Phase 3 migration
  // 'webhooks', 'pcap', 'feedback', 'mcp', 'prompts', 'ebpf', 'image-staleness', 'status-page', 'reports', 'backup', 'remediation',
]);

// Singleton adapters (reused across all calls)
let sqliteAdapter: SqliteAdapter | null = null;
let pgAdapter: PostgresAdapter | null = null;

function getSqliteAdapter(): SqliteAdapter {
  if (!sqliteAdapter) sqliteAdapter = new SqliteAdapter();
  return sqliteAdapter;
}

function getPgAdapter(): PostgresAdapter {
  if (!pgAdapter) pgAdapter = new PostgresAdapter();
  return pgAdapter;
}

/**
 * Get the appropriate database adapter for a given domain.
 * Returns PostgreSQL adapter if the domain has been migrated, SQLite adapter otherwise.
 */
export function getDbForDomain(domain: AppDbDomain): AppDb {
  if (PG_DOMAINS.has(domain)) {
    return getPgAdapter();
  }
  return getSqliteAdapter();
}

/**
 * Check if a domain has been migrated to PostgreSQL.
 */
export function isDomainOnPostgres(domain: AppDbDomain): boolean {
  return PG_DOMAINS.has(domain);
}
