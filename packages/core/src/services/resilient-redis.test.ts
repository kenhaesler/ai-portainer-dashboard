import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Fake node-redis clients (#1496): each createClient() call returns a fresh
// fake whose connect() succeeds or fails according to `connectShouldFail`.
const { fakeState } = vi.hoisted(() => ({
  fakeState: {
    connectShouldFail: false,
    clients: [] as Array<ReturnType<typeof buildFakeClient>>,
  },
}));

function buildFakeClient() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const client = {
    isOpen: false,
    on(event: string, fn: (...args: unknown[]) => void) {
      const arr = listeners.get(event) ?? [];
      arr.push(fn);
      listeners.set(event, arr);
      return client;
    },
    emit(event: string, ...args: unknown[]) {
      for (const fn of listeners.get(event) ?? []) fn(...args);
    },
    removeAllListeners() {
      listeners.clear();
    },
    async connect() {
      if (fakeState.connectShouldFail) {
        throw new Error('ECONNREFUSED');
      }
      client.isOpen = true;
    },
    destroy() {
      client.isOpen = false;
    },
  };
  return client;
}

vi.mock('redis', () => ({
  createClient: vi.fn(() => {
    const client = buildFakeClient();
    fakeState.clients.push(client);
    return client;
  }),
}));

import { createClient } from 'redis';
import { ResilientRedisConnection } from './resilient-redis.js';

const mockCreateClient = vi.mocked(createClient);

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

describe('ResilientRedisConnection (#1496)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00Z'));
    fakeState.connectShouldFail = false;
    fakeState.clients.length = 0;
    mockCreateClient.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('connects lazily and reuses the open client', async () => {
    const conn = new ResilientRedisConnection('redis://localhost:6379', makeLogger(), 'test store');
    const first = await conn.getClient();
    const second = await conn.getClient();
    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
  });

  it('returns null on connect failure and backs off instead of retrying immediately', async () => {
    fakeState.connectShouldFail = true;
    const conn = new ResilientRedisConnection('redis://localhost:6379', makeLogger(), 'test store');
    expect(await conn.getClient()).toBeNull();
    // Inside the backoff window: no new connection attempt.
    expect(await conn.getClient()).toBeNull();
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
  });

  it('recreates the client after the backoff window expires (Redis recovered)', async () => {
    fakeState.connectShouldFail = true;
    const log = makeLogger();
    const conn = new ResilientRedisConnection('redis://localhost:6379', log, 'test store');
    expect(await conn.getClient()).toBeNull();

    fakeState.connectShouldFail = false; // Redis comes back
    vi.advanceTimersByTime(2_100); // past the first 2s backoff step
    const client = await conn.getClient();
    expect(client).not.toBeNull();
    expect(mockCreateClient).toHaveBeenCalledTimes(2);
    // Down → up transition is logged.
    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ previousFailures: expect.any(Number) }),
      expect.stringContaining('Redis recovered'),
    );
  });

  it("trips the backoff when the live client emits 'end' (runtime disconnect)", async () => {
    const log = makeLogger();
    const conn = new ResilientRedisConnection('redis://localhost:6379', log, 'test store');
    const client = await conn.getClient();
    expect(client).not.toBeNull();

    // Simulate Redis dying at runtime: node-redis closes the socket for good
    // (reconnectStrategy: false) and emits 'end'.
    const fake = fakeState.clients[0];
    fake.isOpen = false;
    fake.emit('end');

    // Down transition logged loudly, and the connection is now backing off.
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'redis-client-closed' }),
      expect.stringContaining('Redis unavailable'),
    );
    expect(await conn.getClient()).toBeNull();
    expect(mockCreateClient).toHaveBeenCalledTimes(1);

    // After the backoff expires the next call reconnects with a NEW client.
    vi.advanceTimersByTime(2_100);
    const reconnected = await conn.getClient();
    expect(reconnected).not.toBeNull();
    expect(reconnected).not.toBe(client);
    expect(mockCreateClient).toHaveBeenCalledTimes(2);
  });

  it('logs repeat failures at debug, not warn (no log spam during an outage)', async () => {
    fakeState.connectShouldFail = true;
    const log = makeLogger();
    const conn = new ResilientRedisConnection('redis://localhost:6379', log, 'test store');
    await conn.getClient();
    vi.advanceTimersByTime(3_000);
    await conn.getClient();
    vi.advanceTimersByTime(10_000);
    await conn.getClient();
    expect(log.warn).toHaveBeenCalledTimes(1); // only the healthy → down transition
    expect(log.debug).toHaveBeenCalled();
  });

  it('reportFailure from a store command trips the backoff window', async () => {
    const conn = new ResilientRedisConnection('redis://localhost:6379', makeLogger(), 'test store');
    const client = await conn.getClient();
    expect(client).not.toBeNull();

    conn.reportFailure('cooldown-isHot-failed', new Error('ClientClosedError'));
    expect(await conn.getClient()).toBeNull(); // backing off even though isOpen was never flipped
  });
});
