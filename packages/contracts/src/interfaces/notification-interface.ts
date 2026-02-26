import type { Insight } from '../schemas/insight.js';

/**
 * Abstract interface for insight notifications.
 * Implemented by notification-service in @dashboard/operations.
 * Injected into monitoring-service to break the ai-intelligence → operations import cycle.
 */
export interface NotificationInterface {
  notifyInsight(insight: Insight): Promise<void>;
}
