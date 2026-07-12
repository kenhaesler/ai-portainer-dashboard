import { getDbForDomain } from '@dashboard/core/db/app-db-router.js';
import { getSettingsByKeys } from '@dashboard/core/services/settings-store.js';

export interface StatusPageConfig {
  enabled: boolean;
  title: string;
  description: string;
  showIncidents: boolean;
  autoRefreshSeconds: number;
}

export interface UptimeWindows {
  '24h': number;
  '7d': number;
  '30d': number;
}

export interface UptimeSummary {
  containers: UptimeWindows;
  endpoints: UptimeWindows;
}

const STATUS_PAGE_SETTING_KEYS = [
  'status.page.enabled',
  'status.page.title',
  'status.page.description',
  'status.page.show_incidents',
  'status.page.refresh_interval',
];

/**
 * Uncast SUM()/COUNT() aggregates come back from pg as strings (bigint), so a
 * strict `total === 0` guard misses and `'0' / '0'` yields NaN on the public
 * status page (#1526). The queries below cast to ::integer, and this helper
 * coerces defensively so an empty window can never produce NaN.
 */
function uptimePct(part: unknown, total: unknown): number {
  const totalNum = Number(total);
  if (!Number.isFinite(totalNum) || totalNum === 0) return 100;
  return Math.round((Number(part) / totalNum) * 10000) / 100;
}

export interface ServiceStatus {
  container_name: string;
  container_id: string;
  endpoint_name: string;
  status: 'operational' | 'degraded' | 'down';
  last_checked: string;
  uptime_24h: number;
  uptime_7d: number;
  uptime_30d: number;
}

export interface UptimeDayBucket {
  date: string;
  uptime_pct: number;
}

export async function getStatusPageConfig(): Promise<StatusPageConfig> {
  // Single batched settings query instead of five sequential getSetting() calls (#1506)
  const rows = await getSettingsByKeys(STATUS_PAGE_SETTING_KEYS);
  const values = new Map(rows.map((row) => [row.key, row.value]));

  return {
    enabled: values.get('status.page.enabled') === 'true',
    title: values.get('status.page.title') || 'System Status',
    description: values.get('status.page.description') || '',
    showIncidents: values.get('status.page.show_incidents') !== 'false',
    autoRefreshSeconds: parseInt(values.get('status.page.refresh_interval') || '30', 10),
  };
}

export async function getOverallUptime(hours: number): Promise<number> {
  const monitoringDb = getDbForDomain('monitoring');
  const cutoff = new Date(Date.now() - hours * 3600_000).toISOString();

  const row = await monitoringDb.queryOne<{ total_running: number; total_all: number }>(`
    SELECT
      COALESCE(SUM(containers_running), 0)::integer as total_running,
      COALESCE(SUM(containers_running + containers_stopped + containers_unhealthy), 0)::integer as total_all
    FROM monitoring_snapshots
    WHERE created_at >= ?
  `, [cutoff]);

  return uptimePct(row?.total_running, row?.total_all);
}

export async function getEndpointUptime(hours: number): Promise<number> {
  const monitoringDb = getDbForDomain('monitoring');
  const cutoff = new Date(Date.now() - hours * 3600_000).toISOString();

  const row = await monitoringDb.queryOne<{ total_up: number; total_all: number }>(`
    SELECT
      COALESCE(SUM(endpoints_up), 0)::integer as total_up,
      COALESCE(SUM(endpoints_up + endpoints_down), 0)::integer as total_all
    FROM monitoring_snapshots
    WHERE created_at >= ?
  `, [cutoff]);

  return uptimePct(row?.total_up, row?.total_all);
}

/**
 * Container + endpoint uptime for the 24h/7d/30d windows in a single scan of
 * the 30-day superset window, using FILTER clauses for the narrower windows —
 * replaces six separate SUM queries on the public status page (#1506).
 */
export async function getUptimeSummary(): Promise<UptimeSummary> {
  const monitoringDb = getDbForDomain('monitoring');
  const now = Date.now();
  const cutoff24h = new Date(now - 24 * 3600_000).toISOString();
  const cutoff7d = new Date(now - 168 * 3600_000).toISOString();
  const cutoff30d = new Date(now - 720 * 3600_000).toISOString();

  const row = await monitoringDb.queryOne<{
    containers_running_24h: number;
    containers_all_24h: number;
    containers_running_7d: number;
    containers_all_7d: number;
    containers_running_30d: number;
    containers_all_30d: number;
    endpoints_up_24h: number;
    endpoints_all_24h: number;
    endpoints_up_7d: number;
    endpoints_all_7d: number;
    endpoints_up_30d: number;
    endpoints_all_30d: number;
  }>(`
    SELECT
      COALESCE(SUM(containers_running) FILTER (WHERE created_at >= ?), 0)::integer as containers_running_24h,
      COALESCE(SUM(containers_running + containers_stopped + containers_unhealthy) FILTER (WHERE created_at >= ?), 0)::integer as containers_all_24h,
      COALESCE(SUM(containers_running) FILTER (WHERE created_at >= ?), 0)::integer as containers_running_7d,
      COALESCE(SUM(containers_running + containers_stopped + containers_unhealthy) FILTER (WHERE created_at >= ?), 0)::integer as containers_all_7d,
      COALESCE(SUM(containers_running), 0)::integer as containers_running_30d,
      COALESCE(SUM(containers_running + containers_stopped + containers_unhealthy), 0)::integer as containers_all_30d,
      COALESCE(SUM(endpoints_up) FILTER (WHERE created_at >= ?), 0)::integer as endpoints_up_24h,
      COALESCE(SUM(endpoints_up + endpoints_down) FILTER (WHERE created_at >= ?), 0)::integer as endpoints_all_24h,
      COALESCE(SUM(endpoints_up) FILTER (WHERE created_at >= ?), 0)::integer as endpoints_up_7d,
      COALESCE(SUM(endpoints_up + endpoints_down) FILTER (WHERE created_at >= ?), 0)::integer as endpoints_all_7d,
      COALESCE(SUM(endpoints_up), 0)::integer as endpoints_up_30d,
      COALESCE(SUM(endpoints_up + endpoints_down), 0)::integer as endpoints_all_30d
    FROM monitoring_snapshots
    WHERE created_at >= ?
  `, [cutoff24h, cutoff24h, cutoff7d, cutoff7d, cutoff24h, cutoff24h, cutoff7d, cutoff7d, cutoff30d]);

  return {
    containers: {
      '24h': uptimePct(row?.containers_running_24h, row?.containers_all_24h),
      '7d': uptimePct(row?.containers_running_7d, row?.containers_all_7d),
      '30d': uptimePct(row?.containers_running_30d, row?.containers_all_30d),
    },
    endpoints: {
      '24h': uptimePct(row?.endpoints_up_24h, row?.endpoints_all_24h),
      '7d': uptimePct(row?.endpoints_up_7d, row?.endpoints_all_7d),
      '30d': uptimePct(row?.endpoints_up_30d, row?.endpoints_all_30d),
    },
  };
}

export async function getLatestSnapshot(): Promise<{
  containersRunning: number;
  containersStopped: number;
  containersUnhealthy: number;
  endpointsUp: number;
  endpointsDown: number;
  createdAt: string;
} | null> {
  const monitoringDb = getDbForDomain('monitoring');

  const row = await monitoringDb.queryOne<{
    containers_running: number;
    containers_stopped: number;
    containers_unhealthy: number;
    endpoints_up: number;
    endpoints_down: number;
    created_at: string;
  }>(`
    SELECT containers_running, containers_stopped, containers_unhealthy,
           endpoints_up, endpoints_down, created_at
    FROM monitoring_snapshots
    ORDER BY created_at DESC LIMIT 1
  `);

  if (!row) return null;

  return {
    containersRunning: row.containers_running,
    containersStopped: row.containers_stopped,
    containersUnhealthy: row.containers_unhealthy,
    endpointsUp: row.endpoints_up,
    endpointsDown: row.endpoints_down,
    createdAt: row.created_at,
  };
}

export async function getDailyUptimeBuckets(days: number): Promise<UptimeDayBucket[]> {
  const monitoringDb = getDbForDomain('monitoring');
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString();

  const rows = await monitoringDb.query<{
    date: string;
    total_running: number;
    total_all: number;
  }>(`
    SELECT
      DATE(created_at) as date,
      SUM(containers_running)::integer as total_running,
      SUM(containers_running + containers_stopped + containers_unhealthy)::integer as total_all
    FROM monitoring_snapshots
    WHERE created_at >= ?
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `, [cutoff]);

  return rows.map((row) => ({
    date: row.date,
    uptime_pct: uptimePct(row.total_running, row.total_all),
  }));
}

export async function getRecentIncidentsPublic(limit: number = 10): Promise<Array<{
  id: string;
  title: string;
  severity: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
  summary: string | null;
}>> {
  const incidentsDb = getDbForDomain('incidents');
  return incidentsDb.query(`
    SELECT id, title, severity, status, created_at, resolved_at, summary
    FROM incidents
    ORDER BY created_at DESC
    LIMIT ?
  `, [limit]);
}
