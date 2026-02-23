import { getDbForDomain } from '../db/app-db-router.js';
import { createChildLogger } from '../utils/logger.js';
import type { Capture, CaptureStatus } from '../models/pcap.js';

const log = createChildLogger('pcap-store');

function db() { return getDbForDomain('pcap'); }

export interface CaptureInsert {
  id: string;
  endpoint_id: number;
  container_id: string;
  container_name: string;
  filter?: string;
  duration_seconds?: number;
  max_packets?: number;
}

export async function insertCapture(capture: CaptureInsert): Promise<void> {
  await db().execute(`
    INSERT INTO pcap_captures (
      id, endpoint_id, container_id, container_name,
      status, filter, duration_seconds, max_packets, created_at
    ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, NOW())
  `, [
    capture.id,
    capture.endpoint_id,
    capture.container_id,
    capture.container_name,
    capture.filter || null,
    capture.duration_seconds || null,
    capture.max_packets || null,
  ]);

  log.debug({ captureId: capture.id }, 'Capture record inserted');
}

export async function updateCaptureStatus(
  id: string,
  status: CaptureStatus,
  updates?: {
    exec_id?: string;
    sidecar_id?: string;
    capture_file?: string;
    file_size_bytes?: number;
    packet_count?: number;
    protocol_stats?: string;
    error_message?: string;
    started_at?: string;
    completed_at?: string;
  },
): Promise<void> {
  const sets = ['status = ?'];
  const params: unknown[] = [status];

  if (updates) {
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        sets.push(`${key} = ?`);
        params.push(value);
      }
    }
  }

  params.push(id);

  await db().execute(`UPDATE pcap_captures SET ${sets.join(', ')} WHERE id = ?`, params);
  log.debug({ captureId: id, status }, 'Capture status updated');
}

export async function getCapture(id: string): Promise<Capture | undefined> {
  const row = await db().queryOne<Capture>('SELECT * FROM pcap_captures WHERE id = ?', [id]);
  return row ?? undefined;
}

export interface GetCapturesOptions {
  status?: CaptureStatus;
  containerId?: string;
  limit?: number;
  offset?: number;
}

export async function getCaptures(options: GetCapturesOptions = {}): Promise<Capture[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.status) {
    conditions.push('status = ?');
    params.push(options.status);
  }

  if (options.containerId) {
    conditions.push('container_id = ?');
    params.push(options.containerId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  return db().query<Capture>(`
    SELECT * FROM pcap_captures
    ${where}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);
}

export async function getCapturesCount(status?: CaptureStatus): Promise<number> {
  if (status) {
    const row = await db().queryOne<{ count: number }>(
      'SELECT COUNT(*)::integer as count FROM pcap_captures WHERE status = ?', [status],
    );
    return row?.count ?? 0;
  }
  const row = await db().queryOne<{ count: number }>(
    'SELECT COUNT(*)::integer as count FROM pcap_captures', [],
  );
  return row?.count ?? 0;
}

export async function deleteCapture(id: string): Promise<boolean> {
  const result = await db().execute('DELETE FROM pcap_captures WHERE id = ?', [id]);
  return result.changes > 0;
}

export async function cleanOldCaptures(retentionDays: number): Promise<number> {
  const result = await db().execute(`
    DELETE FROM pcap_captures
    WHERE created_at < NOW() + (? || ' days')::INTERVAL
      AND status IN ('complete', 'failed', 'succeeded')
  `, [`-${retentionDays}`]);

  if (result.changes > 0) {
    log.info({ deleted: result.changes, retentionDays }, 'Old captures cleaned up');
  }
  return result.changes;
}

export async function updateCaptureAnalysis(id: string, analysisResult: string): Promise<void> {
  await db().execute('UPDATE pcap_captures SET analysis_result = ? WHERE id = ?', [analysisResult, id]);
  log.debug({ captureId: id }, 'Capture analysis result updated');
}

export async function getActiveCaptureIds(): Promise<string[]> {
  const rows = await db().query<{ id: string }>(
    "SELECT id FROM pcap_captures WHERE status IN ('pending', 'capturing', 'processing')", [],
  );
  return rows.map((r) => r.id);
}
