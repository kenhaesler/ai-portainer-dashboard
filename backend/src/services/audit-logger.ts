import { getDbForDomain } from '../db/app-db-router.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('audit');
const db = getDbForDomain('audit');

export interface AuditEntry {
  user_id?: string;
  username?: string;
  action: string;
  target_type?: string;
  target_id?: string;
  details?: Record<string, unknown>;
  request_id?: string;
  ip_address?: string;
}

export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    await db.execute(`
      INSERT INTO audit_log (user_id, username, action, target_type, target_id, details, request_id, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `, [
      entry.user_id || null,
      entry.username || null,
      entry.action,
      entry.target_type || null,
      entry.target_id || null,
      JSON.stringify(entry.details || {}),
      entry.request_id || null,
      entry.ip_address || null,
    ]);
    log.debug({ action: entry.action, target: entry.target_id }, 'Audit log written');
  } catch (err) {
    log.error({ err, entry }, 'Failed to write audit log');
  }
}

export async function getAuditLogs(options?: {
  limit?: number;
  offset?: number;
  action?: string;
  userId?: string;
  targetType?: string;
}): Promise<Record<string, unknown>[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options?.action) {
    conditions.push('action = ?');
    params.push(options.action);
  }
  if (options?.userId) {
    conditions.push('user_id = ?');
    params.push(options.userId);
  }
  if (options?.targetType) {
    conditions.push('target_type = ?');
    params.push(options.targetType);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options?.limit || 100;
  const offset = options?.offset || 0;

  return db.query(`
    SELECT * FROM audit_log ${where}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);
}
