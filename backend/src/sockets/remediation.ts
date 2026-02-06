import { Namespace } from 'socket.io';
import { getDb } from '../db/sqlite.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('socket:remediation');
let remediationNamespace: Namespace | null = null;

export function setupRemediationNamespace(ns: Namespace) {
  remediationNamespace = ns;
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

export function broadcastActionUpdate(action: Record<string, unknown>) {
  if (!remediationNamespace) return;
  remediationNamespace.emit('actions:updated', action);
}

export function broadcastNewAction(action: Record<string, unknown>) {
  if (!remediationNamespace) return;
  remediationNamespace.emit('actions:new', action);
}
