import { beforeAll, afterAll, describe, it, expect, vi, beforeEach } from 'vitest';
import { setConfigForTest, resetConfig } from '@dashboard/core/config/index.js';

// Generate mock metric data
function generateMetrics(count: number, baseValue: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    endpoint_id: 1,
    container_id: 'container-1',
    container_name: 'test',
    metric_type: 'cpu' as const,
    value: baseValue + (Math.random() - 0.5) * 5,
    timestamp: new Date(Date.now() - (count - i) * 60000).toISOString(),
  }));
}

// DI pattern — getMetrics is passed as a parameter, no @dashboard/observability needed
const mockGetMetrics = vi.fn();

import { detectAnomalyIsolationForest, getOrTrainModel, clearModelCache } from '../services/isolation-forest-detector.js';


beforeAll(() => {
    setConfigForTest({
      ISOLATION_FOREST_ENABLED: true,
      ISOLATION_FOREST_TREES: 50,
      ISOLATION_FOREST_SAMPLE_SIZE: 64,
      ISOLATION_FOREST_CONTAMINATION: 0.1,
      ISOLATION_FOREST_RETRAIN_HOURS: 6,
    });
});

afterAll(() => {
  resetConfig();
});

describe('isolation-forest-detector', () => {
  beforeEach(() => {
    clearModelCache();
    mockGetMetrics.mockReset();
  });

  it('returns null when insufficient data', async () => {
    mockGetMetrics.mockResolvedValue([]);
    const result = await getOrTrainModel('container-1', mockGetMetrics);
    expect(result).toBeNull();
  });

  it('trains and returns model with sufficient data', async () => {
    mockGetMetrics
      .mockResolvedValueOnce(generateMetrics(100, 50)) // cpu
      .mockResolvedValueOnce(generateMetrics(100, 60)); // memory

    const model = await getOrTrainModel('container-1', mockGetMetrics);
    expect(model).not.toBeNull();
  });

  it('uses cached model on subsequent calls', async () => {
    const cpuData = generateMetrics(100, 50);
    const memData = generateMetrics(100, 60);
    mockGetMetrics
      .mockResolvedValueOnce(cpuData)
      .mockResolvedValueOnce(memData);

    const model1 = await getOrTrainModel('container-1', mockGetMetrics);
    expect(model1).not.toBeNull();

    // Second call should use cache (no additional getMetrics calls)
    const model2 = await getOrTrainModel('container-1', mockGetMetrics);
    expect(model2).toBe(model1);
    expect(mockGetMetrics).toHaveBeenCalledTimes(2); // Only the first two calls
  });

  it('detects anomaly with trained model', async () => {
    mockGetMetrics
      .mockResolvedValueOnce(generateMetrics(100, 50))
      .mockResolvedValueOnce(generateMetrics(100, 60));

    const result = await detectAnomalyIsolationForest(
      'container-1', 'test-container', 'cpu', 50, 50, 60, mockGetMetrics,
    );

    expect(result).not.toBeNull();
    expect(result!.method).toBe('isolation-forest');
    expect(result!.container_id).toBe('container-1');
    expect(typeof result!.is_anomalous).toBe('boolean');
    expect(result!.z_score).toBeGreaterThanOrEqual(0);
    expect(result!.z_score).toBeLessThanOrEqual(1);
  });

  it('returns null when detection has insufficient data', async () => {
    mockGetMetrics.mockResolvedValue([]);

    const result = await detectAnomalyIsolationForest(
      'container-no-data', 'test', 'cpu', 50, 50, 60, mockGetMetrics,
    );

    expect(result).toBeNull();
  });

  // #1361 — production determinism. NOTE: this test deliberately does NOT
  // monkey-patch Math.random; reproducibility must come from a seed derived
  // inside the detector, not from a test harness stubbing the global RNG.
  it('produces a reproducible model across retrains in the same window', async () => {
    // Identical training data for both trainings, so the ONLY variable is the
    // forest's internal RNG.
    const cpuData = generateMetrics(100, 50);
    const memData = generateMetrics(100, 60);
    mockGetMetrics
      .mockResolvedValueOnce(cpuData).mockResolvedValueOnce(memData)
      .mockResolvedValueOnce(cpuData).mockResolvedValueOnce(memData);

    const m1 = await getOrTrainModel('container-1', mockGetMetrics);
    const s1 = m1!.anomalyScore([50, 60]);

    clearModelCache();

    const m2 = await getOrTrainModel('container-1', mockGetMetrics);
    const s2 = m2!.anomalyScore([50, 60]);

    expect(s2).toBe(s1);
  });

  it('uses a different seed per container (models are not all identical)', async () => {
    const cpuData = generateMetrics(100, 50);
    const memData = generateMetrics(100, 60);
    mockGetMetrics
      .mockResolvedValueOnce(cpuData).mockResolvedValueOnce(memData)
      .mockResolvedValueOnce(cpuData).mockResolvedValueOnce(memData);

    const mA = await getOrTrainModel('container-A', mockGetMetrics);
    const mB = await getOrTrainModel('container-B', mockGetMetrics);

    // Same data, different container id → different seed → different partitions.
    const probes = [[50, 60], [80, 90], [10, 20]];
    const anyDifferent = probes.some((p) => mA!.anomalyScore(p) !== mB!.anomalyScore(p));
    expect(anyDifferent).toBe(true);
  });
});
