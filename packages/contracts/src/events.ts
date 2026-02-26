import type { Insight } from './schemas/insight.js';

/**
 * Strongly-typed union of all cross-domain events in the dashboard.
 * Used to replace the loose WebhookEvent type in the event bus.
 */
export type DashboardEvent =
  | { type: 'insight.created'; data: { insight: Insight } }
  | { type: 'anomaly.detected'; data: { insight: Insight } }
  | { type: 'remediation.suggested'; data: { actionId: string; insightId: string } }
  | { type: 'investigation.triggered'; data: { insightId: string } }
  | { type: 'container.state_changed'; data: { containerId: string; newState: string } }
  | { type: 'harbor.sync_completed'; data: { projects: number; vulnerabilities: number } };

export type DashboardEventType = DashboardEvent['type'];

export type EventHandler<T extends DashboardEventType> = (
  event: Extract<DashboardEvent, { type: T }>
) => void | Promise<void>;

/**
 * Legacy generic event format used by the current event-bus implementation.
 * Retained for backward compatibility during the Phase 3 migration.
 */
export interface WebhookEvent {
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

/** Adapts a typed DashboardEvent to the legacy WebhookEvent wire format. */
export function toWebhookEvent(event: DashboardEvent): WebhookEvent {
  return {
    type: event.type,
    timestamp: new Date().toISOString(),
    data: event.data as Record<string, unknown>,
  };
}
