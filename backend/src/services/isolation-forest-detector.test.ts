import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/index.js', () => ({
  getConfig: vi.fn().mockReturnValue({
    ISOLATION_FOREST_ENABLED: true,
    ISOLATION_FOREST_TREES: 50,
    ISOLATION_FOREST_SAMPLE_SIZE: 64,
    ISOLATION_FOREST_CONTAMINATION: 0.1,
    ISOLATION_FOREST_RETRAIN_HOURS: 6,
  }),
}));

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

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

const mockGetMetrics = vi.fn();
vi.mock('./metrics-store.js', () => ({
  getMetrics: (...args: unknown[]) => mockGetMetrics(...args),
}));

import { detectAnomalyIsolationForest, getOrTrainModel, clearModelCache } from './isolation-forest-detector.js';

describe('isolation-forest-detector', () => {
  beforeEach(() => {
    clearModelCache();
    mockGetMetrics.mockReset();
  });

  it('returns null when insufficient data', async () => {
    mockGetMetrics.mockResolvedValue([]);
    const result = await getOrTrainModel('container-1');
    expect(result).toBeNull();
  });

  it('trains and returns model with sufficient data', async () => {
    mockGetMetrics
      .mockResolvedValueOnce(generateMetrics(100, 50)) // cpu
      .mockResolvedValueOnce(generateMetrics(100, 60)); // memory

    const model = await getOrTrainModel('container-1');
    expect(model).not.toBeNull();
  });

  it('uses cached model on subsequent calls', async () => {
    const cpuData = generateMetrics(100, 50);
    const memData = generateMetrics(100, 60);
    mockGetMetrics
      .mockResolvedValueOnce(cpuData)
      .mockResolvedValueOnce(memData);

    const model1 = await getOrTrainModel('container-1');
    expect(model1).not.toBeNull();

    // Second call should use cache (no additional getMetrics calls)
    const model2 = await getOrTrainModel('container-1');
    expect(model2).toBe(model1);
    expect(mockGetMetrics).toHaveBeenCalledTimes(2); // Only the first two calls
  });

  it('detects anomaly with trained model', async () => {
    mockGetMetrics
      .mockResolvedValueOnce(generateMetrics(100, 50))
      .mockResolvedValueOnce(generateMetrics(100, 60));

    const result = await detectAnomalyIsolationForest(
      'container-1', 'test-container', 'cpu', 50, 50, 60,
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
      'container-no-data', 'test', 'cpu', 50, 50, 60,
    );

    expect(result).toBeNull();
  });
});
