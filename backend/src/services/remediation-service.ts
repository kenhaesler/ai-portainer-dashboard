import { v4 as uuidv4 } from 'uuid';
import { createChildLogger } from '../utils/logger.js';
import { restartContainer, startContainer, stopContainer } from './portainer-client.js';
import {
  insertAction,
  getAction,
  updateActionStatus,
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

      insertAction(action);
      log.info(
        { actionId, actionType: pattern.actionType, insightId: insight.id },
        'Action suggested',
      );
      broadcastNewAction(action);

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

export async function executeAction(actionId: string): Promise<boolean> {
  const action = getAction(actionId);
  if (!action) {
    log.warn({ actionId }, 'Cannot execute: action not found');
    return false;
  }

  if (action.status !== 'approved') {
    log.warn(
      { actionId, status: action.status },
      'Cannot execute: action is not in approved status',
    );
    return false;
  }

  // Transition to executing
  const transitioned = updateActionStatus(actionId, 'executing');
  if (!transitioned) {
    return false;
  }

  const startTime = Date.now();

  try {
    switch (action.action_type) {
      case 'RESTART_CONTAINER':
        await restartContainer(action.endpoint_id, action.container_id);
        break;
      case 'STOP_CONTAINER':
        await stopContainer(action.endpoint_id, action.container_id);
        break;
      case 'START_CONTAINER':
        await startContainer(action.endpoint_id, action.container_id);
        break;
      default:
        throw new Error(`Unknown action type: ${action.action_type}`);
    }

    const durationMs = Date.now() - startTime;
    updateActionStatus(actionId, 'completed', {
      execution_result: `${action.action_type} executed successfully`,
      execution_duration_ms: durationMs,
    });

    log.info(
      { actionId, actionType: action.action_type, durationMs },
      'Action executed successfully',
    );
    emitEvent({ type: 'remediation.completed', timestamp: new Date().toISOString(), data: { actionId, actionType: action.action_type, durationMs } });
    return true;
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';

    updateActionStatus(actionId, 'failed', {
      execution_result: `Failed: ${errorMessage}`,
      execution_duration_ms: durationMs,
    });

    log.error(
      { actionId, actionType: action.action_type, err },
      'Action execution failed',
    );
    return false;
  }
}
