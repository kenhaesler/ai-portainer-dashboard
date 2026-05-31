import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryPersistenceStore, RedisPersistenceStore } from './persistence-store.js';

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
