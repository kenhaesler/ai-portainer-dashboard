import { Namespace } from 'socket.io';
import { getDb } from '../db/sqlite.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('socket:monitoring');

export function setupMonitoringNamespace(ns: Namespace) {
  ns.on('connection', (socket) => {
    const userId = socket.data.user?.sub || 'unknown';
    log.info({ userId }, 'Monitoring client connected');

    // Send recent insights on connect
    socket.on('insights:history', (data?: { limit?: number; severity?: string }) => {
      try {
        const db = getDb();
        const limit = data?.limit || 50;

        let query = 'SELECT * FROM insights';
        const params: unknown[] = [];

        if (data?.severity) {
          query += ' WHERE severity = ?';
          params.push(data.severity);
        }

        query += ' ORDER BY created_at DESC LIMIT ?';
        params.push(limit);

        const insights = db.prepare(query).all(...params);
        socket.emit('insights:history', { insights });
      } catch (err) {
        log.error({ err }, 'Failed to fetch insight history');
        socket.emit('insights:error', { error: 'Failed to fetch history' });
      }
    });

    // Send recent investigations on request
    socket.on('investigations:history', (data?: { limit?: number }) => {
      try {
        const db = getDb();
        const limit = data?.limit || 50;

        const investigations = db.prepare(
          `SELECT i.*, ins.title as insight_title, ins.severity as insight_severity, ins.category as insight_category
           FROM investigations i
           LEFT JOIN insights ins ON i.insight_id = ins.id
           ORDER BY i.created_at DESC LIMIT ?`
        ).all(limit);

        socket.emit('investigations:history', { investigations });
      } catch (err) {
        log.error({ err }, 'Failed to fetch investigation history');
        socket.emit('investigations:error', { error: 'Failed to fetch investigation history' });
      }
    });

    socket.on('insights:subscribe', (data?: { severity?: string }) => {
      if (data?.severity) {
        socket.join(`severity:${data.severity}`);
      } else {
        socket.join('severity:all');
      }
    });

    socket.on('insights:unsubscribe', () => {
      socket.rooms.forEach((room) => {
        if (room.startsWith('severity:')) socket.leave(room);
      });
    });

    socket.on('disconnect', () => {
      log.info({ userId }, 'Monitoring client disconnected');
    });
  });
}

// Call this from monitoring-service when new insights are generated
export function broadcastInsight(ns: Namespace, insight: Record<string, unknown>) {
  const severity = insight.severity as string;
  ns.to(`severity:${severity}`).emit('insights:new', insight);
  ns.to('severity:all').emit('insights:new', insight);
}

/**
 * Broadcast a batch of insights in a single event.
 * Also emits individual `insights:new` events per severity room for backward compatibility.
 */
export function broadcastInsightBatch(ns: Namespace, insights: Array<Record<string, unknown>>) {
  if (insights.length === 0) return;

  // Batch event for clients that support it
  ns.to('severity:all').emit('insights:batch', insights);

  // Per-severity room broadcasts for backward compat
  for (const insight of insights) {
    const severity = insight.severity as string;
    ns.to(`severity:${severity}`).emit('insights:new', insight);
  }
}
