import { describe, it, expect, vi } from 'vitest';

import { emitEvent, onEvent, getEmitter } from './event-bus.js';

describe('event-bus', () => {
  it('should emit and receive events', () => {
    const handler = vi.fn();
    const unsub = onEvent(handler);

    emitEvent({
      type: 'insight.created',
      timestamp: new Date().toISOString(),
      data: { test: true },
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'insight.created' }),
    );

    unsub();
  });

  it('should unsubscribe properly', () => {
    const handler = vi.fn();
    const unsub = onEvent(handler);

    unsub();

    emitEvent({
      type: 'test.event',
      timestamp: new Date().toISOString(),
      data: {},
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('should support multiple listeners', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    const unsub1 = onEvent(handler1);
    const unsub2 = onEvent(handler2);

    emitEvent({
      type: 'multi.test',
      timestamp: new Date().toISOString(),
      data: {},
    });

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);

    unsub1();
    unsub2();
  });

  it('should expose the emitter', () => {
    const emitter = getEmitter();
    expect(emitter).toBeDefined();
    expect(typeof emitter.on).toBe('function');
    expect(typeof emitter.emit).toBe('function');
  });
});
