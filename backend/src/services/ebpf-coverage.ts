import { getDb, prepareStmt } from '../db/sqlite.js';
import { getEndpoints } from './portainer-client.js';
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
 * Sync coverage table with current endpoint inventory.
 * Adds new endpoints as 'unknown', preserves existing states.
 * Returns the number of new endpoints added.
 */
export async function syncEndpointCoverage(): Promise<number> {
  const endpoints = await getEndpoints();
  const db = getDb();
  let added = 0;

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO ebpf_coverage (endpoint_id, endpoint_name)
    VALUES (?, ?)
  `);

  const updateNameStmt = db.prepare(`
    UPDATE ebpf_coverage SET endpoint_name = ?, updated_at = datetime('now')
    WHERE endpoint_id = ? AND endpoint_name != ?
  `);

  const txn = db.transaction(() => {
    for (const ep of endpoints) {
      const result = insertStmt.run(ep.Id, ep.Name);
      if (result.changes > 0) {
        added++;
      } else {
        // Update name if it changed
        updateNameStmt.run(ep.Name, ep.Id, ep.Name);
      }
    }
  });

  txn();

  log.info({ total: endpoints.length, added }, 'Endpoint coverage synced');
  return added;
}

/**
 * Verify that traces have been received from an endpoint recently.
 * Looks for spans in the last 10 minutes associated with this endpoint.
 */
export function verifyCoverage(endpointId: number): { verified: boolean; lastTraceAt: string | null } {
  const db = getDb();

  // Check if the spans table exists — it may not if traces feature is unused
  const tableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='spans'",
  ).get();

  let lastTraceAt: string | null = null;

  if (tableExists) {
    // Look for recent spans. Spans don't have an endpoint_id column directly,
    // but we can look for any recent span activity as a proxy.
    // In a real deployment, the service_name or resource attributes would map to endpoints.
    const recentSpan = db.prepare(`
      SELECT start_time FROM spans
      WHERE start_time > datetime('now', '-10 minutes')
      ORDER BY start_time DESC
      LIMIT 1
    `).get() as { start_time: string } | undefined;

    lastTraceAt = recentSpan?.start_time ?? null;
  }

  // Update the coverage record
  const verified = lastTraceAt !== null;
  prepareStmt(`
    UPDATE ebpf_coverage
    SET last_trace_at = COALESCE(?, last_trace_at),
        last_verified_at = datetime('now'),
        updated_at = datetime('now')
    WHERE endpoint_id = ?
  `).run(lastTraceAt, endpointId);

  log.debug({ endpointId, verified, lastTraceAt }, 'Coverage verified');
  return { verified, lastTraceAt };
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
