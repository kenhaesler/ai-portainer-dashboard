import { getDb } from '../db/sqlite.js';
import { createChildLogger } from '../utils/logger.js';
import type { Action, ActionStatus } from '../models/remediation.js';

const log = createChildLogger('actions-store');

export interface ActionInsert {
  id: string;
  insight_id: string | null;
  endpoint_id: number;
  container_id: string;
  container_name: string;
  action_type: string;
  rationale: string;
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ['approved', 'rejected'],
  approved: ['executing'],
  executing: ['completed', 'failed'],
};

export function insertAction(action: ActionInsert): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO actions (
      id, insight_id, endpoint_id, container_id, container_name,
      action_type, rationale, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
  `).run(
    action.id,
    action.insight_id,
    action.endpoint_id,
    action.container_id,
    action.container_name,
    action.action_type,
    action.rationale,
  );

  log.info({ actionId: action.id, actionType: action.action_type }, 'Action created');
}

export interface GetActionsOptions {
  status?: string;
  limit?: number;
  offset?: number;
}

export function getActions(options: GetActionsOptions = {}): Action[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.status) {
    conditions.push('status = ?');
    params.push(options.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;

  return db
    .prepare(
      `SELECT * FROM actions ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Action[];
}

export function getAction(id: string): Action | undefined {
  const db = getDb();
  return db
    .prepare('SELECT * FROM actions WHERE id = ?')
    .get(id) as Action | undefined;
}

export function updateActionStatus(
  id: string,
  newStatus: ActionStatus,
  details?: Record<string, unknown>,
): boolean {
  const db = getDb();
  const action = getAction(id);

  if (!action) {
    log.warn({ actionId: id }, 'Action not found');
    return false;
  }

  const allowed = VALID_TRANSITIONS[action.status];
  if (!allowed || !allowed.includes(newStatus)) {
    log.warn(
      { actionId: id, currentStatus: action.status, newStatus },
      'Invalid status transition',
    );
    return false;
  }

  const updates: string[] = ['status = ?'];
  const params: unknown[] = [newStatus];

  if (newStatus === 'approved' && details?.approved_by) {
    updates.push('approved_by = ?', "approved_at = datetime('now')");
    params.push(details.approved_by as string);
  }

  if (newStatus === 'rejected') {
    if (details?.rejected_by) {
      updates.push('rejected_by = ?', "rejected_at = datetime('now')");
      params.push(details.rejected_by as string);
    }
    if (details?.rejection_reason) {
      updates.push('rejection_reason = ?');
      params.push(details.rejection_reason as string);
    }
  }

  if (newStatus === 'executing') {
    updates.push("executed_at = datetime('now')");
  }

  if (newStatus === 'completed' || newStatus === 'failed') {
    updates.push("completed_at = datetime('now')");
    if (details?.execution_result) {
      updates.push('execution_result = ?');
      params.push(details.execution_result as string);
    }
    if (details?.execution_duration_ms !== undefined) {
      updates.push('execution_duration_ms = ?');
      params.push(details.execution_duration_ms as number);
    }
  }

  params.push(id);

  const result = db
    .prepare(`UPDATE actions SET ${updates.join(', ')} WHERE id = ?`)
    .run(...params);

  if (result.changes > 0) {
    log.info({ actionId: id, from: action.status, to: newStatus }, 'Action status updated');
    return true;
  }
  return false;
}
