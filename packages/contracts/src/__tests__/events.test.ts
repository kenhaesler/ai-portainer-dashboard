import { describe, it, expect } from 'vitest';
import { toWebhookEvent } from '../events.js';
import type { DashboardEvent } from '../events.js';

describe('toWebhookEvent', () => {
  it('converts insight.created to WebhookEvent', () => {
    const event: DashboardEvent = {
      type: 'insight.created',
      data: {
        insightId: 'i1',
        severity: 'warning',
        category: 'cpu',
        title: 'High CPU',
        description: 'CPU is high',
        containerId: 'c1',
        containerName: 'nginx',
        endpointId: 1,
      },
    };
    const webhook = toWebhookEvent(event);
    expect(webhook.type).toBe('insight.created');
    expect(typeof webhook.timestamp).toBe('string');
    expect(webhook.data).toEqual(event.data);
  });

  it('converts anomaly.detected to WebhookEvent', () => {
    const event: DashboardEvent = {
      type: 'anomaly.detected',
      data: {
        insightId: 'i2',
        severity: 'critical',
        category: 'anomaly',
        title: 'CPU anomaly',
        description: 'Z-score > 3',
        containerId: 'c1',
        containerName: 'redis',
        endpointId: 2,
      },
    };
    const webhook = toWebhookEvent(event);
    expect(webhook.type).toBe('anomaly.detected');
    expect(webhook.data).toHaveProperty('insightId', 'i2');
  });

  it('converts remediation.approved to WebhookEvent', () => {
    const event: DashboardEvent = {
      type: 'remediation.approved',
      data: { actionId: 'a1', approvedBy: 'admin' },
    };
    const webhook = toWebhookEvent(event);
    expect(webhook.type).toBe('remediation.approved');
    expect(webhook.data).toEqual({ actionId: 'a1', approvedBy: 'admin' });
  });

  it('converts remediation.rejected to WebhookEvent', () => {
    const event: DashboardEvent = {
      type: 'remediation.rejected',
      data: { actionId: 'a1', rejectedBy: 'admin', reason: 'Too risky' },
    };
    const webhook = toWebhookEvent(event);
    expect(webhook.type).toBe('remediation.rejected');
    expect(webhook.data).toHaveProperty('reason', 'Too risky');
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
