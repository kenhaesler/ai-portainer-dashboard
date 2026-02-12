import { getDb, prepareStmt } from '../db/sqlite.js';
import {
  getEndpoints,
  getContainers,
  getEndpoint,
  pullImage,
  createContainer,
  startContainer,
  stopContainer,
  removeContainer,
} from './portainer-client.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('ebpf-coverage');

export type CoverageStatus = 'planned' | 'deployed' | 'excluded' | 'failed' | 'unknown' | 'not_deployed' | 'unreachable' | 'incompatible';

/** Portainer endpoint types compatible with Beyla eBPF tracing (Docker Standalone=1, Swarm=2, Edge Agent Standard=4, Edge Agent Async=7) */
export const BEYLA_COMPATIBLE_TYPES = new Set([1, 2, 4, 7]);

/** Detection result from checking a single endpoint for Beyla */
export type DetectionResult = 'deployed' | 'failed' | 'not_found' | 'unreachable' | 'incompatible';

export interface CoverageRecord {
  endpoint_id: number;
  endpoint_name: string;
  status: CoverageStatus;
  beyla_enabled: number;
  beyla_container_id: string | null;
  beyla_managed: number;
  drifted: boolean;
  exclusion_reason: string | null;
  deployment_profile: string | null;
  last_trace_at: string | null;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

interface CoverageRow extends Omit<CoverageRecord, 'drifted'> {}

interface DeployBeylaOptions {
  otlpEndpoint: string;
  tracesApiKey: string;
  openPorts?: string;
}

interface BeylaActionResult {
  endpointId: number;
  endpointName: string;
  containerId: string;
  status: 'deployed' | 'enabled' | 'disabled' | 'removed' | 'already_deployed' | 'already_disabled';
}

interface BulkActionItemResult {
  endpointId: number;
  success: boolean;
  message: string;
}

const DASHBOARD_MANAGED_BY = 'ai-portainer-dashboard';
const BEYLA_COMPONENT_LABEL = 'beyla-ebpf';
const BEYLA_IMAGE = 'grafana/beyla:latest';
const DEFAULT_BEYLA_OPEN_PORTS = '80,443,3000-9999';

export interface CoverageSummary {
  total: number;
  deployed: number;
  planned: number;
  excluded: number;
  failed: number;
  unknown: number;
  not_deployed: number;
  unreachable: number;
  incompatible: number;
  coveragePercent: number;
}

/**
 * Returns coverage status for all endpoints by reading the ebpf_coverage table.
 */
export function getEndpointCoverage(): CoverageRecord[] {
  const rows = prepareStmt(
    'SELECT * FROM ebpf_coverage ORDER BY endpoint_name ASC',
  ).all() as CoverageRow[];

  return rows.map((row) => ({
    ...row,
    drifted:
      Boolean(row.beyla_enabled) &&
      row.status !== 'deployed' &&
      row.status !== 'excluded' &&
      row.status !== 'incompatible',
  }));
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

function isBeylaContainer(container: { Image: string; Labels?: Record<string, string> }): boolean {
  const image = container.Image.toLowerCase();
  const labels = container.Labels ?? {};
  return (
    image.includes('grafana/beyla') ||
    image.includes('/beyla') ||
    labels.component === BEYLA_COMPONENT_LABEL
  );
}

async function findBeylaContainer(endpointId: number): Promise<{
  containerId: string;
  running: boolean;
  managed: boolean;
} | null> {
  const containers = await getContainers(endpointId, true);
  const beyla = containers.find(isBeylaContainer);

  if (!beyla) {
    return null;
  }

  return {
    containerId: beyla.Id,
    running: beyla.State === 'running',
    managed: beyla.Labels?.['managed-by'] === DASHBOARD_MANAGED_BY,
  };
}

function updateLifecycleCoverage(
  endpointId: number,
  endpointName: string,
  status: CoverageStatus,
  values: {
    beylaEnabled: boolean;
    containerId: string | null;
    managed: boolean;
  },
): void {
  prepareStmt(`
    INSERT INTO ebpf_coverage (endpoint_id, endpoint_name, status, beyla_enabled, beyla_container_id, beyla_managed)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint_id) DO UPDATE SET
      endpoint_name = excluded.endpoint_name,
      status = excluded.status,
      beyla_enabled = excluded.beyla_enabled,
      beyla_container_id = excluded.beyla_container_id,
      beyla_managed = excluded.beyla_managed,
      exclusion_reason = NULL,
      updated_at = datetime('now')
  `).run(
    endpointId,
    endpointName,
    status,
    values.beylaEnabled ? 1 : 0,
    values.containerId,
    values.managed ? 1 : 0,
  );
}

/**
 * Detect Beyla status on a single endpoint by checking its containers.
 * Returns distinct statuses to differentiate failure modes:
 * - 'deployed': Beyla container running
 * - 'failed': Beyla container found but not running
 * - 'not_found': Endpoint reachable, no Beyla container present
 * - 'unreachable': Network/API error when querying endpoint
 * - 'incompatible': Wrong endpoint type (Edge Agent, etc.)
 */
export async function detectBeylaOnEndpoint(endpointId: number, endpointType?: number): Promise<DetectionResult> {
  if (endpointType !== undefined && !BEYLA_COMPATIBLE_TYPES.has(endpointType)) {
    return 'incompatible';
  }
  try {
    const containers = await getContainers(endpointId, true);
    const beyla = containers.find((c) =>
      c.Image.toLowerCase().includes('grafana/beyla') ||
      c.Image.toLowerCase().includes('beyla'),
    );
    if (!beyla) return 'not_found';
    return beyla.State === 'running' ? 'deployed' : 'failed';
  } catch {
    return 'unreachable';
  }
}

/** Map detection results to coverage statuses stored in DB */
function detectionToCoverageStatus(result: DetectionResult): CoverageStatus {
  switch (result) {
    case 'deployed': return 'deployed';
    case 'failed': return 'failed';
    case 'not_found': return 'not_deployed';
    case 'unreachable': return 'unreachable';
    case 'incompatible': return 'incompatible';
  }
}

export async function deployBeyla(endpointId: number, options: DeployBeylaOptions): Promise<BeylaActionResult> {
  const endpoint = await getEndpoint(endpointId);
  const existing = await findBeylaContainer(endpointId);

  if (existing?.running) {
    updateLifecycleCoverage(endpointId, endpoint.Name, 'deployed', {
      beylaEnabled: true,
      containerId: existing.containerId,
      managed: existing.managed,
    });
    return {
      endpointId,
      endpointName: endpoint.Name,
      containerId: existing.containerId,
      status: 'already_deployed',
    };
  }

  if (existing && !existing.running) {
    await startContainer(endpointId, existing.containerId);
    updateLifecycleCoverage(endpointId, endpoint.Name, 'deployed', {
      beylaEnabled: true,
      containerId: existing.containerId,
      managed: existing.managed,
    });
    return {
      endpointId,
      endpointName: endpoint.Name,
      containerId: existing.containerId,
      status: 'enabled',
    };
  }

  const [imageName, imageTag = 'latest'] = BEYLA_IMAGE.split(':');
  await pullImage(endpointId, imageName, imageTag);

  const env = [
    `BEYLA_OPEN_PORT=${options.openPorts || DEFAULT_BEYLA_OPEN_PORTS}`,
    `BEYLA_SERVICE_NAMESPACE=${endpoint.Name}`,
    `OTEL_EXPORTER_OTLP_ENDPOINT=${options.otlpEndpoint}`,
    'OTEL_EXPORTER_OTLP_PROTOCOL=http/json',
    'OTEL_METRICS_EXPORTER=none',
    'BEYLA_TRACE_PRINTER=disabled',
  ];

  if (options.tracesApiKey) {
    env.push(`OTEL_EXPORTER_OTLP_HEADERS=X-API-Key=${options.tracesApiKey}`);
  }

  const created = await createContainer(
    endpointId,
    {
      Image: BEYLA_IMAGE,
      Env: env,
      Labels: {
        'managed-by': DASHBOARD_MANAGED_BY,
        component: BEYLA_COMPONENT_LABEL,
      },
      HostConfig: {
        Privileged: true,
        PidMode: 'host',
        Init: true,
        Binds: [
          '/sys/fs/cgroup:/sys/fs/cgroup',
          '/sys/kernel/security:/sys/kernel/security',
        ],
        RestartPolicy: { Name: 'unless-stopped' },
      },
    },
    `beyla-${endpointId}`,
  );

  await startContainer(endpointId, created.Id);

  updateLifecycleCoverage(endpointId, endpoint.Name, 'deployed', {
    beylaEnabled: true,
    containerId: created.Id,
    managed: true,
  });

  return {
    endpointId,
    endpointName: endpoint.Name,
    containerId: created.Id,
    status: 'deployed',
  };
}

export async function disableBeyla(endpointId: number): Promise<BeylaActionResult> {
  const endpoint = await getEndpoint(endpointId);
  const existing = await findBeylaContainer(endpointId);
  if (!existing) {
    throw new Error('No Beyla container found on this endpoint');
  }

  if (!existing.running) {
    updateLifecycleCoverage(endpointId, endpoint.Name, 'failed', {
      beylaEnabled: false,
      containerId: existing.containerId,
      managed: existing.managed,
    });
    return {
      endpointId,
      endpointName: endpoint.Name,
      containerId: existing.containerId,
      status: 'already_disabled',
    };
  }

  await stopContainer(endpointId, existing.containerId);

  updateLifecycleCoverage(endpointId, endpoint.Name, 'failed', {
    beylaEnabled: false,
    containerId: existing.containerId,
    managed: existing.managed,
  });

  return {
    endpointId,
    endpointName: endpoint.Name,
    containerId: existing.containerId,
    status: 'disabled',
  };
}

export async function enableBeyla(endpointId: number): Promise<BeylaActionResult> {
  const endpoint = await getEndpoint(endpointId);
  const existing = await findBeylaContainer(endpointId);
  if (!existing) {
    throw new Error('No Beyla container found on this endpoint');
  }

  await startContainer(endpointId, existing.containerId);

  updateLifecycleCoverage(endpointId, endpoint.Name, 'deployed', {
    beylaEnabled: true,
    containerId: existing.containerId,
    managed: existing.managed,
  });

  return {
    endpointId,
    endpointName: endpoint.Name,
    containerId: existing.containerId,
    status: 'enabled',
  };
}

export async function removeBeylaFromEndpoint(endpointId: number, force = false): Promise<BeylaActionResult> {
  const endpoint = await getEndpoint(endpointId);
  const existing = await findBeylaContainer(endpointId);
  if (!existing) {
    throw new Error('No Beyla container found on this endpoint');
  }

  if (existing.running) {
    try {
      await stopContainer(endpointId, existing.containerId);
    } catch (err) {
      if (!force) {
        throw err;
      }
    }
  }

  await removeContainer(endpointId, existing.containerId, force);

  updateLifecycleCoverage(endpointId, endpoint.Name, 'not_deployed', {
    beylaEnabled: false,
    containerId: null,
    managed: false,
  });

  return {
    endpointId,
    endpointName: endpoint.Name,
    containerId: existing.containerId,
    status: 'removed',
  };
}

export async function deployBeylaBulk(endpointIds: number[], options: DeployBeylaOptions): Promise<BulkActionItemResult[]> {
  const results = await Promise.all(
    endpointIds.map(async (endpointId) => {
      try {
        const result = await deployBeyla(endpointId, options);
        return { endpointId, success: true, message: result.status };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown deployment failure';
        return { endpointId, success: false, message };
      }
    }),
  );
  return results;
}

export async function removeBeylaBulk(endpointIds: number[], force = false): Promise<BulkActionItemResult[]> {
  const results = await Promise.all(
    endpointIds.map(async (endpointId) => {
      try {
        const result = await removeBeylaFromEndpoint(endpointId, force);
        return { endpointId, success: true, message: result.status };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown remove failure';
        return { endpointId, success: false, message };
      }
    }),
  );
  return results;
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

  const upEndpoints = endpoints.filter((ep) => ep.Status === 1);

  const detectionResults = await Promise.allSettled(
    upEndpoints.map(async (ep) => ({
      id: ep.Id,
      detected: await detectBeylaOnEndpoint(ep.Id, ep.Type),
    })),
  );

  const detectedMap = new Map<number, CoverageStatus>();
  for (const result of detectionResults) {
    if (result.status === 'fulfilled') {
      detectedMap.set(result.value.id, detectionToCoverageStatus(result.value.detected));
    }
  }

  for (const ep of endpoints) {
    if (!detectedMap.has(ep.Id)) {
      if (!BEYLA_COMPATIBLE_TYPES.has(ep.Type)) {
        detectedMap.set(ep.Id, 'incompatible');
      } else if (ep.Status !== 1) {
        detectedMap.set(ep.Id, 'unreachable');
      }
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

  const autoUpdateStmt = db.prepare(`
    UPDATE ebpf_coverage
    SET status = ?, updated_at = datetime('now')
    WHERE endpoint_id = ? AND status IN ('unknown', 'deployed', 'failed', 'not_deployed', 'unreachable', 'incompatible')
  `);

  const txn = db.transaction(() => {
    for (const ep of endpoints) {
      const detected = detectedMap.get(ep.Id) ?? 'unknown';
      const result = insertStmt.run(ep.Id, ep.Name, detected);
      if (result.changes > 0) {
        added++;
      } else {
        updateNameStmt.run(ep.Name, ep.Id, ep.Name);
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

  const beylaDetection = await detectBeylaOnEndpoint(endpointId);
  const beylaRunning = beylaDetection === 'deployed';

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

  const newStatus = detectionToCoverageStatus(beylaDetection);
  const verified = beylaRunning || lastTraceAt !== null;

  if (newStatus === 'deployed' || newStatus === 'failed') {
    prepareStmt(`
      UPDATE ebpf_coverage
      SET status = CASE WHEN status IN ('unknown', 'deployed', 'failed', 'not_deployed', 'unreachable', 'incompatible') THEN ? ELSE status END,
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
    not_deployed: 0,
    unreachable: 0,
    incompatible: 0,
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
