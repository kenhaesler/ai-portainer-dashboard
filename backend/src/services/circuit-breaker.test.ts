import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CircuitBreaker, CircuitBreakerOpenError, type CircuitState } from './circuit-breaker.js';

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function createBreaker(
    overrides: Partial<{
      failureThreshold: number;
      resetTimeoutMs: number;
      isFailure: (error: unknown) => boolean;
    }> = {},
  ) {
    return new CircuitBreaker({
      name: 'test',
      failureThreshold: 3,
      resetTimeoutMs: 5000,
      ...overrides,
    });
  }

  function serverError(status = 500): Error & { status: number } {
    const err = new Error(`HTTP ${status}`) as Error & { status: number };
    err.status = status;
    return err;
  }

  function portainerIsFailure(error: unknown): boolean {
    if (error instanceof Error && 'status' in error) {
      return (error as Error & { status: number }).status >= 500;
    }
    return true;
  }

  // ── CLOSED state ──────────────────────────────────────────────────────

  describe('CLOSED state', () => {
    it('starts in CLOSED state', () => {
      expect(createBreaker().getState()).toBe('CLOSED');
    });

    it('stays CLOSED on successful calls', async () => {
      const cb = createBreaker();
      expect(await cb.execute(() => Promise.resolve('ok'))).toBe('ok');
      expect(cb.getState()).toBe('CLOSED');
    });

    it('tracks successes in stats', async () => {
      const cb = createBreaker();
      await cb.execute(() => Promise.resolve(1));
      await cb.execute(() => Promise.resolve(2));
      const s = cb.getStats();
      expect(s.successes).toBe(2);
      expect(s.failures).toBe(0);
    });

    it('stays CLOSED when failures are below threshold', async () => {
      const cb = createBreaker({ failureThreshold: 3 });
      for (let i = 0; i < 2; i++) {
        await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
      }
      expect(cb.getState()).toBe('CLOSED');
      expect(cb.getStats().failures).toBe(2);
    });

    it('transitions to OPEN after reaching failure threshold', async () => {
      const cb = createBreaker({ failureThreshold: 3 });
      for (let i = 0; i < 3; i++) {
        await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
      }
      expect(cb.getState()).toBe('OPEN');
    });

    it('records lastFailure date on failure', async () => {
      const cb = createBreaker();
      vi.setSystemTime(new Date('2026-02-08T12:00:00Z'));
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      expect(cb.getStats().lastFailure).toEqual(new Date('2026-02-08T12:00:00Z'));
    });
  });

  // ── OPEN state ────────────────────────────────────────────────────────

  describe('OPEN state', () => {
    it('rejects calls immediately with CircuitBreakerOpenError', async () => {
      const cb = createBreaker({ failureThreshold: 2 });
      for (let i = 0; i < 2; i++) {
        await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      }
      const fn = vi.fn(() => Promise.resolve('x'));
      await expect(cb.execute(fn)).rejects.toThrow(CircuitBreakerOpenError);
      expect(fn).not.toHaveBeenCalled();
    });

    it('error message includes breaker name and timeout', async () => {
      const cb = createBreaker({ failureThreshold: 1, resetTimeoutMs: 10000 });
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      try {
        await cb.execute(() => Promise.resolve('nope'));
      } catch (err) {
        expect(err).toBeInstanceOf(CircuitBreakerOpenError);
        expect((err as Error).message).toContain('test');
        expect((err as Error).message).toContain('10000ms');
      }
    });

    it('transitions to HALF_OPEN after resetTimeout elapses', async () => {
      const cb = createBreaker({ failureThreshold: 1, resetTimeoutMs: 5000 });
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      vi.advanceTimersByTime(5000);
      expect(cb.getState()).toBe('HALF_OPEN');
    });

    it('stays OPEN before resetTimeout elapses', async () => {
      const cb = createBreaker({ failureThreshold: 1, resetTimeoutMs: 5000 });
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      vi.advanceTimersByTime(4999);
      expect(cb.getState()).toBe('OPEN');
    });
  });

  // ── HALF_OPEN state ───────────────────────────────────────────────────

  describe('HALF_OPEN state', () => {
    async function getToHalfOpen(opts?: {
      failureThreshold?: number;
      resetTimeoutMs?: number;
    }) {
      const cb = createBreaker({
        failureThreshold: opts?.failureThreshold ?? 1,
        resetTimeoutMs: opts?.resetTimeoutMs ?? 5000,
      });
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      vi.advanceTimersByTime(opts?.resetTimeoutMs ?? 5000);
      expect(cb.getState()).toBe('HALF_OPEN');
      return cb;
    }

    it('transitions to CLOSED on successful probe', async () => {
      const cb = await getToHalfOpen();
      expect(await cb.execute(() => Promise.resolve('probe ok'))).toBe('probe ok');
      expect(cb.getState()).toBe('CLOSED');
    });

    it('resets failure count on successful probe', async () => {
      const cb = await getToHalfOpen();
      await cb.execute(() => Promise.resolve('ok'));
      expect(cb.getStats().failures).toBe(0);
    });

    it('transitions back to OPEN on failed probe', async () => {
      const cb = await getToHalfOpen();
      await expect(
        cb.execute(() => Promise.reject(new Error('probe fail'))),
      ).rejects.toThrow('probe fail');
      expect(cb.getState()).toBe('OPEN');
    });

    it('allows execute call to transition from OPEN to HALF_OPEN', async () => {
      const cb = createBreaker({ failureThreshold: 1, resetTimeoutMs: 5000 });
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      vi.advanceTimersByTime(5000);
      expect(await cb.execute(() => Promise.resolve('allowed'))).toBe('allowed');
      expect(cb.getState()).toBe('CLOSED');
    });
  });

  // ── isFailure predicate ───────────────────────────────────────────────

  describe('isFailure predicate', () => {
    it('4xx errors do NOT trip the breaker', async () => {
      const cb = createBreaker({ failureThreshold: 2, isFailure: portainerIsFailure });
      for (let i = 0; i < 5; i++) {
        await expect(
          cb.execute(() => Promise.reject(serverError(404))),
        ).rejects.toThrow('HTTP 404');
      }
      expect(cb.getState()).toBe('CLOSED');
      expect(cb.getStats().failures).toBe(0);
    });

    it('5xx errors trip the breaker', async () => {
      const cb = createBreaker({ failureThreshold: 2, isFailure: portainerIsFailure });
      for (let i = 0; i < 2; i++) {
        await expect(cb.execute(() => Promise.reject(serverError(502)))).rejects.toThrow();
      }
      expect(cb.getState()).toBe('OPEN');
    });

    it('network errors (no status) trip the breaker', async () => {
      const cb = createBreaker({ failureThreshold: 2, isFailure: portainerIsFailure });
      for (let i = 0; i < 2; i++) {
        await expect(
          cb.execute(() => Promise.reject(new Error('ECONNREFUSED'))),
        ).rejects.toThrow();
      }
      expect(cb.getState()).toBe('OPEN');
    });

    it('mixed 4xx and 5xx: only 5xx count toward threshold', async () => {
      const cb = createBreaker({ failureThreshold: 3, isFailure: portainerIsFailure });
      await expect(cb.execute(() => Promise.reject(serverError(500)))).rejects.toThrow();
      await expect(cb.execute(() => Promise.reject(serverError(400)))).rejects.toThrow();
      await expect(cb.execute(() => Promise.reject(serverError(401)))).rejects.toThrow();
      await expect(cb.execute(() => Promise.reject(serverError(503)))).rejects.toThrow();
      expect(cb.getStats().failures).toBe(2);
      await expect(cb.execute(() => Promise.reject(serverError(500)))).rejects.toThrow();
      expect(cb.getState()).toBe('OPEN');
    });
  });

  // ── getStats() ────────────────────────────────────────────────────────

  describe('getStats()', () => {
    it('returns correct initial stats', () => {
      expect(createBreaker().getStats()).toEqual({
        state: 'CLOSED',
        failures: 0,
        successes: 0,
        lastFailure: undefined,
        consecutiveProbeFailures: 0,
        currentResetTimeoutMs: 5000,
        degraded: false,
      });
    });

    it('returns accurate stats after mixed operations', async () => {
      const cb = createBreaker({ failureThreshold: 5 });
      await cb.execute(() => Promise.resolve('a'));
      await cb.execute(() => Promise.resolve('b'));
      await expect(cb.execute(() => Promise.reject(new Error('x')))).rejects.toThrow();
      await cb.execute(() => Promise.resolve('c'));
      const s = cb.getStats();
      expect(s.successes).toBe(3);
      expect(s.failures).toBe(1);
      expect(s.lastFailure).toBeInstanceOf(Date);
    });
  });

  // ── reset() ───────────────────────────────────────────────────────────

  describe('reset()', () => {
    it('restores to CLOSED from OPEN', async () => {
      const cb = createBreaker({ failureThreshold: 1 });
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      cb.reset();
      expect(cb.getState()).toBe('CLOSED');
      expect(cb.getStats()).toEqual({
        state: 'CLOSED',
        failures: 0,
        successes: 0,
        lastFailure: undefined,
        consecutiveProbeFailures: 0,
        currentResetTimeoutMs: 5000,
        degraded: false,
      });
    });

    it('restores to CLOSED from HALF_OPEN', async () => {
      const cb = createBreaker({ failureThreshold: 1, resetTimeoutMs: 5000 });
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      vi.advanceTimersByTime(5000);
      cb.reset();
      expect(cb.getState()).toBe('CLOSED');
    });

    it('allows normal operation after reset', async () => {
      const cb = createBreaker({ failureThreshold: 1 });
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      cb.reset();
      expect(await cb.execute(() => Promise.resolve('after reset'))).toBe('after reset');
    });
  });

  // ── Full lifecycle ────────────────────────────────────────────────────

  describe('full lifecycle', () => {
    it('CLOSED -> OPEN -> HALF_OPEN -> CLOSED full cycle', async () => {
      const states: CircuitState[] = [];
      const cb = createBreaker({ failureThreshold: 2, resetTimeoutMs: 10000 });

      states.push(cb.getState());
      await expect(cb.execute(() => Promise.reject(new Error('f1')))).rejects.toThrow();
      await expect(cb.execute(() => Promise.reject(new Error('f2')))).rejects.toThrow();
      states.push(cb.getState());
      vi.advanceTimersByTime(10000);
      states.push(cb.getState());
      await cb.execute(() => Promise.resolve('probe'));
      states.push(cb.getState());

      expect(states).toEqual(['CLOSED', 'OPEN', 'HALF_OPEN', 'CLOSED']);
    });

    it('CLOSED -> OPEN -> HALF_OPEN -> OPEN -> HALF_OPEN -> CLOSED', async () => {
      const states: CircuitState[] = [];
      const cb = createBreaker({ failureThreshold: 1, resetTimeoutMs: 3000 });

      states.push(cb.getState());
      await expect(cb.execute(() => Promise.reject(new Error('f')))).rejects.toThrow();
      states.push(cb.getState());
      vi.advanceTimersByTime(3000);
      states.push(cb.getState());
      await expect(cb.execute(() => Promise.reject(new Error('pf')))).rejects.toThrow();
      states.push(cb.getState());
      // After 1st probe failure, timeout doubles to 6000ms
      vi.advanceTimersByTime(6000);
      states.push(cb.getState());
      await cb.execute(() => Promise.resolve('ok'));
      states.push(cb.getState());

      expect(states).toEqual([
        'CLOSED',
        'OPEN',
        'HALF_OPEN',
        'OPEN',
        'HALF_OPEN',
        'CLOSED',
      ]);
    });
  });

  // ── Log noise suppression (#698) ─────────────────────────────────────

  describe('probe failure log suppression (#698)', () => {
    /** Advance through N probe failures, accounting for exponential backoff. */
    async function failProbeNTimes(cb: CircuitBreaker, n: number, baseResetTimeoutMs = 3000) {
      let currentTimeout = baseResetTimeoutMs;
      for (let i = 0; i < n; i++) {
        // Use the actual currentResetTimeoutMs from stats for accurate timing
        currentTimeout = cb.getStats().currentResetTimeoutMs;
        vi.advanceTimersByTime(currentTimeout);
        // getState() triggers HALF_OPEN transition, then execute fails the probe
        expect(cb.getState()).toBe('HALF_OPEN');
        await expect(cb.execute(() => Promise.reject(new Error('probe fail')))).rejects.toThrow();
        expect(cb.getState()).toBe('OPEN');
      }
    }

    it('maintains correct state through many consecutive probe failures', async () => {
      const cb = createBreaker({ failureThreshold: 1, resetTimeoutMs: 3000 });
      // Open the circuit
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      expect(cb.getState()).toBe('OPEN');

      // Fail probe 10 times — state should cycle OPEN->HALF_OPEN->OPEN each time
      await failProbeNTimes(cb, 10, 3000);
      expect(cb.getState()).toBe('OPEN');
    });

    it('recovers after many consecutive probe failures when probe succeeds', async () => {
      const cb = createBreaker({ failureThreshold: 1, resetTimeoutMs: 3000 });
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();

      // Fail probe 5 times (past the suppression threshold)
      await failProbeNTimes(cb, 5, 3000);

      // Now succeed — need to wait for current backoff timeout
      const currentTimeout = cb.getStats().currentResetTimeoutMs;
      vi.advanceTimersByTime(currentTimeout);
      expect(cb.getState()).toBe('HALF_OPEN');
      await cb.execute(() => Promise.resolve('recovered'));
      expect(cb.getState()).toBe('CLOSED');
    });

    it('resets probe failure counter on successful probe after failures', async () => {
      const cb = createBreaker({ failureThreshold: 1, resetTimeoutMs: 3000 });
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();

      // Fail probe 4 times
      await failProbeNTimes(cb, 4, 3000);

      // Succeed — use current backoff timeout
      const currentTimeout = cb.getStats().currentResetTimeoutMs;
      vi.advanceTimersByTime(currentTimeout);
      await cb.execute(() => Promise.resolve('ok'));
      expect(cb.getState()).toBe('CLOSED');

      // Open circuit again and fail probes — counter should start from 0
      await expect(cb.execute(() => Promise.reject(new Error('fail again')))).rejects.toThrow();
      expect(cb.getState()).toBe('OPEN');

      // First probe failure after reset should use base timeout (3000ms)
      vi.advanceTimersByTime(3000);
      await expect(cb.execute(() => Promise.reject(new Error('pf')))).rejects.toThrow();
      expect(cb.getState()).toBe('OPEN');
    });

    it('resets probe failure counter on reset()', async () => {
      const cb = createBreaker({ failureThreshold: 1, resetTimeoutMs: 3000 });
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      await failProbeNTimes(cb, 5, 3000);

      cb.reset();
      expect(cb.getState()).toBe('CLOSED');
      expect(cb.getStats().currentResetTimeoutMs).toBe(3000);

      // After reset, fresh probe failures should start counting from 0 with base timeout
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      vi.advanceTimersByTime(3000);
      await expect(cb.execute(() => Promise.reject(new Error('pf')))).rejects.toThrow();
      // Still works normally
      expect(cb.getState()).toBe('OPEN');
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('returns the value from the wrapped function', async () => {
      const obj = { data: [1, 2, 3] };
      expect(await createBreaker().execute(() => Promise.resolve(obj))).toBe(obj);
    });

    it('propagates the original error', async () => {
      const e = new TypeError('specific');
      await expect(createBreaker().execute(() => Promise.reject(e))).rejects.toBe(e);
    });

    it('handles synchronous errors', async () => {
      await expect(
        createBreaker().execute(() => {
          throw new Error('sync');
        }),
      ).rejects.toThrow('sync');
    });
  });

  // ── Exponential backoff (#694) ──────────────────────────────────────

  describe('exponential backoff (#694)', () => {
    async function openCircuit(cb: CircuitBreaker, threshold = 1) {
      for (let i = 0; i < threshold; i++) {
        await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      }
      expect(cb.getState()).toBe('OPEN');
    }

    it('doubles reset timeout after each consecutive probe failure', async () => {
      const cb = createBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });
      await openCircuit(cb);

      // 1st probe failure: timeout stays at base, but after failure it doubles to 2000ms
      vi.advanceTimersByTime(1000);
      expect(cb.getState()).toBe('HALF_OPEN');
      await expect(cb.execute(() => Promise.reject(new Error('pf1')))).rejects.toThrow();
      expect(cb.getStats().currentResetTimeoutMs).toBe(2000);

      // Need 2000ms now to transition
      vi.advanceTimersByTime(1999);
      expect(cb.getState()).toBe('OPEN');
      vi.advanceTimersByTime(1);
      expect(cb.getState()).toBe('HALF_OPEN');

      // 2nd probe failure: doubles to 4000ms
      await expect(cb.execute(() => Promise.reject(new Error('pf2')))).rejects.toThrow();
      expect(cb.getStats().currentResetTimeoutMs).toBe(4000);

      // Need 4000ms now
      vi.advanceTimersByTime(3999);
      expect(cb.getState()).toBe('OPEN');
      vi.advanceTimersByTime(1);
      expect(cb.getState()).toBe('HALF_OPEN');
    });

    it('caps backoff at 300000ms (5 minutes)', async () => {
      const cb = createBreaker({ failureThreshold: 1, resetTimeoutMs: 100000 });
      await openCircuit(cb);

      // 1st probe failure: 100000 → 200000
      vi.advanceTimersByTime(100000);
      await expect(cb.execute(() => Promise.reject(new Error('pf')))).rejects.toThrow();
      expect(cb.getStats().currentResetTimeoutMs).toBe(200000);

      // 2nd probe failure: 200000 → 300000 (capped)
      vi.advanceTimersByTime(200000);
      await expect(cb.execute(() => Promise.reject(new Error('pf')))).rejects.toThrow();
      expect(cb.getStats().currentResetTimeoutMs).toBe(300000);

      // 3rd probe failure: stays at 300000 (cap)
      vi.advanceTimersByTime(300000);
      await expect(cb.execute(() => Promise.reject(new Error('pf')))).rejects.toThrow();
      expect(cb.getStats().currentResetTimeoutMs).toBe(300000);
    });

    it('resets backoff to base on successful probe', async () => {
      const cb = createBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });
      await openCircuit(cb);

      // Fail twice to escalate timeout: 1000 → 2000 → 4000
      vi.advanceTimersByTime(1000);
      await expect(cb.execute(() => Promise.reject(new Error('pf')))).rejects.toThrow();
      vi.advanceTimersByTime(2000);
      await expect(cb.execute(() => Promise.reject(new Error('pf')))).rejects.toThrow();
      expect(cb.getStats().currentResetTimeoutMs).toBe(4000);

      // Now succeed
      vi.advanceTimersByTime(4000);
      await cb.execute(() => Promise.resolve('ok'));
      expect(cb.getState()).toBe('CLOSED');
      expect(cb.getStats().currentResetTimeoutMs).toBe(1000);
    });

    it('resets backoff to base on reset()', async () => {
      const cb = createBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });
      await openCircuit(cb);

      vi.advanceTimersByTime(1000);
      await expect(cb.execute(() => Promise.reject(new Error('pf')))).rejects.toThrow();
      expect(cb.getStats().currentResetTimeoutMs).toBe(2000);

      cb.reset();
      expect(cb.getStats().currentResetTimeoutMs).toBe(1000);
    });
  });

  // ── isDegraded (#694) ───────────────────────────────────────────────

  describe('isDegraded (#694)', () => {
    async function failProbes(cb: CircuitBreaker, n: number, resetTimeoutMs: number) {
      let currentTimeout = resetTimeoutMs;
      for (let i = 0; i < n; i++) {
        vi.advanceTimersByTime(currentTimeout);
        expect(cb.getState()).toBe('HALF_OPEN');
        await expect(cb.execute(() => Promise.reject(new Error('pf')))).rejects.toThrow();
        expect(cb.getState()).toBe('OPEN');
        currentTimeout = Math.min(currentTimeout * 2, 300000);
      }
    }

    it('returns false when circuit is CLOSED', () => {
      const cb = createBreaker();
      expect(cb.isDegraded()).toBe(false);
    });

    it('returns false when OPEN but below degraded threshold', async () => {
      const cb = createBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      expect(cb.getState()).toBe('OPEN');
      expect(cb.isDegraded()).toBe(false);

      // Fail 4 probes (threshold is 5)
      await failProbes(cb, 4, 1000);
      expect(cb.isDegraded()).toBe(false);
    });

    it('returns true after 5 consecutive probe failures', async () => {
      const cb = createBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();

      await failProbes(cb, 5, 1000);
      expect(cb.isDegraded()).toBe(true);
      expect(cb.getStats().degraded).toBe(true);
    });

    it('clears degraded status on successful probe', async () => {
      const cb = createBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });
      await expect(cb.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
      await failProbes(cb, 5, 1000);
      expect(cb.isDegraded()).toBe(true);

      // Wait for the current backoff (after 5 failures: 1000 * 2^5 = 32000ms)
      vi.advanceTimersByTime(32000);
      await cb.execute(() => Promise.resolve('recovered'));
      expect(cb.getState()).toBe('CLOSED');
      expect(cb.isDegraded()).toBe(false);
    });
  });
});
