/**
 * Payload carried by insight.created and anomaly.detected events.
 * Matches the InsightInsert shape emitted by monitoring-service.
 */
export type InsightEventData = {
  insightId: string;
  severity: 'critical' | 'warning' | 'info';
  category: string;
  title: string;
  description: string;
  containerId: string | null;
  containerName: string | null;
  endpointId: number | null;
};

/**
 * Strongly-typed union of all cross-domain events in the dashboard.
 * Replaces the untyped WebhookEvent in the event bus.
 */
export type DashboardEvent =
  | { type: 'insight.created'; data: InsightEventData }
  | { type: 'anomaly.detected'; data: InsightEventData }
  | { type: 'remediation.suggested'; data: { actionId: string; insightId: string } }
  | { type: 'remediation.approved'; data: { actionId: string; approvedBy: string } }
  | { type: 'remediation.rejected'; data: { actionId: string; rejectedBy: string; reason: string | null } }
  | { type: 'investigation.triggered'; data: { insightId: string } }
  | { type: 'container.state_changed'; data: { containerId: string; newState: string } }
  | { type: 'harbor.sync_completed'; data: { projects: number; vulnerabilities: number } };

export type DashboardEventType = DashboardEvent['type'];

export type EventHandler<T extends DashboardEventType> = (
  event: Extract<DashboardEvent, { type: T }>
) => void | Promise<void>;

/** Generic event format used for webhook delivery. */
export interface WebhookEvent {
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

/** Adapts a typed DashboardEvent to the WebhookEvent wire format. */
export function toWebhookEvent(event: DashboardEvent): WebhookEvent {
  return {
    type: event.type,
    timestamp: new Date().toISOString(),
    data: event.data as Record<string, unknown>,
  };
}
