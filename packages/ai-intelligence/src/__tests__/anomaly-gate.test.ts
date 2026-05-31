import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setConfigForTest, resetConfig } from '@dashboard/core/config/index.js';
import {
  InMemoryPersistenceStore,
  setPersistenceStoreForTest,
} from '@dashboard/core/services/persistence-store.js';
import { confirmAnomaly, routeSeverity } from '../services/anomaly-gate.js';

const baseCfg = {
  ANOMALY_PERSISTENCE_ENABLED: true,
  ANOMALY_PERSISTENCE_M: 3,
  ANOMALY_PERSISTENCE_N: 5,
  ANOMALY_FAST_BURN_MULTIPLIER: 2,
};

describe('confirmAnomaly — M-of-N persistence + multi-window (#1363)', () => {
  beforeEach(() => {
    setPersistenceStoreForTest(new InMemoryPersistenceStore());
    setConfigForTest(baseCfg);
  });
  afterEach(() => {
    setPersistenceStoreForTest(null);
    resetConfig();
  });

  it('suppresses an isolated anomaly until it persists (≥ M of N)', async () => {
    expect((await confirmAnomaly({ key: 'c1:cpu', isAnomalous: true, severity: 1.2 })).emit).toBe(false); // 1/5
    await confirmAnomaly({ key: 'c1:cpu', isAnomalous: false, severity: 0 }); // F
    expect((await confirmAnomaly({ key: 'c1:cpu', isAnomalous: true, severity: 1.2 })).emit).toBe(false); // 2/5
    const r = await confirmAnomaly({ key: 'c1:cpu', isAnomalous: true, severity: 1.2 }); // 3/5
    expect(r.emit).toBe(true);
    expect(r.reason).toBe('persistence');
  });

  it('fast-burn: a severe single sample (≥ multiplier × threshold) emits immediately', async () => {
    const r = await confirmAnomaly({ key: 'c1:cpu', isAnomalous: true, severity: 2.5 });
    expect(r.emit).toBe(true);
    expect(r.reason).toBe('fast-burn');
  });

  it('records non-anomalous decisions (window rolls) but does not emit', async () => {
    const r = await confirmAnomaly({ key: 'c1:cpu', isAnomalous: false, severity: 0 });
    expect(r.emit).toBe(false);
    expect(r.reason).toBe('suppressed');
  });

  it('keeps per-key windows independent', async () => {
    // 'a' reaches 3/5; 'b' should be unaffected.
    for (let i = 0; i < 3; i++) await confirmAnomaly({ key: 'a', isAnomalous: true, severity: 1.2 });
    const rb = await confirmAnomaly({ key: 'b', isAnomalous: true, severity: 1.2 });
    expect(rb.emit).toBe(false); // 1/5 for b
  });

  it('emits on any anomaly when persistence is disabled', async () => {
    setConfigForTest({ ...baseCfg, ANOMALY_PERSISTENCE_ENABLED: false });
    const r = await confirmAnomaly({ key: 'c1:cpu', isAnomalous: true, severity: 1.0 });
    expect(r.emit).toBe(true);
    expect(r.reason).toBe('disabled');
  });

  it('reports confidence as max(persistence ratio, burn magnitude)', async () => {
    // Fast-burn severe (severity 2.5, multiplier 2) → magnitude factor 1.0.
    const fb = await confirmAnomaly({ key: 'a', isAnomalous: true, severity: 2.5 });
    expect(fb.confidence).toBeCloseTo(1, 5);

    // First moderate cycle on 'b': persistence 1/5 = 0.2, magnitude 1.2/2 = 0.6
    // → confidence 0.6 (magnitude dominates early).
    const r1 = await confirmAnomaly({ key: 'b', isAnomalous: true, severity: 1.2 });
    expect(r1.confidence).toBeCloseTo(0.6, 5);

    // Low-magnitude but fully persisted on 'c': 5/5 = 1.0 dominates.
    for (let i = 0; i < 4; i++) await confirmAnomaly({ key: 'c', isAnomalous: true, severity: 1.0 });
    const r5 = await confirmAnomaly({ key: 'c', isAnomalous: true, severity: 1.0 }); // 5/5
    expect(r5.confidence).toBeCloseTo(1, 5);
  });
});

describe('global detection-time suppression floor (#1363)', () => {
  beforeEach(() => {
    setPersistenceStoreForTest(new InMemoryPersistenceStore());
    setConfigForTest(baseCfg);
  });
  afterEach(() => {
    setPersistenceStoreForTest(null);
    resetConfig();
  });

  it('suppresses a confirmed anomaly whose confidence is below the floor', async () => {
    setConfigForTest({ ...baseCfg, ANOMALY_SUPPRESS_BELOW_CONFIDENCE: 0.65 });
    // 3-of-5 at low magnitude → confidence 0.6 < 0.65 → dropped entirely.
    for (let i = 0; i < 2; i++) await confirmAnomaly({ key: 'k', isAnomalous: true, severity: 1.0 });
    const r = await confirmAnomaly({ key: 'k', isAnomalous: true, severity: 1.0 });
    expect(r.emit).toBe(false);
    expect(r.reason).toBe('suppressed');
  });

  it('never suppresses a severe (fast-burn) anomaly regardless of the floor', async () => {
    setConfigForTest({ ...baseCfg, ANOMALY_SUPPRESS_BELOW_CONFIDENCE: 0.9 });
    const r = await confirmAnomaly({ key: 'k', isAnomalous: true, severity: 2.5 }); // confidence 1.0
    expect(r.emit).toBe(true);
    expect(r.reason).toBe('fast-burn');
  });

  it('a floor of 0 suppresses nothing (default)', async () => {
    setConfigForTest({ ...baseCfg, ANOMALY_SUPPRESS_BELOW_CONFIDENCE: 0 });
    for (let i = 0; i < 2; i++) await confirmAnomaly({ key: 'k', isAnomalous: true, severity: 1.0 });
    const r = await confirmAnomaly({ key: 'k', isAnomalous: true, severity: 1.0 });
    expect(r.emit).toBe(true);
    expect(r.reason).toBe('persistence');
  });
});

describe('routeSeverity — severity × confidence routing (#1363)', () => {
  const minSurface = 0.7;

  it('routes low-confidence anomalies to the info (log) tier', () => {
    // 3-of-5 with low magnitude → confidence 0.6 < 0.7 → quieter tier.
    expect(routeSeverity(0.6, 3.5, minSurface)).toBe('info');
  });

  it('routes confident, moderate anomalies to warning', () => {
    expect(routeSeverity(0.8, 3.5, minSurface)).toBe('warning'); // |z| <= 4
  });

  it('routes confident, large-magnitude anomalies to critical', () => {
    expect(routeSeverity(1.0, 5, minSurface)).toBe('critical'); // |z| > 4
  });

  it('surfaces everything when minSurface is 0', () => {
    expect(routeSeverity(0, 3.5, 0)).toBe('warning');
  });
});
