import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSocketThrottle } from './socket-throttle.js';

describe('createSocketThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('check() returns true (allowed) on the first call for a key', () => {
    const throttle = createSocketThrottle(1000);
    const result = throttle.check('event:user-1');
    expect(result.allowed).toBe(true);
    expect(result.retryAfterMs).toBe(0);
  });

  it('check() returns false (throttled) on a second call within the cooldown window', () => {
    const throttle = createSocketThrottle(1000);

    const first = throttle.check('event:user-1');
    expect(first.allowed).toBe(true);

    vi.advanceTimersByTime(500);

    const second = throttle.check('event:user-1');
    expect(second.allowed).toBe(false);
    expect(second.retryAfterMs).toBeGreaterThan(0);
    expect(second.retryAfterMs).toBeLessThanOrEqual(1000);
  });

  it('check() returns true (allowed) again once the cooldown elapses', () => {
    const throttle = createSocketThrottle(1000);

    expect(throttle.check('event:user-1').allowed).toBe(true);

    vi.advanceTimersByTime(1001);

    const result = throttle.check('event:user-1');
    expect(result.allowed).toBe(true);
    expect(result.retryAfterMs).toBe(0);
  });

  it('different keys have independent throttle buckets', () => {
    const throttle = createSocketThrottle(1000);

    expect(throttle.check('event:user-1').allowed).toBe(true);
    // user-1 is now throttled, but user-2 should still be allowed
    expect(throttle.check('event:user-2').allowed).toBe(true);

    vi.advanceTimersByTime(100);

    expect(throttle.check('event:user-1').allowed).toBe(false);
    expect(throttle.check('event:user-2').allowed).toBe(false);
  });

  it('different events for the same user are independent (key includes event name)', () => {
    const throttle = createSocketThrottle(1000);

    expect(throttle.check('insights:history:user-1').allowed).toBe(true);
    // Same user but a different event must NOT be throttled
    expect(throttle.check('actions:list:user-1').allowed).toBe(true);
  });

  it('clear() removes a single key from the bucket map', () => {
    const throttle = createSocketThrottle(1000);

    throttle.check('event:user-1');
    expect(throttle.check('event:user-1').allowed).toBe(false);

    throttle.clear('event:user-1');
    // After clearing, the next call is allowed again
    expect(throttle.check('event:user-1').allowed).toBe(true);
  });

  it('clear() on a non-existent key is a no-op (does not throw)', () => {
    const throttle = createSocketThrottle(1000);
    expect(() => throttle.clear('does-not-exist')).not.toThrow();
  });

  it('clearByUserId() removes all keys for a given user across multiple events', () => {
    const throttle = createSocketThrottle(1000);

    throttle.check('insights:history:user-1');
    throttle.check('actions:list:user-1');
    throttle.check('insights:history:user-2');

    // user-1 throttled on both events
    expect(throttle.check('insights:history:user-1').allowed).toBe(false);
    expect(throttle.check('actions:list:user-1').allowed).toBe(false);

    throttle.clearByUserId('user-1');

    // user-1 entries are cleared
    expect(throttle.check('insights:history:user-1').allowed).toBe(true);
    expect(throttle.check('actions:list:user-1').allowed).toBe(true);
    // user-2 is unaffected
    expect(throttle.check('insights:history:user-2').allowed).toBe(false);
  });

  it('retryAfterMs is bounded by the cooldown', () => {
    const throttle = createSocketThrottle(2000);

    throttle.check('event:user-1');
    // 1ms after the first allowed call
    vi.advanceTimersByTime(1);

    const result = throttle.check('event:user-1');
    expect(result.allowed).toBe(false);
    // retryAfterMs should be close to (but no more than) the cooldown
    expect(result.retryAfterMs).toBeGreaterThan(1900);
    expect(result.retryAfterMs).toBeLessThanOrEqual(2000);
  });
});
