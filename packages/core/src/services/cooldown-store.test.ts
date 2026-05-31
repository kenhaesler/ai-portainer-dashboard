import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryCooldownStore, RedisCooldownStore } from './cooldown-store.js';

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
