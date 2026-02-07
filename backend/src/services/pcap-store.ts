import { getDb } from '../db/sqlite.js';
import { createChildLogger } from '../utils/logger.js';
import type { Capture, CaptureStatus } from '../models/pcap.js';

const log = createChildLogger('pcap-store');

export interface CaptureInsert {
  id: string;
  endpoint_id: number;
  container_id: string;
  container_name: string;
  filter?: string;
  duration_seconds?: number;
  max_packets?: number;
}

export function insertCapture(capture: CaptureInsert): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO pcap_captures (
      id, endpoint_id, container_id, container_name,
      status, filter, duration_seconds, max_packets, created_at
    ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, datetime('now'))
  `).run(
    capture.id,
    capture.endpoint_id,
    capture.container_id,
    capture.container_name,
    capture.filter || null,
    capture.duration_seconds || null,
    capture.max_packets || null,
  );

  log.debug({ captureId: capture.id }, 'Capture record inserted');
}

export function updateCaptureStatus(
  id: string,
  status: CaptureStatus,
  updates?: {
    exec_id?: string;
    capture_file?: string;
    file_size_bytes?: number;
    packet_count?: number;
    protocol_stats?: string;
    error_message?: string;
    started_at?: string;
    completed_at?: string;
  },
): void {
  const db = getDb();
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

  db.prepare(`UPDATE pcap_captures SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  log.debug({ captureId: id, status }, 'Capture status updated');
}

export function getCapture(id: string): Capture | undefined {
  const db = getDb();
  return db
    .prepare('SELECT * FROM pcap_captures WHERE id = ?')
    .get(id) as Capture | undefined;
}

export interface GetCapturesOptions {
  status?: CaptureStatus;
  containerId?: string;
  limit?: number;
  offset?: number;
}

export function getCaptures(options: GetCapturesOptions = {}): Capture[] {
  const db = getDb();
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

  return db
    .prepare(`
      SELECT * FROM pcap_captures
      ${where}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `)
    .all(...params, limit, offset) as Capture[];
}

export function getCapturesCount(status?: CaptureStatus): number {
  const db = getDb();
  if (status) {
    const row = db
      .prepare('SELECT COUNT(*) as count FROM pcap_captures WHERE status = ?')
      .get(status) as { count: number };
    return row.count;
  }
  const row = db
    .prepare('SELECT COUNT(*) as count FROM pcap_captures')
    .get() as { count: number };
  return row.count;
}

export function deleteCapture(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM pcap_captures WHERE id = ?').run(id);
  return result.changes > 0;
}

export function cleanOldCaptures(retentionDays: number): number {
  const db = getDb();
  const result = db
    .prepare(`
      DELETE FROM pcap_captures
      WHERE created_at < datetime('now', ? || ' days')
        AND status IN ('complete', 'failed', 'succeeded')
    `)
    .run(`-${retentionDays}`);

  if (result.changes > 0) {
    log.info({ deleted: result.changes, retentionDays }, 'Old captures cleaned up');
  }
  return result.changes;
}

export function getActiveCaptureIds(): string[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT id FROM pcap_captures WHERE status IN ('pending', 'capturing', 'processing')")
    .all() as { id: string }[];
  return rows.map((r) => r.id);
}
