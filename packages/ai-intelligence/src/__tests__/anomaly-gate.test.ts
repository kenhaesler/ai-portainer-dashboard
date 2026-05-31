import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setConfigForTest, resetConfig } from '@dashboard/core/config/index.js';
import {
  InMemoryPersistenceStore,
  setPersistenceStoreForTest,
} from '@dashboard/core/services/persistence-store.js';
import { confirmAnomaly } from '../services/anomaly-gate.js';

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
});
