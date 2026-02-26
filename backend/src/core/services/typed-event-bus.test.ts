import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DashboardEvent } from '@dashboard/contracts';

// Import the module fresh each test using a factory so state resets.
// We test the TypedEventBus class directly by re-importing.

// Local test-only event bus instance to avoid shared singleton state
const { eventBus } = await import('./typed-event-bus.js');

describe('TypedEventBus', () => {
  // Each test cleans up via unsubscribe — no shared state

  describe('emit / on (typed subscription)', () => {
    it('delivers event to subscribed handler', () => {
      const handler = vi.fn();
      const unsub = eventBus.on('insight.created', handler);

      eventBus.emit('insight.created', {
        insightId: 'i1', severity: 'warning', category: 'cpu',
        title: 'High CPU', description: 'Usage > 90%',
        containerId: 'c1', containerName: 'nginx', endpointId: 1,
      });

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0]).toMatchObject({ type: 'insight.created' });
      unsub();
    });

    it('does not deliver events of different type', () => {
      const handler = vi.fn();
      const unsub = eventBus.on('anomaly.detected', handler);

      eventBus.emit('insight.created', {
        insightId: 'i1', severity: 'info', category: 'cpu', title: 'T',
        description: 'D', containerId: null, containerName: null, endpointId: null,
      });

      expect(handler).not.toHaveBeenCalled();
      unsub();
    });

    it('delivers to multiple handlers for same type', () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      const unsub1 = eventBus.on('harbor.sync_completed', h1);
      const unsub2 = eventBus.on('harbor.sync_completed', h2);

      eventBus.emit('harbor.sync_completed', { projects: 3, vulnerabilities: 0 });

      expect(h1).toHaveBeenCalledOnce();
      expect(h2).toHaveBeenCalledOnce();
      unsub1();
      unsub2();
    });

    it('unsubscribe stops delivery', () => {
      const handler = vi.fn();
      const unsub = eventBus.on('investigation.triggered', handler);
      unsub();

      eventBus.emit('investigation.triggered', { insightId: 'i1' });

      expect(handler).not.toHaveBeenCalled();
    });

    it('event payload has correct type discriminant and data', () => {
      let received: DashboardEvent | null = null;
      const unsub = eventBus.on('remediation.approved', (event) => {
        received = event;
      });

      eventBus.emit('remediation.approved', { actionId: 'a1', approvedBy: 'alice' });

      expect(received).toMatchObject({
        type: 'remediation.approved',
        data: { actionId: 'a1', approvedBy: 'alice' },
      });
      unsub();
    });

    it('remediation.rejected carries nullable reason', () => {
      const handler = vi.fn();
      const unsub = eventBus.on('remediation.rejected', handler);

      eventBus.emit('remediation.rejected', { actionId: 'a1', rejectedBy: 'bob', reason: null });

      expect(handler.mock.calls[0][0].data.reason).toBeNull();
      unsub();
    });
  });

  describe('error isolation', () => {
    it('a throwing handler does not prevent other handlers from running', () => {
      const bad = vi.fn().mockImplementation(() => { throw new Error('boom'); });
      const good = vi.fn();
      const unsub1 = eventBus.on('container.state_changed', bad);
      const unsub2 = eventBus.on('container.state_changed', good);

      expect(() =>
        eventBus.emit('container.state_changed', { containerId: 'c1', newState: 'stopped' })
      ).not.toThrow();

      expect(bad).toHaveBeenCalledOnce();
      expect(good).toHaveBeenCalledOnce();
      unsub1();
      unsub2();
    });
  });

  describe('onAny (wildcard subscription)', () => {
    it('receives all event types', () => {
      const handler = vi.fn();
      const unsub = eventBus.onAny(handler);

      eventBus.emit('harbor.sync_completed', { projects: 1, vulnerabilities: 0 });
      eventBus.emit('investigation.triggered', { insightId: 'x' });

      expect(handler).toHaveBeenCalledTimes(2);
      unsub();
    });

    it('unsubscribe stops wildcard delivery', () => {
      const handler = vi.fn();
      const unsub = eventBus.onAny(handler);
      unsub();

      eventBus.emit('harbor.sync_completed', { projects: 0, vulnerabilities: 0 });

      expect(handler).not.toHaveBeenCalled();
    });

    it('wildcard receives typed event payload', () => {
      let received: DashboardEvent | null = null;
      const unsub = eventBus.onAny((event) => { received = event; });

      eventBus.emit('remediation.approved', { actionId: 'a2', approvedBy: 'carol' });

      expect(received).toMatchObject({ type: 'remediation.approved' });
      unsub();
    });
  });

  describe('emitAsync', () => {
    it('awaits all async handlers', async () => {
      const order: number[] = [];
      const h1 = async () => { order.push(1); };
      const h2 = async () => { order.push(2); };
      const unsub1 = eventBus.on('investigation.triggered', h1);
      const unsub2 = eventBus.on('investigation.triggered', h2);

      await eventBus.emitAsync('investigation.triggered', { insightId: 'i1' });

      expect(order).toHaveLength(2);
      expect(order).toContain(1);
      expect(order).toContain(2);
      unsub1();
      unsub2();
    });

    it('a rejecting async handler does not reject emitAsync', async () => {
      const bad = vi.fn().mockRejectedValue(new Error('async boom'));
      const good = vi.fn().mockResolvedValue(undefined);
      const unsub1 = eventBus.on('container.state_changed', bad);
      const unsub2 = eventBus.on('container.state_changed', good);

      await expect(
        eventBus.emitAsync('container.state_changed', { containerId: 'c1', newState: 'running' })
      ).resolves.toBeUndefined();

      expect(good).toHaveBeenCalledOnce();
      unsub1();
      unsub2();
    });
  });

  describe('performance', () => {
    it('emits to 10 handlers in < 1ms', () => {
      const unsubs: Array<() => void> = [];
      for (let i = 0; i < 10; i++) {
        unsubs.push(eventBus.on('harbor.sync_completed', vi.fn()));
      }

      const start = performance.now();
      eventBus.emit('harbor.sync_completed', { projects: 0, vulnerabilities: 0 });
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(1);
      unsubs.forEach((u) => u());
    });
  });
});
