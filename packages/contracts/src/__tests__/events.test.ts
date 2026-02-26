import { describe, it, expect } from 'vitest';
import { toWebhookEvent } from '../events.js';
import type { DashboardEvent } from '../events.js';

describe('toWebhookEvent', () => {
  it('converts insight.created to WebhookEvent', () => {
    const event: DashboardEvent = {
      type: 'insight.created',
      data: {
        insight: {
          id: 'i1', endpoint_id: 1, endpoint_name: 'local', container_id: 'c1',
          container_name: 'nginx', severity: 'warning', category: 'cpu',
          title: 'High CPU', description: 'CPU is high', suggested_action: null,
          is_acknowledged: 0, created_at: '2024-01-01T00:00:00.000Z',
        },
      },
    };
    const webhook = toWebhookEvent(event);
    expect(webhook.type).toBe('insight.created');
    expect(typeof webhook.timestamp).toBe('string');
    expect(webhook.data).toEqual(event.data);
  });

  it('converts harbor.sync_completed to WebhookEvent', () => {
    const event: DashboardEvent = {
      type: 'harbor.sync_completed',
      data: { projects: 5, vulnerabilities: 12 },
    };
    const webhook = toWebhookEvent(event);
    expect(webhook.type).toBe('harbor.sync_completed');
    expect(webhook.data).toEqual({ projects: 5, vulnerabilities: 12 });
  });
});
