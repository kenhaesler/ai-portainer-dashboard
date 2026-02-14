import { getDbForDomain } from '../db/app-db-router.js';
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

export async function insertAction(action: ActionInsert): Promise<boolean> {
  const db = getDbForDomain('actions');
  try {
    const result = await db.execute(
      `INSERT INTO actions (
        id, insight_id, endpoint_id, container_id, container_name,
        action_type, rationale, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
      [
        action.id,
        action.insight_id,
        action.endpoint_id,
        action.container_id,
        action.container_name,
        action.action_type,
        action.rationale,
      ],
    );

    if (result.changes > 0) {
      log.info({ actionId: action.id, actionType: action.action_type }, 'Action created');
      return true;
    }
    return false;
  } catch (err) {
    const isUniqueViolation = (
      typeof err === 'object'
      && err !== null
      && 'code' in err
      && (err as { code?: string }).code === '23505'
    );
    if (isUniqueViolation) {
      log.debug(
        { containerId: action.container_id, actionType: action.action_type },
        'Skipped duplicate pending action at insert time',
      );
      return false;
    }
    throw err;
  }
}

export interface GetActionsOptions {
  status?: string;
  limit?: number;
  offset?: number;
}

export async function getActions(options: GetActionsOptions = {}): Promise<Action[]> {
  const db = getDbForDomain('actions');
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.status) {
    conditions.push('status = ?');
    params.push(options.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;

  return await db.query<Action>(
    `SELECT * FROM actions ${where}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
}

export async function hasPendingAction(containerId: string, actionType: string): Promise<boolean> {
  const db = getDbForDomain('actions');
  const row = await db.queryOne(
    `SELECT 1 FROM actions
     WHERE container_id = ? AND action_type = ? AND status = 'pending'
     LIMIT 1`,
    [containerId, actionType],
  );
  return row !== null;
}

export async function getAction(id: string): Promise<Action | undefined> {
  const db = getDbForDomain('actions');
  const row = await db.queryOne<Action>(
    'SELECT * FROM actions WHERE id = ?',
    [id],
  );
  return row ?? undefined;
}

export async function updateActionRationale(id: string, rationale: string): Promise<boolean> {
  const db = getDbForDomain('actions');
  const result = await db.execute(
    'UPDATE actions SET rationale = ? WHERE id = ?',
    [rationale, id],
  );

  if (result.changes > 0) {
    log.info({ actionId: id }, 'Action rationale updated');
    return true;
  }
  return false;
}

export async function updateActionStatus(
  id: string,
  newStatus: ActionStatus,
  details?: Record<string, unknown>,
): Promise<boolean> {
  const db = getDbForDomain('actions');
  const action = await getAction(id);

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
    updates.push('approved_by = ?', 'approved_at = NOW()');
    params.push(details.approved_by as string);
  }

  if (newStatus === 'rejected') {
    if (details?.rejected_by) {
      updates.push('rejected_by = ?', 'rejected_at = NOW()');
      params.push(details.rejected_by as string);
    }
    if (details?.rejection_reason) {
      updates.push('rejection_reason = ?');
      params.push(details.rejection_reason as string);
    }
  }

  if (newStatus === 'executing') {
    updates.push('executed_at = NOW()');
  }

  if (newStatus === 'completed' || newStatus === 'failed') {
    updates.push('completed_at = NOW()');
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

  const result = await db.execute(
    `UPDATE actions SET ${updates.join(', ')} WHERE id = ?`,
    params,
  );

  if (result.changes > 0) {
    log.info({ actionId: id, from: action.status, to: newStatus }, 'Action status updated');
    return true;
  }
  return false;
}
