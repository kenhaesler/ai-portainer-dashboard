import { Namespace } from 'socket.io';
import { getDb } from '../db/sqlite.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('socket:remediation');

export function setupRemediationNamespace(ns: Namespace) {
  ns.on('connection', (socket) => {
    const userId = socket.data.user?.sub || 'unknown';
    log.info({ userId }, 'Remediation client connected');

    // Send pending actions on connect
    socket.on('actions:list', (data?: { status?: string }) => {
      try {
        const db = getDb();
        let query = 'SELECT * FROM actions';
        const params: unknown[] = [];

        if (data?.status) {
          query += ' WHERE status = ?';
          params.push(data.status);
        }

        query += ' ORDER BY created_at DESC LIMIT 100';
        const actions = db.prepare(query).all(...params);
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

// Call this when action status changes
export function broadcastActionUpdate(ns: Namespace, action: Record<string, unknown>) {
  ns.emit('actions:updated', action);
}

// Call this when new action is suggested
export function broadcastNewAction(ns: Namespace, action: Record<string, unknown>) {
  ns.emit('actions:new', action);
}
