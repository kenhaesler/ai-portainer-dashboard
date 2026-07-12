import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryPersistenceStore,
  RedisPersistenceStore,
  ResilientPersistenceStore,
} from './persistence-store.js';
import type { RedisConnectionLike } from './resilient-redis.js';

describe('InMemoryPersistenceStore', () => {
  let store: InMemoryPersistenceStore;
  beforeEach(() => {
    store = new InMemoryPersistenceStore();
  });

  it('counts anomalous decisions within the last N (M-of-N)', async () => {
    // record a 3-of-5 pattern: F, T, F, T, T  → last 5 has 3 anomalous
    expect(await store.record('k', false, 5)).toBe(0);
    expect(await store.record('k', true, 5)).toBe(1);
    expect(await store.record('k', false, 5)).toBe(1);
    expect(await store.record('k', true, 5)).toBe(2);
    expect(await store.record('k', true, 5)).toBe(3);
  });

  it('only counts the most recent N decisions (older ones roll off)', async () => {
    for (let i = 0; i < 5; i++) await store.record('k', true, 5); // 5 trues
    // now push 3 falses → window [F,F,F,T,T] → 2 anomalous
    await store.record('k', false, 5);
    await store.record('k', false, 5);
    expect(await store.record('k', false, 5)).toBe(2);
  });

  it('keeps keys independent', async () => {
    await store.record('a', true, 5);
    expect(await store.record('b', false, 5)).toBe(0);
  });

  it('reset clears history', async () => {
    await store.record('k', true, 5);
    await store.reset();
    expect(await store.record('k', false, 5)).toBe(0);
  });
});

describe('RedisPersistenceStore', () => {
  function fakeClient() {
    const lists = new Map<string, string[]>();
    return {
      lists,
      lPush: async (k: string, v: string) => {
        const arr = lists.get(k) ?? [];
        arr.unshift(v);
        lists.set(k, arr);
      },
      lTrim: async (k: string, start: number, stop: number) => {
        const arr = lists.get(k) ?? [];
        lists.set(k, arr.slice(start, stop + 1));
      },
      lRange: async (k: string, start: number, stop: number) =>
        (lists.get(k) ?? []).slice(start, stop + 1),
      pExpire: async () => undefined,
    };
  }

  it('records newest-first, trims to N, and counts anomalous like the in-memory store', async () => {
    const client = fakeClient();
    const store = new RedisPersistenceStore(client);
    expect(await store.record('k', false, 5)).toBe(0);
    expect(await store.record('k', true, 5)).toBe(1);
    expect(await store.record('k', true, 5)).toBe(2);
    // list capped at N
    expect(client.lists.get('anomaly:persist:k')!.length).toBeLessThanOrEqual(5);
  });

  it('rolls older decisions off beyond N', async () => {
    const client = fakeClient();
    const store = new RedisPersistenceStore(client);
    for (let i = 0; i < 5; i++) await store.record('k', true, 5);
    await store.record('k', false, 5);
    await store.record('k', false, 5);
    expect(await store.record('k', false, 5)).toBe(2);
  });
});

// #1496 — record() sits inside the anomaly gate on the monitoring cycle's hot
// path; a rejection here used to abort the whole cycle. The resilient store
// must degrade to the per-process in-memory history instead.
describe('ResilientPersistenceStore (#1496)', () => {
  function flakyListClient() {
    const lists = new Map<string, string[]>();
    let failing = false;
    return {
      lists,
      setFailing(v: boolean) {
        failing = v;
      },
      lPush: async (k: string, v: string) => {
        if (failing) throw new Error('ClientClosedError');
        const arr = lists.get(k) ?? [];
        arr.unshift(v);
        lists.set(k, arr);
      },
      lTrim: async (k: string, start: number, stop: number) => {
        if (failing) throw new Error('ClientClosedError');
        const arr = lists.get(k) ?? [];
        lists.set(k, arr.slice(start, stop + 1));
      },
      lRange: async (k: string, start: number, stop: number) => {
        if (failing) throw new Error('ClientClosedError');
        return (lists.get(k) ?? []).slice(start, stop + 1);
      },
      pExpire: async () => {
        if (failing) throw new Error('ClientClosedError');
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

  it('records via Redis when the connection is healthy', async () => {
    const client = flakyListClient();
    const store = new ResilientPersistenceStore(fakeConn(client));
    expect(await store.record('k', true, 5)).toBe(1);
    expect(await store.record('k', true, 5)).toBe(2);
    expect(client.lists.get('anomaly:persist:k')).toEqual(['1', '1']);
  });

  it('degrades to the in-memory M-of-N window when Redis is down (getClient → null)', async () => {
    const store = new ResilientPersistenceStore(fakeConn(null));
    expect(await store.record('k', true, 5)).toBe(1);
    expect(await store.record('k', false, 5)).toBe(1);
    expect(await store.record('k', true, 5)).toBe(2); // gating still works per-process
  });

  it('fails safe on a throwing command: reports the failure, returns the shadow count, never rejects', async () => {
    const client = flakyListClient();
    const conn = fakeConn(client);
    const store = new ResilientPersistenceStore(conn);
    client.setFailing(true);
    await expect(store.record('k', true, 5)).resolves.toBe(1);
    expect(conn.failures).toContain('persistence-record-failed');
  });

  it('keeps the rolling window warm across a mid-stream Redis drop', async () => {
    const client = flakyListClient();
    const store = new ResilientPersistenceStore(fakeConn(client));
    // Healthy cycles: decisions are shadowed in memory as they happen.
    await store.record('k', true, 5);
    await store.record('k', true, 5);
    client.setFailing(true); // Redis dies mid-stream
    // The in-memory shadow already holds the two prior decisions — no warm-up gap.
    expect(await store.record('k', true, 5)).toBe(3);
  });

  it('rebinds to a fresh client after reconnection', async () => {
    const clientA = flakyListClient();
    const conn = fakeConn(clientA);
    const store = new ResilientPersistenceStore(conn);
    await store.record('k', true, 5);
    const clientB = flakyListClient();
    conn.client = clientB;
    await store.record('k', true, 5);
    expect(clientB.lists.get('anomaly:persist:k')).toEqual(['1']);
  });
});
