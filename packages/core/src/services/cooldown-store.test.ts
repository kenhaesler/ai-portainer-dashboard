import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryCooldownStore,
  RedisCooldownStore,
  ResilientCooldownStore,
} from './cooldown-store.js';
import type { RedisConnectionLike } from './resilient-redis.js';

describe('InMemoryCooldownStore', () => {
  let store: InMemoryCooldownStore;
  beforeEach(() => {
    store = new InMemoryCooldownStore();
  });

  it('is not hot for an unmarked key', async () => {
    expect(await store.isHot('k', 1000, 0)).toBe(false);
  });

  it('is hot within the window after mark, cold once it elapses', async () => {
    await store.mark('k', 1000);
    expect(await store.isHot('k', 500, 1200)).toBe(true); // 200ms elapsed < 500ms window
    expect(await store.isHot('k', 500, 1600)).toBe(false); // 600ms elapsed >= window
  });

  it('treats windowMs <= 0 as never hot', async () => {
    await store.mark('k', 0);
    expect(await store.isHot('k', 0, 0)).toBe(false);
  });

  it('keeps keys independent', async () => {
    await store.mark('a', 100);
    expect(await store.isHot('b', 1000, 150)).toBe(false);
  });

  it('reset clears state', async () => {
    await store.mark('k', 0);
    await store.reset();
    expect(await store.isHot('k', 1000, 10)).toBe(false);
  });

  it('sweep removes entries older than the cutoff and returns the count', async () => {
    await store.mark('old', 0);
    await store.mark('recent', 900);
    const swept = await store.sweep(1000, 1000); // now=1000, olderThan=1000ms
    expect(swept).toBe(1); // 'old' (age 1000 >= 1000) gone; 'recent' (age 100) kept
    expect(await store.isHot('old', 5000, 1000)).toBe(false);
    expect(await store.isHot('recent', 5000, 1000)).toBe(true);
  });

  it('sweep returns 0 when nothing is stale', async () => {
    await store.mark('k', 900);
    expect(await store.sweep(1000, 1000)).toBe(0);
  });
});

describe('RedisCooldownStore', () => {
  function fakeClient() {
    const backing = new Map<string, string>();
    const sets: Array<{ key: string; value: string; px: number }> = [];
    return {
      backing,
      sets,
      get: async (k: string) => backing.get(k) ?? null,
      set: async (k: string, v: string, opts: { PX: number }) => {
        backing.set(k, v);
        sets.push({ key: k, value: v, px: opts.PX });
      },
    };
  }

  it('marks with a timestamp and reports hot/cold by window like the in-memory store', async () => {
    const client = fakeClient();
    const store = new RedisCooldownStore(client);
    expect(await store.isHot('k', 1000, 0)).toBe(false);
    await store.mark('k', 1000);
    expect(await store.isHot('k', 500, 1200)).toBe(true);
    expect(await store.isHot('k', 500, 1600)).toBe(false);
  });

  it('namespaces keys and sets a PX TTL so entries self-expire (replica-safe)', async () => {
    const client = fakeClient();
    await new RedisCooldownStore(client).mark('latency_p95:api', 0);
    expect(client.sets[0].key).toBe('anomaly:cooldown:latency_p95:api');
    expect(client.sets[0].px).toBeGreaterThan(0);
  });
});

// #1496 — a Redis blip must degrade the store, never reject: an unhandled
// rejection here used to abort the whole monitoring cycle, permanently
// disabling anomaly detection until restart.
describe('ResilientCooldownStore (#1496)', () => {
  function flakyClient() {
    const backing = new Map<string, string>();
    let failing = false;
    return {
      backing,
      setFailing(v: boolean) {
        failing = v;
      },
      get: async (k: string) => {
        if (failing) throw new Error('ClientClosedError');
        return backing.get(k) ?? null;
      },
      set: async (k: string, v: string) => {
        if (failing) throw new Error('ClientClosedError');
        backing.set(k, v);
      },
    };
  }

  function fakeConn(initialClient: object | null) {
    const conn = {
      client: initialClient,
      failures: [] as string[],
      getClient: async () => conn.client,
      reportFailure: (reason: string) => {
        conn.failures.push(reason);
      },
    };
    return conn as RedisConnectionLike & typeof conn;
  }

  it('uses Redis when the connection is healthy', async () => {
    const client = flakyClient();
    const store = new ResilientCooldownStore(fakeConn(client));
    await store.mark('k', 1000);
    expect(client.backing.get('anomaly:cooldown:k')).toBe('1000');
    expect(await store.isHot('k', 500, 1200)).toBe(true);
    expect(await store.isHot('k', 500, 1600)).toBe(false);
  });

  it('degrades to the in-memory shadow when Redis is down (getClient → null)', async () => {
    const store = new ResilientCooldownStore(fakeConn(null));
    await expect(store.mark('k', 1000)).resolves.toBeUndefined();
    expect(await store.isHot('k', 500, 1200)).toBe(true); // memory-backed suppression
    expect(await store.isHot('k', 500, 1600)).toBe(false);
  });

  it('fails open on a throwing command: reports the failure, never rejects', async () => {
    const client = flakyClient();
    const conn = fakeConn(client);
    const store = new ResilientCooldownStore(conn);
    client.setFailing(true);
    // No in-memory mark yet → unknown state reads as "not hot" (fail-open).
    await expect(store.isHot('k', 1000, 0)).resolves.toBe(false);
    await expect(store.mark('k', 0)).resolves.toBeUndefined();
    expect(conn.failures).toContain('cooldown-isHot-failed');
    expect(conn.failures).toContain('cooldown-mark-failed');
  });

  it('keeps suppressing from the in-memory shadow when Redis drops mid-stream', async () => {
    const client = flakyClient();
    const store = new ResilientCooldownStore(fakeConn(client));
    await store.mark('k', 1000); // healthy: written to Redis AND the shadow
    client.setFailing(true); // Redis dies
    expect(await store.isHot('k', 500, 1200)).toBe(true); // answered from the shadow
  });

  it('rebinds to a fresh client after reconnection', async () => {
    const clientA = flakyClient();
    const conn = fakeConn(clientA);
    const store = new ResilientCooldownStore(conn);
    await store.mark('a', 0);
    const clientB = flakyClient();
    conn.client = clientB; // reconnect handed out a new client
    await store.mark('b', 0);
    expect(clientA.backing.has('anomaly:cooldown:b')).toBe(false);
    expect(clientB.backing.has('anomaly:cooldown:b')).toBe(true);
  });

  it('sweep and reset clear the in-memory shadow', async () => {
    const conn = fakeConn(null); // memory-only mode
    const store = new ResilientCooldownStore(conn);
    await store.mark('old', 0);
    await store.mark('recent', 900);
    expect(await store.sweep(1000, 1000)).toBe(1);
    await store.reset();
    expect(await store.isHot('recent', 5000, 1000)).toBe(false);
  });
});
