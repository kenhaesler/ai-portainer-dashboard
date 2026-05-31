import { describe, it, expect, vi } from 'vitest';
import { runAutoTune, type AutoTuneDeps } from '../services/anomaly-autotune.js';

function deps(over: Partial<AutoTuneDeps> = {}): AutoTuneDeps {
  return {
    enabled: true,
    getMeasuredFpRate: vi.fn(async () => ({ rate: 0.2, sampleCount: 50 })),
    getCurrentThreshold: vi.fn(async () => 3.5),
    applyThreshold: vi.fn(async () => {}),
    audit: vi.fn(async () => {}),
    ...over,
  };
}

describe('runAutoTune — gated auto-apply of the threshold recommendation (#1364)', () => {
  it('applies and audits when enabled and the FP rate is too high', async () => {
    const d = deps();
    const r = await runAutoTune(d, { detector: 'ml-anomaly' });

    expect(r.applied).toBe(true);
    expect(r.previous).toBe(3.5);
    expect(r.recommended).toBeCloseTo(3.85, 6); // raised one step
    expect(r.reason).toBe('too-many-fp');
    expect(vi.mocked(d.applyThreshold).mock.calls[0][0]).toBeCloseTo(3.85, 6);
    expect(d.audit).toHaveBeenCalledTimes(1);
    const audited = vi.mocked(d.audit).mock.calls[0][0];
    expect(audited).toMatchObject({ previous: 3.5, rate: 0.2, sampleCount: 50, detector: 'ml-anomaly', reason: 'too-many-fp' });
    expect(audited.next).toBeCloseTo(3.85, 6);
  });

  it('computes the recommendation but does NOT apply when the flag is off', async () => {
    const d = deps({ enabled: false });
    const r = await runAutoTune(d, { detector: 'ml-anomaly' });

    expect(r.applied).toBe(false);
    expect(r.skipped).toBe('disabled');
    expect(r.recommended).toBeCloseTo(3.85, 6); // still surfaces what it WOULD do
    expect(d.applyThreshold).not.toHaveBeenCalled();
    expect(d.audit).not.toHaveBeenCalled();
  });

  it('does nothing when the recommendation is within target (no change)', async () => {
    const d = deps({ getMeasuredFpRate: vi.fn(async () => ({ rate: 0.05, sampleCount: 50 })) });
    const r = await runAutoTune(d);

    expect(r.applied).toBe(false);
    expect(r.skipped).toBe('no-change');
    expect(r.reason).toBe('within-target');
    expect(d.applyThreshold).not.toHaveBeenCalled();
    expect(d.audit).not.toHaveBeenCalled();
  });

  it('holds (no apply) when there is not enough labelled feedback', async () => {
    const d = deps({ getMeasuredFpRate: vi.fn(async () => ({ rate: 0.9, sampleCount: 3 })) });
    const r = await runAutoTune(d);

    expect(r.applied).toBe(false);
    expect(r.skipped).toBe('no-change');
    expect(r.reason).toBe('insufficient-data');
    expect(d.applyThreshold).not.toHaveBeenCalled();
  });

  it('does not apply when a clamp pins the threshold at the ceiling', async () => {
    const d = deps({
      getCurrentThreshold: vi.fn(async () => 8),
      getMeasuredFpRate: vi.fn(async () => ({ rate: 0.5, sampleCount: 50 })),
    });
    const r = await runAutoTune(d, { max: 8 });

    expect(r.applied).toBe(false);
    expect(r.skipped).toBe('no-change');
    expect(d.applyThreshold).not.toHaveBeenCalled();
  });

  it('lowers the threshold when the detector is too strict (FP rate near zero)', async () => {
    const d = deps({ getMeasuredFpRate: vi.fn(async () => ({ rate: 0, sampleCount: 80 })) });
    const r = await runAutoTune(d);

    expect(r.applied).toBe(true);
    expect(r.reason).toBe('too-strict');
    expect(r.recommended).toBeCloseTo(3.15, 6); // 3.5 × 0.9
    expect(d.applyThreshold).toHaveBeenCalledWith(3.15);
  });
});
