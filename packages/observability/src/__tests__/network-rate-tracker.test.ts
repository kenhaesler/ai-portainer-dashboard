import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  recordNetworkSample,
  getRatesForEndpoint,
  getAllRates,
  pruneStaleEntries,
  _resetTracker,
} from '../services/network-rate-tracker.js';

describe('network-rate-tracker', () => {
  beforeEach(() => {
    _resetTracker();
  });

  it('returns empty rates for unknown endpoint', () => {
    expect(getRatesForEndpoint(999)).toEqual({});
  });

  it('returns zero rates after a single sample (no delta yet)', () => {
    recordNetworkSample(1, 'c1', 1000, 2000);
    const rates = getRatesForEndpoint(1);
    expect(rates['c1']).toEqual({ rxBytesPerSec: 0, txBytesPerSec: 0 });
  });

  it('computes rates from two consecutive samples', () => {
    // First sample
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    recordNetworkSample(1, 'c1', 1000, 2000);

    // Second sample 60 seconds later
    vi.spyOn(Date, 'now').mockReturnValue(now + 60_000);
    recordNetworkSample(1, 'c1', 7000, 5000);

    const rates = getRatesForEndpoint(1);
    // rx: (7000-1000)/60 = 100, tx: (5000-2000)/60 = 50
    expect(rates['c1'].rxBytesPerSec).toBeCloseTo(100, 1);
    expect(rates['c1'].txBytesPerSec).toBeCloseTo(50, 1);

    vi.restoreAllMocks();
  });

  it('clamps negative delta to zero (counter reset on container restart)', () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    recordNetworkSample(1, 'c1', 50000, 30000);

    vi.spyOn(Date, 'now').mockReturnValue(now + 60_000);
    recordNetworkSample(1, 'c1', 100, 200); // reset — much lower

    const rates = getRatesForEndpoint(1);
    expect(rates['c1'].rxBytesPerSec).toBe(0);
    expect(rates['c1'].txBytesPerSec).toBe(0);

    vi.restoreAllMocks();
  });

  it('tracks multiple containers on the same endpoint', () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    recordNetworkSample(1, 'c1', 0, 0);
    recordNetworkSample(1, 'c2', 0, 0);

    vi.spyOn(Date, 'now').mockReturnValue(now + 10_000);
    recordNetworkSample(1, 'c1', 10240, 5120);
    recordNetworkSample(1, 'c2', 1048576, 0);

    const rates = getRatesForEndpoint(1);
    expect(rates['c1'].rxBytesPerSec).toBeCloseTo(1024, 0); // 10KB/s
    expect(rates['c2'].rxBytesPerSec).toBeCloseTo(104857.6, 0); // ~100KB/s

    vi.restoreAllMocks();
  });

  it('isolates rates by endpoint', () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    recordNetworkSample(1, 'c1', 0, 0);
    recordNetworkSample(2, 'c2', 0, 0);

    vi.spyOn(Date, 'now').mockReturnValue(now + 10_000);
    recordNetworkSample(1, 'c1', 10000, 0);
    recordNetworkSample(2, 'c2', 20000, 0);

    expect(Object.keys(getRatesForEndpoint(1))).toEqual(['c1']);
    expect(Object.keys(getRatesForEndpoint(2))).toEqual(['c2']);

    vi.restoreAllMocks();
  });

  it('getAllRates returns rates across all endpoints', () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    recordNetworkSample(1, 'c1', 0, 0);
    recordNetworkSample(2, 'c2', 0, 0);

    vi.spyOn(Date, 'now').mockReturnValue(now + 10_000);
    recordNetworkSample(1, 'c1', 10000, 5000);
    recordNetworkSample(2, 'c2', 20000, 8000);

    const rates = getAllRates();
    // Both containers from different endpoints should appear
    expect(Object.keys(rates).sort()).toEqual(['c1', 'c2']);
    expect(rates['c1'].rxBytesPerSec).toBeCloseTo(1000, 0); // 10000/10
    expect(rates['c1'].txBytesPerSec).toBeCloseTo(500, 0);  // 5000/10
    expect(rates['c2'].rxBytesPerSec).toBeCloseTo(2000, 0); // 20000/10
    expect(rates['c2'].txBytesPerSec).toBeCloseTo(800, 0);  // 8000/10

    vi.restoreAllMocks();
  });

  it('getAllRates returns empty object when no samples recorded', () => {
    expect(getAllRates()).toEqual({});
  });

  describe('pruneStaleEntries (issue #1111)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('removes all entries when staleMs is 0', () => {
      for (let i = 0; i < 10; i++) {
        recordNetworkSample(1, `c${i}`, 0, 0);
      }
      expect(Object.keys(getAllRates())).toHaveLength(10);

      const removed = pruneStaleEntries(0);

      expect(removed).toBe(10);
      expect(getAllRates()).toEqual({});
    });

    it('returns 0 when no entries are stale', () => {
      recordNetworkSample(1, 'fresh', 0, 0);
      const removed = pruneStaleEntries(120_000);
      expect(removed).toBe(0);
      expect(getAllRates()).toHaveProperty('fresh');
    });

    it('returns the correct count of removed entries', () => {
      for (let i = 0; i < 7; i++) {
        recordNetworkSample(1, `c${i}`, 0, 0);
      }
      const removed = pruneStaleEntries(0);
      expect(removed).toBe(7);
    });

    it('removes only entries older than staleMs (default 120s)', () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);

      // 100 stale entries recorded at t=0
      for (let i = 0; i < 100; i++) {
        recordNetworkSample(1, `c${i}`, 0, 0);
      }
      expect(Object.keys(getAllRates())).toHaveLength(100);

      // Advance virtual clock 200s so existing entries are now stale
      vi.setSystemTime(200_000);

      // One fresh entry
      recordNetworkSample(1, 'fresh', 0, 0);

      const removed = pruneStaleEntries(120_000);

      expect(removed).toBe(100);
      expect(Object.keys(getAllRates())).toEqual(['fresh']);
    });

    it('drops empty endpoint maps so re-recording on the same endpoint is clean', () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      recordNetworkSample(42, 'gone', 0, 0);

      vi.setSystemTime(300_000);
      const removed = pruneStaleEntries(120_000);
      expect(removed).toBe(1);

      // Re-record on endpoint 42 — its map was deleted, must be rebuilt cleanly
      recordNetworkSample(42, 'new', 0, 0);
      expect(getAllRates()).toHaveProperty('new');
      expect(getAllRates()).not.toHaveProperty('gone');
    });

    it('preserves entries across multiple endpoints when only one has stale data', () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      recordNetworkSample(1, 'old-1', 0, 0);
      recordNetworkSample(2, 'old-2', 0, 0);

      vi.setSystemTime(200_000);
      // Refresh only endpoint 1
      recordNetworkSample(1, 'old-1', 100, 100);

      const removed = pruneStaleEntries(120_000);
      expect(removed).toBe(1);
      expect(getRatesForEndpoint(1)).toHaveProperty('old-1');
      expect(getRatesForEndpoint(2)).toEqual({});
    });
  });
});
