import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setConfigForTest, resetConfig } from '@dashboard/core/config/index.js';

// #1527 — capture the one-time warning emitted when the configured
// day-of-week lookback exceeds the raw retention window.
const { mockWarn } = vi.hoisted(() => ({ mockWarn: vi.fn() }));

vi.mock('@dashboard/core/utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: mockWarn,
    debug: vi.fn(),
  }),
}));

import {
  detectAnomalyRobust,
  resetDowLookbackWarningForTest,
} from '../services/adaptive-anomaly-detector.js';

const NOW = new Date('2026-05-25T09:30:00Z');
const spread = () => [44, 46, 48, 50, 50, 52, 54, 56, 42, 58];

describe('day-of-week lookback clamp warning (#1527)', () => {
  beforeEach(() => {
    mockWarn.mockClear();
    resetDowLookbackWarningForTest();
    setConfigForTest({
      ANOMALY_ZSCORE_THRESHOLD: 2.5,
      ANOMALY_MOVING_AVERAGE_WINDOW: 30,
      ANOMALY_MIN_SAMPLES: 10,
      ANOMALY_DAYOFWEEK_ENABLED: true,
      ANOMALY_DAYOFWEEK_LOOKBACK_DAYS: 28,
      ANOMALY_DAYOFWEEK_MIN_SAMPLES: 3,
      METRICS_RAW_RETENTION_DAYS: 7,
    });
  });

  afterEach(() => {
    resetConfig();
  });

  it('warns ONCE with both values when the configured lookback exceeds raw retention', async () => {
    const flat = vi.fn().mockResolvedValue(spread());
    const seasonal = vi.fn().mockResolvedValue(spread());

    await detectAnomalyRobust('c1', 'web', 'cpu', 60, flat, seasonal, NOW);
    await detectAnomalyRobust('c2', 'api', 'memory', 60, flat, seasonal, NOW);

    const clampWarnings = mockWarn.mock.calls.filter(([, msg]) =>
      typeof msg === 'string' && msg.includes('ANOMALY_DAYOFWEEK_LOOKBACK_DAYS'),
    );
    expect(clampWarnings).toHaveLength(1);
    expect(clampWarnings[0][0]).toMatchObject({
      configuredLookbackDays: 28,
      rawRetentionDays: 7,
    });
  });

  it('does not warn when the lookback fits inside raw retention', async () => {
    setConfigForTest({ METRICS_RAW_RETENTION_DAYS: 30 });
    const flat = vi.fn().mockResolvedValue(spread());
    const seasonal = vi.fn().mockResolvedValue(spread());

    await detectAnomalyRobust('c1', 'web', 'cpu', 60, flat, seasonal, NOW);

    const clampWarnings = mockWarn.mock.calls.filter(([, msg]) =>
      typeof msg === 'string' && msg.includes('ANOMALY_DAYOFWEEK_LOOKBACK_DAYS'),
    );
    expect(clampWarnings).toHaveLength(0);
  });

  it('does not warn when the day-of-week baseline is disabled', async () => {
    setConfigForTest({ ANOMALY_DAYOFWEEK_ENABLED: false });
    const flat = vi.fn().mockResolvedValue(spread());
    const seasonal = vi.fn().mockResolvedValue(spread());

    await detectAnomalyRobust('c1', 'web', 'cpu', 60, flat, seasonal, NOW);

    const clampWarnings = mockWarn.mock.calls.filter(([, msg]) =>
      typeof msg === 'string' && msg.includes('ANOMALY_DAYOFWEEK_LOOKBACK_DAYS'),
    );
    expect(clampWarnings).toHaveLength(0);
  });
});
