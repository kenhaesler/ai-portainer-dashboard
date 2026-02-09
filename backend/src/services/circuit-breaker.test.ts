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
      vi.advanceTimersByTime(3000);
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
});
