import { describe, it, expect, vi } from 'vitest';
import {
  runAnomalyAutoTuneJob,
  ANOMALY_THRESHOLD_SETTING_KEY,
  type AutoTuneJobPrimitives,
} from '../services/anomaly-autotune-job.js';
import type { FeedbackRow } from '../services/anomaly-labels.js';

const FP_HEAVY: FeedbackRow[] = Array.from({ length: 30 }, (_, i) => ({
  anomaly_id: `a${i}`,
  disposition: 'false-positive' as const,
  detector: 'ml-anomaly',
}));

function primitives(over: Partial<AutoTuneJobPrimitives> = {}): AutoTuneJobPrimitives {
  return {
    enabled: true,
    envThreshold: 3.5,
    targetFpRate: 0.05,
    minSamples: 20,
    lookbackDays: 30,
    db: { query: vi.fn(async () => FP_HEAVY as unknown[]) },
    getSetting: vi.fn(async () => ({ value: '3.5' })),
    setSetting: vi.fn(async () => {}),
    writeAuditLog: vi.fn(async () => {}),
    ...over,
  };
}

describe('runAnomalyAutoTuneJob — production wiring of the auto-tune loop (#1364)', () => {
  it('persists a raised threshold under the ai_tuning key and audits it', async () => {
    const p = primitives();
    const r = await runAnomalyAutoTuneJob(p);

    expect(r.applied).toBe(true);
    expect(ANOMALY_THRESHOLD_SETTING_KEY).toBe('ai_tuning.anomaly_zscore_threshold');

    const [key, value, category] = vi.mocked(p.setSetting).mock.calls[0];
    expect(key).toBe('ai_tuning.anomaly_zscore_threshold');
    expect(Number(value)).toBeCloseTo(3.85, 6); // stringified numeric threshold
    expect(category).toBe('ai_tuning');

    const [audit] = vi.mocked(p.writeAuditLog).mock.calls[0];
    expect(audit.action).toBe('anomaly_threshold_autotuned');
    expect(audit.details).toMatchObject({ previous: 3.5, rate: 1 });
  });

  it('reads the current threshold from the settings row when present', async () => {
    const p = primitives({ getSetting: vi.fn(async () => ({ value: '4.2' })) });
    const r = await runAnomalyAutoTuneJob(p);
    expect(r.previous).toBe(4.2); // setting wins over env default
  });

  it('falls back to the env threshold when the setting is missing', async () => {
    const p = primitives({ getSetting: vi.fn(async () => null), envThreshold: 3.5 });
    const r = await runAnomalyAutoTuneJob(p);
    expect(r.previous).toBe(3.5);
  });

  it('falls back to the env threshold when the setting value is unparseable', async () => {
    const p = primitives({ getSetting: vi.fn(async () => ({ value: 'not-a-number' })), envThreshold: 3.5 });
    const r = await runAnomalyAutoTuneJob(p);
    expect(r.previous).toBe(3.5);
  });

  it('does not write or audit when the flag is off', async () => {
    const p = primitives({ enabled: false });
    const r = await runAnomalyAutoTuneJob(p);
    expect(r.applied).toBe(false);
    expect(r.skipped).toBe('disabled');
    expect(p.setSetting).not.toHaveBeenCalled();
    expect(p.writeAuditLog).not.toHaveBeenCalled();
  });

  it('targets the ml-anomaly detector by default', async () => {
    const p = primitives();
    const r = await runAnomalyAutoTuneJob(p);
    expect(r.detector).toBe('ml-anomaly');
  });
});
