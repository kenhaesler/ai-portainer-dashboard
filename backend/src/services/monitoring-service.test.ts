import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all dependencies
vi.mock('../config/index.js', () => ({
  getConfig: vi.fn().mockReturnValue({
    ANOMALY_DETECTION_METHOD: 'adaptive',
    ANOMALY_COOLDOWN_MINUTES: 0,
    ANOMALY_THRESHOLD_PCT: 80,
    ANOMALY_HARD_THRESHOLD_ENABLED: true,
    PREDICTIVE_ALERTING_ENABLED: true,
    PREDICTIVE_ALERT_THRESHOLD_HOURS: 24,
    ANOMALY_EXPLANATION_ENABLED: true,
    ANOMALY_EXPLANATION_MAX_PER_CYCLE: 5,
    INVESTIGATION_ENABLED: true,
    INVESTIGATION_COOLDOWN_MINUTES: 30,
    INVESTIGATION_MAX_CONCURRENT: 2,
    ISOLATION_FOREST_ENABLED: false,
    NLP_LOG_ANALYSIS_ENABLED: false,
    NLP_LOG_ANALYSIS_MAX_PER_CYCLE: 3,
    NLP_LOG_ANALYSIS_TAIL_LINES: 100,
  }),
}));

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockGetEndpoints = vi.fn().mockResolvedValue([]);
const mockGetContainers = vi.fn().mockResolvedValue([]);
vi.mock('./portainer-client.js', () => ({
  getEndpoints: () => mockGetEndpoints(),
  getContainers: (...args: unknown[]) => mockGetContainers(...args),
}));

const mockCachedFetchSWR = vi.fn((_key: string, _ttl: number, fn: () => Promise<unknown>) => fn());
vi.mock('./portainer-cache.js', () => ({
  cachedFetchSWR: (...args: unknown[]) => mockCachedFetchSWR(...args as [string, number, () => Promise<unknown>]),
  getCacheKey: (...args: (string | number)[]) => args.join(':'),
  TTL: { ENDPOINTS: 900, CONTAINERS: 300, STATS: 60 },
}));

vi.mock('./portainer-normalizers.js', () => ({
  normalizeEndpoint: (ep: unknown) => ({ ...(ep as Record<string, unknown>), status: 'up', containersRunning: 0, containersStopped: 0, containersUnhealthy: 0, capabilities: { exec: true, realtimeLogs: true, liveStats: true, immediateActions: true } }),
  normalizeContainer: (c: unknown, endpointId: number, endpointName: string) => ({
    ...(c as Record<string, unknown>), endpointId, endpointName, state: 'running',
  }),
}));

vi.mock('./security-scanner.js', () => ({
  scanContainer: () => [],
}));

const mockGetLatestMetrics = vi.fn().mockResolvedValue({ cpu: 50, memory: 60, memory_bytes: 1024 });
vi.mock('./metrics-store.js', () => ({
  getLatestMetrics: (...args: unknown[]) => mockGetLatestMetrics(...args),
}));

const mockDetectAnomalyAdaptive = vi.fn().mockReturnValue(null);
vi.mock('./adaptive-anomaly-detector.js', () => ({
  detectAnomalyAdaptive: (...args: unknown[]) => mockDetectAnomalyAdaptive(...args),
}));

vi.mock('./isolation-forest-detector.js', () => ({
  detectAnomalyIsolationForest: vi.fn().mockReturnValue(null),
}));

vi.mock('./log-analyzer.js', () => ({
  analyzeLogsForContainers: vi.fn().mockResolvedValue([]),
}));

const mockInsertInsight = vi.fn();
const mockGetRecentInsights = vi.fn().mockReturnValue([]);
vi.mock('./insights-store.js', () => ({
  insertInsight: (...args: unknown[]) => mockInsertInsight(...args),
  getRecentInsights: (...args: unknown[]) => mockGetRecentInsights(...args),
}));

const mockIsOllamaAvailable = vi.fn().mockResolvedValue(false);
const mockChatStream = vi.fn();
vi.mock('./llm-client.js', () => ({
  isOllamaAvailable: () => mockIsOllamaAvailable(),
  chatStream: (...args: unknown[]) => mockChatStream(...args),
  buildInfrastructureContext: () => 'context',
}));

vi.mock('./remediation-service.js', () => ({
  suggestAction: () => null,
}));

vi.mock('./investigation-service.js', () => ({
  triggerInvestigation: vi.fn().mockResolvedValue(undefined),
}));

const mockGetCapacityForecasts = vi.fn().mockReturnValue([]);
vi.mock('./capacity-forecaster.js', () => ({
  getCapacityForecasts: (...args: unknown[]) => mockGetCapacityForecasts(...args),
}));

const mockExplainAnomalies = vi.fn().mockResolvedValue(new Map());
vi.mock('./anomaly-explainer.js', () => ({
  explainAnomalies: (...args: unknown[]) => mockExplainAnomalies(...args),
}));

vi.mock('./monitoring-telemetry-store.js', () => ({
  insertMonitoringCycle: vi.fn(),
  insertMonitoringSnapshot: vi.fn(),
}));

vi.mock('./notification-service.js', () => ({
  notifyInsight: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./event-bus.js', () => ({
  emitEvent: vi.fn(),
}));

vi.mock('./incident-correlator.js', () => ({
  correlateInsights: () => Promise.resolve({ incidentsCreated: 0, insightsGrouped: 0 }),
}));

const { getConfig } = await import('../config/index.js');
const { runMonitoringCycle, setMonitoringNamespace, sweepExpiredCooldowns, resetAnomalyCooldowns, startCooldownSweep, stopCooldownSweep } = await import('./monitoring-service.js');

describe('monitoring-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEndpoints.mockResolvedValue([]);
    mockGetContainers.mockResolvedValue([]);
    mockGetLatestMetrics.mockResolvedValue({ cpu: 50, memory: 60, memory_bytes: 1024 });
    mockDetectAnomalyAdaptive.mockReturnValue(null);
    mockIsOllamaAvailable.mockResolvedValue(false);
    mockGetCapacityForecasts.mockReturnValue([]);
    mockExplainAnomalies.mockResolvedValue(new Map());
    (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      ANOMALY_DETECTION_METHOD: 'adaptive',
      ANOMALY_COOLDOWN_MINUTES: 0,
      ANOMALY_THRESHOLD_PCT: 80,
      ANOMALY_HARD_THRESHOLD_ENABLED: true,
      PREDICTIVE_ALERTING_ENABLED: true,
      PREDICTIVE_ALERT_THRESHOLD_HOURS: 24,
      ANOMALY_EXPLANATION_ENABLED: true,
      ANOMALY_EXPLANATION_MAX_PER_CYCLE: 5,
      INVESTIGATION_ENABLED: true,
      INVESTIGATION_COOLDOWN_MINUTES: 30,
      INVESTIGATION_MAX_CONCURRENT: 2,
    });
  });

  describe('predictive alerting', () => {
    it('creates predictive insight for increasing trend with short TTT', async () => {
      mockGetCapacityForecasts.mockReturnValue([
        {
          containerId: 'c1',
          containerName: 'web-app',
          metricType: 'cpu',
          currentValue: 80,
          trend: 'increasing',
          slope: 2.0,
          r_squared: 0.85,
          forecast: [],
          timeToThreshold: 3,
          confidence: 'high',
        },
      ]);

      await runMonitoringCycle();

      expect(mockInsertInsight).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'predictive',
          severity: 'critical',
          container_id: 'c1',
          container_name: 'web-app',
        }),
      );
    });

    it('assigns correct severity based on timeToThreshold', async () => {
      mockGetCapacityForecasts.mockReturnValue([
        {
          containerId: 'c1', containerName: 'app1', metricType: 'cpu',
          currentValue: 70, trend: 'increasing', slope: 1.0, r_squared: 0.8,
          forecast: [], timeToThreshold: 3, confidence: 'high',
        },
        {
          containerId: 'c2', containerName: 'app2', metricType: 'memory',
          currentValue: 60, trend: 'increasing', slope: 0.5, r_squared: 0.7,
          forecast: [], timeToThreshold: 8, confidence: 'medium',
        },
        {
          containerId: 'c3', containerName: 'app3', metricType: 'cpu',
          currentValue: 50, trend: 'increasing', slope: 0.3, r_squared: 0.6,
          forecast: [], timeToThreshold: 20, confidence: 'medium',
        },
      ]);

      await runMonitoringCycle();

      const calls = mockInsertInsight.mock.calls;
      const predictiveCalls = calls.filter(
        (c: unknown[]) => (c[0] as { category: string }).category === 'predictive',
      );

      expect(predictiveCalls).toHaveLength(3);
      expect((predictiveCalls[0][0] as { severity: string }).severity).toBe('critical'); // 3h
      expect((predictiveCalls[1][0] as { severity: string }).severity).toBe('warning');  // 8h
      expect((predictiveCalls[2][0] as { severity: string }).severity).toBe('info');     // 20h
    });

    it('skips stable trend forecasts', async () => {
      mockGetCapacityForecasts.mockReturnValue([
        {
          containerId: 'c1', containerName: 'stable-app', metricType: 'cpu',
          currentValue: 40, trend: 'stable', slope: 0.01, r_squared: 0.1,
          forecast: [], timeToThreshold: null, confidence: 'low',
        },
      ]);

      await runMonitoringCycle();

      const calls = mockInsertInsight.mock.calls;
      const predictiveCalls = calls.filter(
        (c: unknown[]) => (c[0] as { category: string }).category === 'predictive',
      );
      expect(predictiveCalls).toHaveLength(0);
    });

    it('skips low confidence forecasts', async () => {
      mockGetCapacityForecasts.mockReturnValue([
        {
          containerId: 'c1', containerName: 'noisy-app', metricType: 'cpu',
          currentValue: 70, trend: 'increasing', slope: 1.0, r_squared: 0.2,
          forecast: [], timeToThreshold: 5, confidence: 'low',
        },
      ]);

      await runMonitoringCycle();

      const calls = mockInsertInsight.mock.calls;
      const predictiveCalls = calls.filter(
        (c: unknown[]) => (c[0] as { category: string }).category === 'predictive',
      );
      expect(predictiveCalls).toHaveLength(0);
    });

    it('respects PREDICTIVE_ALERTING_ENABLED flag', async () => {
      (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        ANOMALY_DETECTION_METHOD: 'adaptive',
        PREDICTIVE_ALERTING_ENABLED: false,
        PREDICTIVE_ALERT_THRESHOLD_HOURS: 24,
        ANOMALY_EXPLANATION_ENABLED: false,
        ANOMALY_EXPLANATION_MAX_PER_CYCLE: 5,
      });

      mockGetCapacityForecasts.mockReturnValue([
        {
          containerId: 'c1', containerName: 'web-app', metricType: 'cpu',
          currentValue: 80, trend: 'increasing', slope: 2.0, r_squared: 0.85,
          forecast: [], timeToThreshold: 3, confidence: 'high',
        },
      ]);

      await runMonitoringCycle();

      // getCapacityForecasts should not be called when disabled
      expect(mockGetCapacityForecasts).not.toHaveBeenCalled();
    });
  });

  describe('anomaly explanations', () => {
    it('enriches anomaly description when LLM available', async () => {
      mockGetEndpoints.mockResolvedValue([{ Id: 1, Name: 'local' }]);
      mockGetContainers.mockResolvedValue([
        { Id: 'c1', Names: ['/web-app'], State: 'running', Image: 'node:18' },
      ]);
      mockDetectAnomalyAdaptive.mockReturnValue({
        is_anomalous: true,
        z_score: 3.5,
        current_value: 95.0,
        mean: 40.0,
        method: 'adaptive',
      });
      mockIsOllamaAvailable.mockResolvedValue(true);

      const explanationMap = new Map<string, string>();
      // We need to capture the insight ID dynamically since it's a UUID
      mockExplainAnomalies.mockImplementation(
        async (anomalies: Array<{ insight: { id: string } }>) => {
          const map = new Map<string, string>();
          for (const a of anomalies) {
            map.set(a.insight.id, 'The CPU spike is likely caused by a batch job.');
          }
          return map;
        },
      );

      await runMonitoringCycle();

      // Check that insertInsight was called with enriched description
      const anomalyCalls = mockInsertInsight.mock.calls.filter(
        (c: unknown[]) => (c[0] as { category: string }).category === 'anomaly',
      );
      expect(anomalyCalls.length).toBeGreaterThan(0);
      const desc = (anomalyCalls[0][0] as { description: string }).description;
      expect(desc).toContain('AI Analysis:');
      expect(desc).toContain('batch job');
    });

    it('leaves description unchanged when LLM unavailable', async () => {
      mockGetEndpoints.mockResolvedValue([{ Id: 1, Name: 'local' }]);
      mockGetContainers.mockResolvedValue([
        { Id: 'c1', Names: ['/web-app'], State: 'running', Image: 'node:18' },
      ]);
      mockDetectAnomalyAdaptive.mockReturnValue({
        is_anomalous: true,
        z_score: 3.5,
        current_value: 95.0,
        mean: 40.0,
        method: 'adaptive',
      });
      mockIsOllamaAvailable.mockResolvedValue(false);

      await runMonitoringCycle();

      const anomalyCalls = mockInsertInsight.mock.calls.filter(
        (c: unknown[]) => (c[0] as { category: string }).category === 'anomaly',
      );
      expect(anomalyCalls.length).toBeGreaterThan(0);
      const desc = (anomalyCalls[0][0] as { description: string }).description;
      expect(desc).not.toContain('AI Analysis:');
    });

    it('respects ANOMALY_EXPLANATION_ENABLED flag', async () => {
      (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        ANOMALY_DETECTION_METHOD: 'adaptive',
        ANOMALY_COOLDOWN_MINUTES: 0,
        ANOMALY_THRESHOLD_PCT: 80,
        ANOMALY_HARD_THRESHOLD_ENABLED: true,
        PREDICTIVE_ALERTING_ENABLED: false,
        PREDICTIVE_ALERT_THRESHOLD_HOURS: 24,
        ANOMALY_EXPLANATION_ENABLED: false,
        ANOMALY_EXPLANATION_MAX_PER_CYCLE: 5,
      });
      mockGetEndpoints.mockResolvedValue([{ Id: 1, Name: 'local' }]);
      mockGetContainers.mockResolvedValue([
        { Id: 'c1', Names: ['/web-app'], State: 'running', Image: 'node:18' },
      ]);
      mockDetectAnomalyAdaptive.mockReturnValue({
        is_anomalous: true,
        z_score: 3.5,
        current_value: 95.0,
        mean: 40.0,
        method: 'adaptive',
      });
      mockIsOllamaAvailable.mockResolvedValue(true);

      await runMonitoringCycle();

      expect(mockExplainAnomalies).not.toHaveBeenCalled();
    });
  });

  describe('hard-threshold toggle', () => {
    it('does not create threshold anomalies when ANOMALY_HARD_THRESHOLD_ENABLED is false', async () => {
      (getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
        ANOMALY_DETECTION_METHOD: 'adaptive',
        ANOMALY_COOLDOWN_MINUTES: 0,
        ANOMALY_THRESHOLD_PCT: 80,
        ANOMALY_HARD_THRESHOLD_ENABLED: false,
        PREDICTIVE_ALERTING_ENABLED: false,
        PREDICTIVE_ALERT_THRESHOLD_HOURS: 24,
        ANOMALY_EXPLANATION_ENABLED: false,
        ANOMALY_EXPLANATION_MAX_PER_CYCLE: 5,
        INVESTIGATION_ENABLED: false,
        INVESTIGATION_COOLDOWN_MINUTES: 30,
        INVESTIGATION_MAX_CONCURRENT: 2,
        ISOLATION_FOREST_ENABLED: false,
        NLP_LOG_ANALYSIS_ENABLED: false,
        NLP_LOG_ANALYSIS_MAX_PER_CYCLE: 3,
        NLP_LOG_ANALYSIS_TAIL_LINES: 100,
      });
      mockGetEndpoints.mockResolvedValue([{ Id: 1, Name: 'local' }]);
      mockGetContainers.mockResolvedValue([
        { Id: 'c1', Names: ['/web-app'], State: 'running', Image: 'node:18' },
      ]);
      mockGetLatestMetrics.mockResolvedValue({ cpu: 95, memory: 40, memory_bytes: 1024 });
      mockDetectAnomalyAdaptive.mockReturnValue(null);

      await runMonitoringCycle();

      const anomalyCalls = mockInsertInsight.mock.calls.filter(
        (c: unknown[]) => (c[0] as { category: string }).category === 'anomaly',
      );
      expect(anomalyCalls).toHaveLength(0);
    });
  });

  describe('caching', () => {
    it('uses cachedFetchSWR for endpoints and containers', async () => {
      mockGetEndpoints.mockResolvedValue([{ Id: 1, Name: 'prod' }]);
      mockGetContainers.mockResolvedValue([
        { Id: 'c1', Names: ['/app'], State: 'running', Image: 'node:18' },
      ]);

      await runMonitoringCycle();

      // Should use cachedFetchSWR for endpoints
      expect(mockCachedFetchSWR).toHaveBeenCalledWith('endpoints', 900, expect.any(Function));
      // Should use cachedFetchSWR for containers
      expect(mockCachedFetchSWR).toHaveBeenCalledWith('containers:1', 300, expect.any(Function));
    });

    it('uses cachedFetchSWR for each endpoint containers', async () => {
      mockGetEndpoints.mockResolvedValue([
        { Id: 1, Name: 'prod' },
        { Id: 2, Name: 'staging' },
      ]);
      mockGetContainers.mockResolvedValue([]);

      await runMonitoringCycle();

      // 1 endpoints call + 2 containers calls (one per endpoint)
      expect(mockCachedFetchSWR).toHaveBeenCalledTimes(3);
      expect(mockCachedFetchSWR).toHaveBeenCalledWith('containers:1', 300, expect.any(Function));
      expect(mockCachedFetchSWR).toHaveBeenCalledWith('containers:2', 300, expect.any(Function));
    });

    it('reads metrics from DB instead of collecting from Portainer API', async () => {
      mockGetEndpoints.mockResolvedValue([{ Id: 1, Name: 'prod' }]);
      mockGetContainers.mockResolvedValue([
        { Id: 'c1', Names: ['/app'], State: 'running', Image: 'node:18' },
      ]);
      mockGetLatestMetrics.mockResolvedValue({ cpu: 75, memory: 80, memory_bytes: 2048 });

      await runMonitoringCycle();

      // Should read from DB using getLatestMetrics
      expect(mockGetLatestMetrics).toHaveBeenCalledWith('c1');
    });
  });

  describe('cycle:complete emission', () => {
    it('emits cycle:complete with stats when namespace is set', async () => {
      const mockEmit = vi.fn();
      setMonitoringNamespace({ emit: mockEmit, to: vi.fn() } as unknown as import('socket.io').Namespace);

      mockGetEndpoints.mockResolvedValue([{ Id: 1, Name: 'local' }]);
      mockGetContainers.mockResolvedValue([
        { Id: 'c1', Names: ['/app'], State: 'running', Image: 'node:18' },
      ]);

      await runMonitoringCycle();

      expect(mockEmit).toHaveBeenCalledWith('cycle:complete', expect.objectContaining({
        duration: expect.any(Number),
        endpoints: 1,
        containers: 1,
        totalInsights: expect.any(Number),
      }));
    });

    it('does not throw when namespace is not set', async () => {
      // Default state: no namespace set (other tests don't set it)
      // runMonitoringCycle should complete without error
      await expect(runMonitoringCycle()).resolves.not.toThrow();
    });
  });

  describe('anomalyCooldowns sweep (#547)', () => {
    beforeEach(() => {
      resetAnomalyCooldowns();
    });

    it('sweepExpiredCooldowns removes entries older than cooldown period', async () => {
      // Set up: run a cycle that creates cooldown entries
      mockGetEndpoints.mockResolvedValue([{ Id: 1, Name: 'local' }]);
      mockGetContainers.mockResolvedValue([
        { Id: 'c1', Names: ['/web-app'], State: 'running', Image: 'node:18' },
      ]);
      mockDetectAnomalyAdaptive.mockReturnValue({
        is_anomalous: true,
        z_score: 3.5,
        current_value: 95.0,
        mean: 40.0,
        method: 'adaptive',
      });

      await runMonitoringCycle();

      // Cooldown entries should exist now; sweep with 0 minutes removes all
      const swept = sweepExpiredCooldowns(0);
      expect(swept).toBeGreaterThan(0);
    });

    it('sweepExpiredCooldowns keeps recent entries', async () => {
      mockGetEndpoints.mockResolvedValue([{ Id: 1, Name: 'local' }]);
      mockGetContainers.mockResolvedValue([
        { Id: 'c1', Names: ['/web-app'], State: 'running', Image: 'node:18' },
      ]);
      mockDetectAnomalyAdaptive.mockReturnValue({
        is_anomalous: true,
        z_score: 3.5,
        current_value: 95.0,
        mean: 40.0,
        method: 'adaptive',
      });

      await runMonitoringCycle();

      // Sweep with a large cooldown period should keep everything
      const swept = sweepExpiredCooldowns(999);
      expect(swept).toBe(0);
    });

    it('sweepExpiredCooldowns returns 0 when map is empty', () => {
      expect(sweepExpiredCooldowns(30)).toBe(0);
    });

    it('startCooldownSweep and stopCooldownSweep do not throw', () => {
      expect(() => startCooldownSweep()).not.toThrow();
      expect(() => stopCooldownSweep()).not.toThrow();
    });
  });
});
