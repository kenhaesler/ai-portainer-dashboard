import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { setConfigForTest, resetConfig } from '../config/index.js';

// Default config values used in tests
const defaultConfig = {
  ANOMALY_DETECTION_METHOD: 'adaptive' as const,
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
  MAX_INSIGHTS_PER_CYCLE: 500,
  AI_ANALYSIS_ENABLED: false, // disabled by default in tests to avoid async side-effects
};

// Kept mocks — internal services the monitoring cycle depends on

// Kept: portainer-normalizers mock — tests control normalization
vi.mock('./portainer-normalizers.js', () => ({
  normalizeEndpoint: (ep: unknown) => ({ ...(ep as Record<string, unknown>), status: 'up', containersRunning: 0, containersStopped: 0, containersUnhealthy: 0, capabilities: { exec: true, realtimeLogs: true, liveStats: true, immediateActions: true } }),
  normalizeContainer: (c: unknown, endpointId: number, endpointName: string) => ({
    ...(c as Record<string, unknown>), endpointId, endpointName, state: 'running',
  }),
}));

vi.mock('./security-scanner.js', () => ({
  scanContainer: () => [],
}));

const mockGetLatestMetricsBatch = vi.fn().mockImplementation(
  async (containerIds: string[]) => {
    const map = new Map<string, Record<string, number>>();
    for (const id of containerIds) {
      map.set(id, { cpu: 50, memory: 60, memory_bytes: 1024 });
    }
    return map;
  },
);
vi.mock('./metrics-store.js', () => ({
  getLatestMetricsBatch: (...args: unknown[]) => mockGetLatestMetricsBatch(...args),
}));

const mockDetectAnomalyAdaptive = vi.fn().mockReturnValue(null);
// detectAnomaliesBatch delegates to mockDetectAnomalyAdaptive so existing tests that
// configure mockDetectAnomalyAdaptive continue to work after the batch refactor.
const mockDetectAnomaliesBatch = vi.fn().mockImplementation(
  async (items: Array<{ containerId: string; containerName: string; metricType: string; currentValue: number }>) => {
    const results = new Map();
    for (const item of items) {
      const detection = mockDetectAnomalyAdaptive(item.containerId, item.containerName, item.metricType, item.currentValue);
      if (detection) {
        results.set(`${item.containerId}:${item.metricType}`, detection);
      }
    }
    return results;
  },
);
vi.mock('./adaptive-anomaly-detector.js', () => ({
  detectAnomalyAdaptive: (...args: unknown[]) => mockDetectAnomalyAdaptive(...args),
  detectAnomaliesBatch: (...args: unknown[]) => mockDetectAnomaliesBatch(...args),
}));

vi.mock('./isolation-forest-detector.js', () => ({
  detectAnomalyIsolationForest: vi.fn().mockReturnValue(null),
}));

vi.mock('./log-analyzer.js', () => ({
  analyzeLogsForContainers: vi.fn().mockResolvedValue([]),
}));

const mockInsertInsight = vi.fn();
/** Default mock: returns all insight IDs as inserted (no deduplication). */
const mockInsertInsights = vi.fn().mockImplementation(
  async (insights: Array<{ id: string }>) => new Set(insights.map((i) => i.id)),
);
const mockGetRecentInsights = vi.fn().mockReturnValue([]);
vi.mock('./insights-store.js', () => ({
  insertInsight: (...args: unknown[]) => mockInsertInsight(...args),
  insertInsights: (...args: unknown[]) => mockInsertInsights(...args),
  getRecentInsights: (...args: unknown[]) => mockGetRecentInsights(...args),
}));

// Kept: remediation-service mock — tests don't exercise remediation
vi.mock('./remediation-service.js', () => ({
  suggestAction: () => null,
}));

const mockTriggerInvestigation = vi.fn().mockResolvedValue(undefined);
vi.mock('./investigation-service.js', () => ({
  triggerInvestigation: (...args: unknown[]) => mockTriggerInvestigation(...args),
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
  insertMonitoringCycle: vi.fn().mockResolvedValue(undefined),
  insertMonitoringSnapshot: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./notification-service.js', () => ({
  notifyInsight: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./event-bus.js', () => ({
  emitEvent: vi.fn(),
}));

const mockCorrelateInsights = vi.fn().mockResolvedValue({ incidentsCreated: 0, insightsGrouped: 0 });
vi.mock('./incident-correlator.js', () => ({
  correlateInsights: (...args: unknown[]) => mockCorrelateInsights(...args),
}));

const { runMonitoringCycle, setMonitoringNamespace, sweepExpiredCooldowns, resetAnomalyCooldowns, startCooldownSweep, stopCooldownSweep, resetPreviousCycleStats } = await import('./monitoring-service.js');
import * as portainerClient from './portainer-client.js';
import * as portainerCache from './portainer-cache.js';
import { cache } from './portainer-cache.js';
import * as llmClient from './llm-client.js';
import { closeTestRedis } from '../test-utils/test-redis-helper.js';

// Spy references — assigned in beforeEach
let mockGetEndpoints: any;
let mockGetContainers: any;
let mockIsEndpointDegraded: any;
let mockIsCircuitOpen: any;
let mockCachedFetchSWR: any;
let mockIsOllamaAvailable: any;
let mockChatStream: any;

/** Helper: extract insights from the batch insertInsights call */
function getInsertedInsights(): Array<{ category: string; severity: string; description: string; container_id: string | null }> {
  if (mockInsertInsights.mock.calls.length === 0) return [];
  return mockInsertInsights.mock.calls[0][0] as any[];
}

beforeAll(async () => {
  await cache.clear();
});

afterAll(async () => {
  await closeTestRedis();
});

describe('monitoring-service', () => {
  beforeEach(async () => {
    await cache.clear();
    vi.restoreAllMocks();

    // Re-set forwarding-target mock defaults cleared by restoreAllMocks
    mockGetLatestMetricsBatch.mockImplementation(
      async (containerIds: string[]) => {
        const map = new Map<string, Record<string, number>>();
        for (const id of containerIds) {
          map.set(id, { cpu: 50, memory: 60, memory_bytes: 1024 });
        }
        return map;
      },
    );
    mockDetectAnomalyAdaptive.mockReturnValue(null);
    mockDetectAnomaliesBatch.mockImplementation(
      async (items: Array<{ containerId: string; containerName: string; metricType: string; currentValue: number }>) => {
        const results = new Map();
        for (const item of items) {
          const detection = mockDetectAnomalyAdaptive(item.containerId, item.containerName, item.metricType, item.currentValue);
          if (detection) {
            results.set(`${item.containerId}:${item.metricType}`, detection);
          }
        }
        return results;
      },
    );
    mockInsertInsights.mockImplementation(
      async (insights: Array<{ id: string }>) => new Set(insights.map((i) => i.id)),
    );
    mockGetRecentInsights.mockReturnValue([]);
    mockTriggerInvestigation.mockResolvedValue(undefined);
    mockCorrelateInsights.mockResolvedValue({ incidentsCreated: 0, insightsGrouped: 0 });
    mockGetCapacityForecasts.mockReturnValue([]);
    mockExplainAnomalies.mockResolvedValue(new Map());

    // Re-set inline vi.mock fn defaults cleared by restoreAllMocks
    const isoForest = await import('./isolation-forest-detector.js');
    vi.mocked(isoForest.detectAnomalyIsolationForest).mockReturnValue(null as any);
    const logAnalyzer = await import('./log-analyzer.js');
    vi.mocked(logAnalyzer.analyzeLogsForContainers).mockResolvedValue([] as any);
    const notifService = await import('./notification-service.js');
    vi.mocked(notifService.notifyInsight).mockResolvedValue(undefined as any);
    const telemetryStore = await import('./monitoring-telemetry-store.js');
    vi.mocked(telemetryStore.insertMonitoringCycle).mockResolvedValue(undefined as any);
    vi.mocked(telemetryStore.insertMonitoringSnapshot).mockResolvedValue(undefined as any);

    // Create portainer spies
    mockCachedFetchSWR = vi.spyOn(portainerCache, 'cachedFetchSWR').mockImplementation(
      async (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn(),
    );
    vi.spyOn(portainerCache, 'cachedFetch').mockImplementation(
      async (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn(),
    );
    mockGetEndpoints = vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([] as any);
    mockGetContainers = vi.spyOn(portainerClient, 'getContainers').mockResolvedValue([] as any);
    mockIsEndpointDegraded = vi.spyOn(portainerClient, 'isEndpointDegraded').mockReturnValue(false);
    mockIsCircuitOpen = vi.spyOn(portainerClient, 'isCircuitOpen').mockReturnValue(false);

    // Create LLM spies
    mockIsOllamaAvailable = vi.spyOn(llmClient, 'isOllamaAvailable').mockResolvedValue(false);
    mockChatStream = vi.spyOn(llmClient, 'chatStream');

    setConfigForTest(defaultConfig);
    resetPreviousCycleStats();
    // Reset namespace so stale mock objects don't leak between tests
    setMonitoringNamespace(null as any);
  });

  afterEach(() => {
    resetConfig();
  });

  describe('batch insight processing', () => {
    it('calls detectAnomaliesBatch instead of per-container detectAnomalyAdaptive (#546)', async () => {
      mockGetEndpoints.mockResolvedValue([{ Id: 1, Name: 'local' }]);
      mockGetContainers.mockResolvedValue([
        { Id: 'c1', Names: ['/app-1'], State: 'running', Image: 'node:18' },
        { Id: 'c2', Names: ['/app-2'], State: 'running', Image: 'node:18' },
      ]);

      await runMonitoringCycle();

      // Should call batch function once with all container×metric items
      expect(mockDetectAnomaliesBatch).toHaveBeenCalledTimes(1);
      const batchItems = mockDetectAnomaliesBatch.mock.calls[0][0];
      // 2 containers × 2 metrics (cpu, memory) = 4 items
      expect(batchItems.length).toBe(4);
      expect(batchItems[0]).toHaveProperty('containerId');
      expect(batchItems[0]).toHaveProperty('metricType');
      expect(batchItems[0]).toHaveProperty('currentValue');
    });

    it('uses insertInsights (batch) instead of per-insight insertInsight', async () => {
      mockGetEndpoints.mockResolvedValue([{ Id: 1, Name: 'local' }]);
      mockGetContainers.mockResolvedValue([
        { Id: 'c1', Names: ['/web-app'], State: 'running', Image: 'node:18' },
      ]);
      mockDetectAnomalyAdaptive.mockReturnValue({
        is_anomalous: true, z_score: 3.5, current_value: 95.0, mean: 40.0, method: 'adaptive',
      });

      await runMonitoringCycle();

      // Should use batch insert, NOT per-insight
      expect(mockInsertInsights).toHaveBeenCalledTimes(1);
      expect(mockInsertInsight).not.toHaveBeenCalled();
    });

    it('caps insights at MAX_INSIGHTS_PER_CYCLE', async () => {
      setConfigForTest({
        MAX_INSIGHTS_PER_CYCLE: 2,
        ANOMALY_COOLDOWN_MINUTES: 0,
      });

      mockGetEndpoints.mockResolvedValue([{ Id: 1, Name: 'local' }]);
      mockGetContainers.mockResolvedValue([
        { Id: 'c1', Names: ['/app-1'], State: 'running', Image: 'node:18' },
        { Id: 'c2', Names: ['/app-2'], State: 'running', Image: 'node:18' },
        { Id: 'c3', Names: ['/app-3'], State: 'running', Image: 'node:18' },
      ]);
      mockDetectAnomalyAdaptive.mockReturnValue({
        is_anomalous: true, z_score: 4.0, current_value: 95.0, mean: 40.0, method: 'adaptive',
      });

      await runMonitoringCycle();

      const batch = mockInsertInsights.mock.calls[0][0] as unknown[];
      expect(batch.length).toBeLessThanOrEqual(2);
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

      const insights = getInsertedInsights();
      const predictive = insights.filter(i => i.category === 'predictive');
      expect(predictive.length).toBe(1);
      expect(predictive[0].severity).toBe('critical');
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

      const insights = getInsertedInsights();
      const predictive = insights.filter(i => i.category === 'predictive');
      expect(predictive).toHaveLength(3);
      expect(predictive[0].severity).toBe('critical'); // 3h
      expect(predictive[1].severity).toBe('warning');  // 8h
      expect(predictive[2].severity).toBe('info');     // 20h
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

      const insights = getInsertedInsights();
      const predictive = insights.filter(i => i.category === 'predictive');
      expect(predictive).toHaveLength(0);
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

      const insights = getInsertedInsights();
      const predictive = insights.filter(i => i.category === 'predictive');
      expect(predictive).toHaveLength(0);
    });

    it('respects PREDICTIVE_ALERTING_ENABLED flag', async () => {
      setConfigForTest({
        PREDICTIVE_ALERTING_ENABLED: false,
        ANOMALY_EXPLANATION_ENABLED: false,
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

      // Check that batch insert was called with enriched description
      const insights = getInsertedInsights();
      const anomalyCalls = insights.filter(i => i.category === 'anomaly');
      expect(anomalyCalls.length).toBeGreaterThan(0);
      expect(anomalyCalls[0].description).toContain('AI Analysis:');
      expect(anomalyCalls[0].description).toContain('batch job');
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

      const insights = getInsertedInsights();
      const anomalyCalls = insights.filter(i => i.category === 'anomaly');
      expect(anomalyCalls.length).toBeGreaterThan(0);
      expect(anomalyCalls[0].description).not.toContain('AI Analysis:');
    });

    it('respects ANOMALY_EXPLANATION_ENABLED flag', async () => {
      setConfigForTest({
        ANOMALY_EXPLANATION_ENABLED: false,
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

  describe('AI analysis gate', () => {
    it('skips AI analysis when AI_ANALYSIS_ENABLED is false', async () => {
      setConfigForTest({
        AI_ANALYSIS_ENABLED: false,
      });
      mockIsOllamaAvailable.mockResolvedValue(true);

      await runMonitoringCycle();

      // chatStream should NOT be called for AI analysis
      expect(mockChatStream).not.toHaveBeenCalled();
    });
  });

  describe('hard-threshold toggle', () => {
    it('does not create threshold anomalies when ANOMALY_HARD_THRESHOLD_ENABLED is false', async () => {
      setConfigForTest({
        ANOMALY_HARD_THRESHOLD_ENABLED: false,
        PREDICTIVE_ALERTING_ENABLED: false,
        ANOMALY_EXPLANATION_ENABLED: false,
      });
      mockGetEndpoints.mockResolvedValue([{ Id: 1, Name: 'local' }]);
      mockGetContainers.mockResolvedValue([
        { Id: 'c1', Names: ['/web-app'], State: 'running', Image: 'node:18' },
      ]);
      mockGetLatestMetricsBatch.mockResolvedValue(new Map([['c1', { cpu: 95, memory: 40, memory_bytes: 1024 }]]));
      mockDetectAnomalyAdaptive.mockReturnValue(null);

      await runMonitoringCycle();

      const insights = getInsertedInsights();
      const anomalyCalls = insights.filter(i => i.category === 'anomaly');
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

    it('reads metrics from DB using a single batch call instead of per-container calls', async () => {
      mockGetEndpoints.mockResolvedValue([{ Id: 1, Name: 'prod' }]);
      mockGetContainers.mockResolvedValue([
        { Id: 'c1', Names: ['/app'], State: 'running', Image: 'node:18' },
      ]);
      mockGetLatestMetricsBatch.mockResolvedValue(new Map([['c1', { cpu: 75, memory: 80, memory_bytes: 2048 }]]));

      await runMonitoringCycle();

      // Should use a single batch call with all container IDs
      expect(mockGetLatestMetricsBatch).toHaveBeenCalledTimes(1);
      expect(mockGetLatestMetricsBatch).toHaveBeenCalledWith(['c1']);
    });

    it('issues one batch metrics query for all running containers', async () => {
      mockGetEndpoints.mockResolvedValue([{ Id: 1, Name: 'prod' }]);
      mockGetContainers.mockResolvedValue([
        { Id: 'c1', Names: ['/app'], State: 'running', Image: 'node:18' },
        { Id: 'c2', Names: ['/api'], State: 'running', Image: 'node:18' },
        { Id: 'c3', Names: ['/web'], State: 'exited', Image: 'node:18' },
      ]);

      await runMonitoringCycle();

      // Single call with only the two running container IDs (exited excluded)
      expect(mockGetLatestMetricsBatch).toHaveBeenCalledTimes(1);
      expect(mockGetLatestMetricsBatch).toHaveBeenCalledWith(['c1', 'c2']);
    });
  });

  describe('cycle:complete emission', () => {
    it('emits cycle:complete with stats when namespace is set', async () => {
      const mockEmit = vi.fn();
      const mockTo = vi.fn().mockReturnValue({ emit: vi.fn() });
      setMonitoringNamespace({ emit: mockEmit, to: mockTo } as unknown as import('socket.io').Namespace);

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

  describe('deduplication filters downstream FK references (#693)', () => {
    it('does not trigger investigation for deduplicated (skipped) insights', async () => {
      mockGetEndpoints.mockResolvedValue([{ Id: 1, Name: 'local' }]);
      mockGetContainers.mockResolvedValue([
        { Id: 'c1', Names: ['/web-app'], State: 'running', Image: 'node:18' },
        { Id: 'c2', Names: ['/api-svc'], State: 'running', Image: 'node:18' },
      ]);
      mockDetectAnomalyAdaptive.mockReturnValue({
        is_anomalous: true, z_score: 4.5, current_value: 95.0, mean: 40.0, method: 'adaptive',
      });

      // Simulate deduplication: only the first container's insights are actually inserted
      mockInsertInsights.mockImplementation(async (insights: Array<{ id: string; container_id: string | null }>) => {
        const ids = new Set<string>();
        for (const ins of insights) {
          if (ins.container_id === 'c1') ids.add(ins.id);
          // c2 insights are "deduplicated" — not inserted
        }
        return ids;
      });

      await runMonitoringCycle();

      // triggerInvestigation should only be called for c1 insights (actually inserted)
      for (const call of mockTriggerInvestigation.mock.calls) {
        const insight = call[0] as { container_id: string };
        expect(insight.container_id).toBe('c1');
      }
      // Verify c2 was NOT passed to triggerInvestigation
      const c2Calls = mockTriggerInvestigation.mock.calls.filter(
        (call) => (call[0] as { container_id: string }).container_id === 'c2',
      );
      expect(c2Calls).toHaveLength(0);
    });

    it('does not pass deduplicated insights to correlateInsights', async () => {
      mockGetEndpoints.mockResolvedValue([{ Id: 1, Name: 'local' }]);
      mockGetContainers.mockResolvedValue([
        { Id: 'c1', Names: ['/web-app'], State: 'running', Image: 'node:18' },
        { Id: 'c2', Names: ['/api-svc'], State: 'running', Image: 'node:18' },
      ]);
      mockDetectAnomalyAdaptive.mockReturnValue({
        is_anomalous: true, z_score: 4.5, current_value: 95.0, mean: 40.0, method: 'adaptive',
      });

      // Only c1 insights inserted, c2 deduplicated
      mockInsertInsights.mockImplementation(async (insights: Array<{ id: string; container_id: string | null }>) => {
        const ids = new Set<string>();
        for (const ins of insights) {
          if (ins.container_id === 'c1') ids.add(ins.id);
        }
        return ids;
      });

      await runMonitoringCycle();

      // correlateInsights should only receive c1 insights
      expect(mockCorrelateInsights).toHaveBeenCalledTimes(1);
      const correlatedInsights = mockCorrelateInsights.mock.calls[0][0] as Array<{ container_id: string }>;
      for (const ins of correlatedInsights) {
        expect(ins.container_id).toBe('c1');
      }
    });

    it('skips investigation and correlation entirely when all insights are deduplicated', async () => {
      mockGetEndpoints.mockResolvedValue([{ Id: 1, Name: 'local' }]);
      mockGetContainers.mockResolvedValue([
        { Id: 'c1', Names: ['/web-app'], State: 'running', Image: 'node:18' },
      ]);
      mockDetectAnomalyAdaptive.mockReturnValue({
        is_anomalous: true, z_score: 4.5, current_value: 95.0, mean: 40.0, method: 'adaptive',
      });

      // All insights deduplicated — none actually inserted
      mockInsertInsights.mockResolvedValue(new Set<string>());

      await runMonitoringCycle();

      // No investigations should be triggered
      expect(mockTriggerInvestigation).not.toHaveBeenCalled();
      // No correlation should happen (no inserted insights)
      expect(mockCorrelateInsights).not.toHaveBeenCalled();
    });
  });

  describe('log noise reduction (#698)', () => {
    it('aggregates container fetch failures into a single warning', async () => {
      // Set up 3 endpoints, where 2 of them fail to fetch containers
      mockGetEndpoints.mockResolvedValue([
        { Id: 1, Name: 'ok' },
        { Id: 2, Name: 'fail-1' },
        { Id: 3, Name: 'fail-2' },
      ]);

      // cachedFetchSWR succeeds for endpoints, but fails for endpoints 2 and 3
      mockCachedFetchSWR.mockImplementation(async (key: string, _ttl: number, fn: () => Promise<unknown>) => {
        if (key === 'containers:2' || key === 'containers:3') {
          throw new Error('HTTP 500');
        }
        return fn();
      });
      mockGetContainers.mockResolvedValue([
        { Id: 'c1', Names: ['/app'], State: 'running', Image: 'node:18' },
      ]);

      await runMonitoringCycle();

      // Should still complete without throwing
      // mockInsertInsights is called even with partial data
      expect(mockInsertInsights).toHaveBeenCalled();
    });

    it('aggregates metrics read failures into a single warning', async () => {
      mockGetEndpoints.mockResolvedValue([{ Id: 1, Name: 'local' }]);
      mockGetContainers.mockResolvedValue([
        { Id: 'c1', Names: ['/app-1'], State: 'running', Image: 'node:18' },
        { Id: 'c2', Names: ['/app-2'], State: 'running', Image: 'node:18' },
        { Id: 'c3', Names: ['/app-3'], State: 'running', Image: 'node:18' },
      ]);

      // Batch metrics read fails
      mockGetLatestMetricsBatch.mockRejectedValue(new Error('DB connection error'));

      await runMonitoringCycle();

      // No metrics should have been collected, but cycle should complete
      expect(mockInsertInsights).toHaveBeenCalled();
    });

    it('completes cycle without errors even when all data fetches fail', async () => {
      mockGetEndpoints.mockResolvedValue([{ Id: 1, Name: 'fail' }]);

      // cachedFetchSWR fails for everything except endpoints
      mockCachedFetchSWR.mockImplementation(async (key: string, _ttl: number, fn: () => Promise<unknown>) => {
        if (key.startsWith('containers:')) {
          throw new Error('endpoint unreachable');
        }
        return fn();
      });

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

  describe('circuit breaker pre-check (#759)', () => {
    it('skips endpoints with open circuit breakers and does not fetch their containers', async () => {
      mockGetEndpoints.mockResolvedValue([
        { Id: 1, Name: 'healthy' },
        { Id: 2, Name: 'failing' },
      ]);

      // Endpoint 2 has an open circuit breaker
      mockIsCircuitOpen.mockImplementation((id: number) => id === 2);
      mockIsEndpointDegraded.mockReturnValue(false);

      mockGetContainers.mockResolvedValue([]);

      await runMonitoringCycle();

      // cachedFetchSWR should only be called for endpoint 1's containers, not endpoint 2
      const swrKeys = mockCachedFetchSWR.mock.calls.map(([key]: [string]) => key);
      const containerKeys = swrKeys.filter((k: string) => k.startsWith('containers:'));
      expect(containerKeys).toContain('containers:1');
      expect(containerKeys).not.toContain('containers:2');
    });
  });
});
