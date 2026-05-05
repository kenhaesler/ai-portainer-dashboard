/**
 * Per-key cooldown throttle for Socket.IO event handlers.
 *
 * Returns an instance that gates individual events keyed by an arbitrary
 * string. The recommended key shape is `${eventName}:${userId}` so the
 * throttle bucket is scoped per (event, user) pair — this prevents one
 * noisy event from blocking unrelated events for the same user, and it
 * prevents one user from blocking another.
 *
 * Buckets live in an in-process `Map`. They are bounded only by the
 * number of (event × user) pairs the server has seen since the most
 * recent `clearByUserId(userId)` call (typically issued on socket
 * `disconnect`). Callers who never disconnect are responsible for
 * issuing `clearByUserId` themselves.
 *
 * **Why a factory rather than a singleton:** different namespaces use
 * different cooldowns (LLM chat = 2000 ms, monitoring DB reads = 1000 ms,
 * etc.). Each consumer instantiates its own throttle so cooldown values
 * never collide across namespaces.
 *
 * @example
 *   const throttle = createSocketThrottle(1000); // 1s cooldown
 *   const result = throttle.check(`insights:history:${userId}`);
 *   if (!result.allowed) {
 *     socket.emit('insights:throttled', { retryAfterMs: result.retryAfterMs });
 *     return;
 *   }
 *   // ... handle event
 */
export interface ThrottleResult {
  /** True when the event is allowed (and the bucket has been bumped). */
  allowed: boolean;
  /** Milliseconds remaining until the bucket is allowed again; 0 when allowed. */
  retryAfterMs: number;
}

export interface SocketThrottle {
  /**
   * Records an event attempt for `key` and returns whether it is allowed.
   * On `allowed === true`, the internal timestamp is updated. On
   * `allowed === false`, the internal timestamp is **not** updated, so the
   * cooldown window does not slide forward on rejected attempts.
   */
  check(key: string): ThrottleResult;
  /** Removes a single key from the bucket map (idempotent). */
  clear(key: string): void;
  /**
   * Removes every key whose suffix is `:${userId}`. Intended to be called
   * from a socket `disconnect` handler so per-user buckets do not leak
   * memory across reconnects.
   */
  clearByUserId(userId: string): void;
}

export function createSocketThrottle(cooldownMs: number): SocketThrottle {
  const lastEventByKey = new Map<string, number>();

  return {
    check(key: string): ThrottleResult {
      const now = Date.now();
      const last = lastEventByKey.get(key) ?? 0;
      const elapsed = now - last;
      if (last !== 0 && elapsed < cooldownMs) {
        return { allowed: false, retryAfterMs: cooldownMs - elapsed };
      }
      lastEventByKey.set(key, now);
      return { allowed: true, retryAfterMs: 0 };
    },
    clear(key: string): void {
      lastEventByKey.delete(key);
    },
    clearByUserId(userId: string): void {
      const suffix = `:${userId}`;
      for (const k of lastEventByKey.keys()) {
        if (k.endsWith(suffix)) {
          lastEventByKey.delete(k);
        }
      }
    },
  };
}
