import { Namespace } from 'socket.io';
import { getDbForDomain } from '../core/db/app-db-router.js';
import { createChildLogger } from '../core/utils/logger.js';

const log = createChildLogger('socket:remediation');
let remediationNamespace: Namespace | null = null;

export function setupRemediationNamespace(ns: Namespace) {
  remediationNamespace = ns;
  ns.on('connection', (socket) => {
    const userId = socket.data.user?.sub || 'unknown';
    log.info({ userId }, 'Remediation client connected');

    // Send pending actions on connect
    socket.on('actions:list', async (data?: { status?: string }) => {
      try {
        const db = getDbForDomain('actions');
        let query = 'SELECT * FROM actions';
        const params: unknown[] = [];

        if (data?.status) {
          query += ' WHERE status = ?';
          params.push(data.status);
        }

        query += ' ORDER BY created_at DESC LIMIT 100';
        const actions = await db.query(query, params);
        socket.emit('actions:list', { actions });
      } catch (err) {
        log.error({ err }, 'Failed to fetch actions');
        socket.emit('actions:error', { error: 'Failed to fetch actions' });
      }
    });

    socket.on('disconnect', () => {
      log.info({ userId }, 'Remediation client disconnected');
    });
  });
}

export function broadcastActionUpdate(action: Record<string, unknown>) {
  if (!remediationNamespace) return;
  remediationNamespace.emit('actions:updated', action);
}

export function broadcastNewAction(action: Record<string, unknown>) {
  if (!remediationNamespace) return;
  remediationNamespace.emit('actions:new', action);
}
