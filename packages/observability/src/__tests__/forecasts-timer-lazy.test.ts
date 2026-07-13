import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * #1533 regression: the narrative-cache TTL sweep timer must NOT start merely
 * by importing the forecasts route module (which happens transitively for any
 * consumer of the observability package). It starts only when the routes are
 * registered (forecastRoutes → startCacheSweep) and is cleanly stoppable.
 */
describe('forecasts narrative-cache sweep timer is lazy (#1533)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it('starts no timer on import; startCacheSweep adds exactly one and is idempotent', async () => {
    vi.resetModules();
    vi.useFakeTimers();

    const mod = await import('../routes/forecasts.js');

    // Nothing is running yet — stopCacheSweep() before any start is a no-op,
    // which would be false if the module had auto-started a sweep at import.
    const afterImport = vi.getTimerCount();
    mod.stopCacheSweep();
    expect(vi.getTimerCount()).toBe(afterImport);

    const baseline = vi.getTimerCount();
    mod.startCacheSweep();
    expect(vi.getTimerCount()).toBe(baseline + 1);

    // Idempotent — registering twice must not stack timers.
    mod.startCacheSweep();
    expect(vi.getTimerCount()).toBe(baseline + 1);

    mod.stopCacheSweep();
    expect(vi.getTimerCount()).toBe(baseline);
  });
});
