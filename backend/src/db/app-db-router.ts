/**
 * AppDb Router — returns the PostgreSQL database adapter per domain.
 *
 * All domains now use PostgreSQL. The router is retained so callers
 * can continue using `getDbForDomain(domain)` without changes.
 *
 * Domains group related tables:
 * - 'traces': spans
 * - 'audit': audit_log
 * - 'llm-traces': llm_traces
 * - 'monitoring': monitoring_cycles, monitoring_snapshots
 * - 'notifications': notification_log
 * - 'auth': sessions, users
 * - 'settings': settings
 * - 'insights': insights
 * - 'actions': actions
 * - 'investigations': investigations
 * - 'incidents': incidents
 * - 'webhooks': webhooks, webhook_deliveries
 * - 'pcap': pcap_captures
 * - 'feedback': llm_feedback, llm_prompt_suggestions
 * - 'mcp': mcp_servers
 * - 'prompts': prompt_profiles
 * - 'ebpf': ebpf_coverage
 * - 'image-staleness': image_staleness
 * - 'status-page': status_page_*
 * - 'reports': reports, infrastructure_patterns
 * - 'backup': backup metadata
 * - 'remediation': remediation-related
 */
import type { AppDb } from './app-db.js';
import { PostgresAdapter } from './postgres-adapter.js';

export type AppDbDomain =
  | 'traces' | 'audit' | 'llm-traces' | 'monitoring' | 'notifications'
  | 'auth' | 'settings' | 'insights' | 'actions' | 'investigations' | 'incidents'
  | 'webhooks' | 'pcap' | 'feedback' | 'mcp' | 'prompts' | 'ebpf'
  | 'image-staleness' | 'status-page' | 'reports' | 'backup' | 'remediation';

// Singleton adapter (reused across all calls)
let pgAdapter: PostgresAdapter | null = null;

function getPgAdapter(): PostgresAdapter {
  if (!pgAdapter) pgAdapter = new PostgresAdapter();
  return pgAdapter;
}

/**
 * Get the database adapter for a given domain.
 * All domains use PostgreSQL.
 */
export function getDbForDomain(_domain: AppDbDomain): AppDb {
  return getPgAdapter();
}
