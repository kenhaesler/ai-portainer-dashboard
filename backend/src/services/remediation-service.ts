import { v4 as uuidv4 } from 'uuid';
import { createChildLogger } from '../utils/logger.js';
import {
  insertAction,
  updateActionStatus,
  hasPendingAction,
  type ActionInsert,
} from './actions-store.js';
import type { Insight } from '../models/monitoring.js';
import { emitEvent } from './event-bus.js';
import { broadcastNewAction } from '../sockets/remediation.js';

const log = createChildLogger('remediation-service');

const ACTION_PATTERNS: Array<{
  keywords: RegExp;
  actionType: string;
  rationale: string;
}> = [
  {
    keywords: /unhealthy|health\s*check\s*fail/i,
    actionType: 'RESTART_CONTAINER',
    rationale: 'Container is reporting unhealthy status. Restarting may resolve the issue.',
  },
  {
    keywords: /oom|out\s*of\s*memory|memory\s*limit/i,
    actionType: 'STOP_CONTAINER',
    rationale: 'Container hit memory limit (OOM). Stop it to prevent repeated crashes while investigating.',
  },
  {
    keywords: /restart\s*(loop|count|crash)/i,
    actionType: 'RESTART_CONTAINER',
    rationale: 'Container is in a restart loop. A clean restart may stabilize it.',
  },
  {
    keywords: /high\s*cpu|cpu\s*spike|runaway\s*process/i,
    actionType: 'STOP_CONTAINER',
    rationale: 'High CPU usage detected. Stop the container to mitigate impact while you investigate.',
  },
  {
    keywords: /stopped|exited|not\s*running/i,
    actionType: 'START_CONTAINER',
    rationale: 'Container appears stopped. Starting it may restore service availability.',
  },
];

export function suggestAction(
  insight: Insight,
): { actionId: string; actionType: string } | null {
  const textToMatch = `${insight.title} ${insight.description} ${insight.suggested_action || ''}`;

  for (const pattern of ACTION_PATTERNS) {
    if (pattern.keywords.test(textToMatch)) {
      if (!insight.container_id || !insight.endpoint_id) {
        log.debug(
          { insightId: insight.id },
          'Insight matches action pattern but has no container/endpoint context',
        );
        return null;
      }

      if (hasPendingAction(insight.container_id, pattern.actionType)) {
        log.debug(
          { containerId: insight.container_id, actionType: pattern.actionType },
          'Skipping duplicate pending action',
        );
        return null;
      }

      const actionId = uuidv4();
      const action: ActionInsert = {
        id: actionId,
        insight_id: insight.id,
        endpoint_id: insight.endpoint_id,
        container_id: insight.container_id,
        container_name: insight.container_name || 'unknown',
        action_type: pattern.actionType,
        rationale: pattern.rationale,
      };

      const inserted = insertAction(action);
      if (!inserted) {
        log.debug(
          { containerId: insight.container_id, actionType: pattern.actionType },
          'Skipped duplicate pending action due to unique constraint',
        );
        return null;
      }

      log.info(
        { actionId, actionType: pattern.actionType, insightId: insight.id },
        'Action suggested',
      );
      broadcastNewAction(action as unknown as Record<string, unknown>);

      return { actionId, actionType: pattern.actionType };
    }
  }

  return null;
}

export function approveAction(actionId: string, username: string): boolean {
  const success = updateActionStatus(actionId, 'approved', { approved_by: username });
  if (success) {
    log.info({ actionId, approvedBy: username }, 'Action approved');
    emitEvent({ type: 'remediation.approved', timestamp: new Date().toISOString(), data: { actionId, approvedBy: username } });
  }
  return success;
}

export function rejectAction(
  actionId: string,
  username: string,
  reason: string,
): boolean {
  const success = updateActionStatus(actionId, 'rejected', {
    rejected_by: username,
    rejection_reason: reason,
  });
  if (success) {
    log.info({ actionId, rejectedBy: username, reason }, 'Action rejected');
    emitEvent({ type: 'remediation.rejected', timestamp: new Date().toISOString(), data: { actionId, rejectedBy: username, reason } });
  }
  return success;
}
