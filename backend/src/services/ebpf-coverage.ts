import { getDb, prepareStmt } from '../db/sqlite.js';
import { getEndpoints, getContainers } from './portainer-client.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('ebpf-coverage');

export type CoverageStatus = 'planned' | 'deployed' | 'excluded' | 'failed' | 'unknown';

export interface CoverageRecord {
  endpoint_id: number;
  endpoint_name: string;
  status: CoverageStatus;
  exclusion_reason: string | null;
  deployment_profile: string | null;
  last_trace_at: string | null;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CoverageSummary {
  total: number;
  deployed: number;
  planned: number;
  excluded: number;
  failed: number;
  unknown: number;
  coveragePercent: number;
}

/**
 * Returns coverage status for all endpoints by reading the ebpf_coverage table.
 */
export function getEndpointCoverage(): CoverageRecord[] {
  return prepareStmt(
    'SELECT * FROM ebpf_coverage ORDER BY endpoint_name ASC',
  ).all() as CoverageRecord[];
}

/**
 * Update an endpoint's eBPF coverage status.
 */
export function updateCoverageStatus(
  endpointId: number,
  status: CoverageStatus,
  reason?: string,
): void {
  prepareStmt(`
    UPDATE ebpf_coverage
    SET status = ?, exclusion_reason = ?, updated_at = datetime('now')
    WHERE endpoint_id = ?
  `).run(status, reason ?? null, endpointId);

  log.info({ endpointId, status, reason }, 'Coverage status updated');
}

/**
 * Detect Beyla status on a single endpoint by checking its containers.
 * Returns 'deployed' if a running beyla container exists, 'failed' if
 * one exists but is not running, or null if no beyla container found.
 */
async function detectBeylaOnEndpoint(endpointId: number): Promise<CoverageStatus | null> {
  try {
    const containers = await getContainers(endpointId, true);
    const beyla = containers.find((c) =>
      c.Image.toLowerCase().includes('grafana/beyla') ||
      c.Image.toLowerCase().includes('beyla'),
    );
    if (!beyla) return null;
    return beyla.State === 'running' ? 'deployed' : 'failed';
  } catch {
    // Endpoint unreachable — can't detect
    return null;
  }
}

/**
 * Sync coverage table with current endpoint inventory.
 * Adds new endpoints and auto-detects Beyla deployment status by
 * checking for grafana/beyla containers on each endpoint.
 * Preserves manually set 'excluded' and 'planned' states.
 * Returns the number of new endpoints added.
 */
export async function syncEndpointCoverage(): Promise<number> {
  const endpoints = await getEndpoints();
  const db = getDb();
  let added = 0;

  // Only query healthy (Status=1) endpoints for Beyla containers
  const upEndpoints = endpoints.filter((ep) => ep.Status === 1);

  // Detect Beyla on all up endpoints in parallel
  const detectionResults = await Promise.allSettled(
    upEndpoints.map(async (ep) => ({
      id: ep.Id,
      detected: await detectBeylaOnEndpoint(ep.Id),
    })),
  );

  const detectedMap = new Map<number, CoverageStatus>();
  for (const result of detectionResults) {
    if (result.status === 'fulfilled' && result.value.detected) {
      detectedMap.set(result.value.id, result.value.detected);
    }
  }

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO ebpf_coverage (endpoint_id, endpoint_name, status)
    VALUES (?, ?, ?)
  `);

  const updateNameStmt = db.prepare(`
    UPDATE ebpf_coverage SET endpoint_name = ?, updated_at = datetime('now')
    WHERE endpoint_id = ? AND endpoint_name != ?
  `);

  // Auto-update status only for endpoints currently 'unknown' or auto-detected states
  // Never overwrite manually set 'excluded' or 'planned'
  const autoUpdateStmt = db.prepare(`
    UPDATE ebpf_coverage
    SET status = ?, updated_at = datetime('now')
    WHERE endpoint_id = ? AND status IN ('unknown', 'deployed', 'failed')
  `);

  const txn = db.transaction(() => {
    for (const ep of endpoints) {
      const detected = detectedMap.get(ep.Id) ?? 'unknown';
      const result = insertStmt.run(ep.Id, ep.Name, detected);
      if (result.changes > 0) {
        added++;
      } else {
        updateNameStmt.run(ep.Name, ep.Id, ep.Name);
        // Auto-update status if we detected something
        if (detectedMap.has(ep.Id)) {
          autoUpdateStmt.run(detected, ep.Id);
        }
      }
    }
  });

  txn();

  log.info({ total: endpoints.length, added, detected: detectedMap.size }, 'Endpoint coverage synced');
  return added;
}

/**
 * Verify coverage for an endpoint by checking:
 * 1. Whether a Beyla container is running (live container check)
 * 2. Whether eBPF traces have been received recently (span query)
 * Updates status automatically based on findings.
 */
export async function verifyCoverage(endpointId: number): Promise<{ verified: boolean; lastTraceAt: string | null; beylaRunning: boolean }> {
  const db = getDb();

  // 1. Check for Beyla container on this endpoint
  const beylaStatus = await detectBeylaOnEndpoint(endpointId);
  const beylaRunning = beylaStatus === 'deployed';

  // 2. Check for recent eBPF spans
  const tableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='spans'",
  ).get();

  let lastTraceAt: string | null = null;

  if (tableExists) {
    const recentSpan = db.prepare(`
      SELECT start_time FROM spans
      WHERE trace_source = 'ebpf'
        AND start_time > datetime('now', '-10 minutes')
      ORDER BY start_time DESC
      LIMIT 1
    `).get() as { start_time: string } | undefined;

    lastTraceAt = recentSpan?.start_time ?? null;
  }

  // 3. Determine status: deployed (running + traces), failed (container found but no traces or stopped), unknown (nothing found)
  let newStatus: CoverageStatus | null = null;
  if (beylaRunning) {
    newStatus = 'deployed';
  } else if (beylaStatus === 'failed') {
    newStatus = 'failed';
  }

  // Update coverage record
  const verified = beylaRunning || lastTraceAt !== null;

  if (newStatus) {
    // Auto-update status (but don't overwrite 'excluded' or 'planned')
    prepareStmt(`
      UPDATE ebpf_coverage
      SET status = CASE WHEN status IN ('unknown', 'deployed', 'failed') THEN ? ELSE status END,
          last_trace_at = COALESCE(?, last_trace_at),
          last_verified_at = datetime('now'),
          updated_at = datetime('now')
      WHERE endpoint_id = ?
    `).run(newStatus, lastTraceAt, endpointId);
  } else {
    prepareStmt(`
      UPDATE ebpf_coverage
      SET last_trace_at = COALESCE(?, last_trace_at),
          last_verified_at = datetime('now'),
          updated_at = datetime('now')
      WHERE endpoint_id = ?
    `).run(lastTraceAt, endpointId);
  }

  log.debug({ endpointId, verified, beylaRunning, lastTraceAt }, 'Coverage verified');
  return { verified, lastTraceAt, beylaRunning };
}

/**
 * Return aggregate coverage stats.
 */
export function getCoverageSummary(): CoverageSummary {
  const db = getDb();

  const rows = db.prepare(`
    SELECT status, COUNT(*) as count
    FROM ebpf_coverage
    GROUP BY status
  `).all() as { status: CoverageStatus; count: number }[];

  const counts: Record<CoverageStatus, number> = {
    planned: 0,
    deployed: 0,
    excluded: 0,
    failed: 0,
    unknown: 0,
  };

  for (const row of rows) {
    counts[row.status] = row.count;
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const coveragePercent = total > 0
    ? Math.round((counts.deployed / total) * 100)
    : 0;

  return {
    total,
    ...counts,
    coveragePercent,
  };
}
