import { getDb } from '../db/sqlite.js';
import { getSetting } from './settings-store.js';

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

export function getStatusPageConfig(): StatusPageConfig {
  return {
    enabled: getSetting('status.page.enabled')?.value === 'true',
    title: getSetting('status.page.title')?.value || 'System Status',
    description: getSetting('status.page.description')?.value || '',
    showIncidents: getSetting('status.page.show_incidents')?.value !== 'false',
    autoRefreshSeconds: parseInt(getSetting('status.page.refresh_interval')?.value || '30', 10),
  };
}

export function getOverallUptime(hours: number): number {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(containers_running), 0) as total_running,
      COALESCE(SUM(containers_running + containers_stopped + containers_unhealthy), 0) as total_all
    FROM monitoring_snapshots
    WHERE created_at >= datetime('now', ?)
  `).get(`-${hours} hours`) as { total_running: number; total_all: number } | undefined;

  if (!row || row.total_all === 0) return 100;
  return Math.round((row.total_running / row.total_all) * 10000) / 100;
}

export function getEndpointUptime(hours: number): number {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(endpoints_up), 0) as total_up,
      COALESCE(SUM(endpoints_up + endpoints_down), 0) as total_all
    FROM monitoring_snapshots
    WHERE created_at >= datetime('now', ?)
  `).get(`-${hours} hours`) as { total_up: number; total_all: number } | undefined;

  if (!row || row.total_all === 0) return 100;
  return Math.round((row.total_up / row.total_all) * 10000) / 100;
}

export function getLatestSnapshot(): {
  containersRunning: number;
  containersStopped: number;
  containersUnhealthy: number;
  endpointsUp: number;
  endpointsDown: number;
  createdAt: string;
} | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT containers_running, containers_stopped, containers_unhealthy,
           endpoints_up, endpoints_down, created_at
    FROM monitoring_snapshots
    ORDER BY created_at DESC LIMIT 1
  `).get() as {
    containers_running: number;
    containers_stopped: number;
    containers_unhealthy: number;
    endpoints_up: number;
    endpoints_down: number;
    created_at: string;
  } | undefined;

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

export function getDailyUptimeBuckets(days: number): UptimeDayBucket[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      date(created_at) as date,
      SUM(containers_running) as total_running,
      SUM(containers_running + containers_stopped + containers_unhealthy) as total_all
    FROM monitoring_snapshots
    WHERE created_at >= datetime('now', ?)
    GROUP BY date(created_at)
    ORDER BY date ASC
  `).all(`-${days} days`) as Array<{
    date: string;
    total_running: number;
    total_all: number;
  }>;

  return rows.map((row) => ({
    date: row.date,
    uptime_pct: row.total_all === 0 ? 100 : Math.round((row.total_running / row.total_all) * 10000) / 100,
  }));
}

export function getRecentIncidentsPublic(limit: number = 10): Array<{
  id: string;
  title: string;
  severity: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
  summary: string | null;
}> {
  const db = getDb();
  return db.prepare(`
    SELECT id, title, severity, status, created_at, resolved_at, summary
    FROM incidents
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as Array<{
    id: string;
    title: string;
    severity: string;
    status: string;
    created_at: string;
    resolved_at: string | null;
    summary: string | null;
  }>;
}
