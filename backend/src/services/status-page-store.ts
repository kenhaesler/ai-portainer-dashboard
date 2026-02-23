import { getDbForDomain } from '../core/db/app-db-router.js';
import { getSetting } from '../core/services/settings-store.js';

export interface StatusPageConfig {
  enabled: boolean;
  title: string;
  description: string;
  showIncidents: boolean;
  autoRefreshSeconds: number;
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
  return {
    enabled: (await getSetting('status.page.enabled'))?.value === 'true',
    title: (await getSetting('status.page.title'))?.value || 'System Status',
    description: (await getSetting('status.page.description'))?.value || '',
    showIncidents: (await getSetting('status.page.show_incidents'))?.value !== 'false',
    autoRefreshSeconds: parseInt((await getSetting('status.page.refresh_interval'))?.value || '30', 10),
  };
}

export async function getOverallUptime(hours: number): Promise<number> {
  const monitoringDb = getDbForDomain('monitoring');
  const cutoff = new Date(Date.now() - hours * 3600_000).toISOString();

  const row = await monitoringDb.queryOne<{ total_running: number; total_all: number }>(`
    SELECT
      COALESCE(SUM(containers_running), 0) as total_running,
      COALESCE(SUM(containers_running + containers_stopped + containers_unhealthy), 0) as total_all
    FROM monitoring_snapshots
    WHERE created_at >= ?
  `, [cutoff]);

  if (!row || row.total_all === 0) return 100;
  return Math.round((row.total_running / row.total_all) * 10000) / 100;
}

export async function getEndpointUptime(hours: number): Promise<number> {
  const monitoringDb = getDbForDomain('monitoring');
  const cutoff = new Date(Date.now() - hours * 3600_000).toISOString();

  const row = await monitoringDb.queryOne<{ total_up: number; total_all: number }>(`
    SELECT
      COALESCE(SUM(endpoints_up), 0) as total_up,
      COALESCE(SUM(endpoints_up + endpoints_down), 0) as total_all
    FROM monitoring_snapshots
    WHERE created_at >= ?
  `, [cutoff]);

  if (!row || row.total_all === 0) return 100;
  return Math.round((row.total_up / row.total_all) * 10000) / 100;
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
      SUM(containers_running) as total_running,
      SUM(containers_running + containers_stopped + containers_unhealthy) as total_all
    FROM monitoring_snapshots
    WHERE created_at >= ?
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `, [cutoff]);

  return rows.map((row) => ({
    date: row.date,
    uptime_pct: row.total_all === 0 ? 100 : Math.round((row.total_running / row.total_all) * 10000) / 100,
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
