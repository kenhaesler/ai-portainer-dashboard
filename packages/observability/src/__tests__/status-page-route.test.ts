import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import {
  statusPageRoutes,
  clearStatusPageCache,
  STATUS_PAGE_CACHE_TTL_MS,
} from '../routes/status-page.js';
import {
  getStatusPageConfig,
  getUptimeSummary,
  getLatestSnapshot,
  getDailyUptimeBuckets,
  getRecentIncidentsPublic,
} from '../services/status-page-store.js';

// Kept: status-page-store mock — no PostgreSQL in CI
vi.mock('../services/status-page-store.js', () => ({
  getStatusPageConfig: vi.fn(async () => ({
    enabled: true,
    title: 'System Status',
    description: 'Current system health',
    showIncidents: true,
    autoRefreshSeconds: 30,
  })),
  getUptimeSummary: vi.fn(async () => ({
    containers: { '24h': 99.95, '7d': 99.95, '30d': 99.95 },
    endpoints: { '24h': 100, '7d': 100, '30d': 100 },
  })),
  getLatestSnapshot: vi.fn(async () => ({
    containersRunning: 5,
    containersStopped: 0,
    containersUnhealthy: 0,
    endpointsUp: 2,
    endpointsDown: 0,
    createdAt: '2026-02-06T12:00:00Z',
  })),
  getDailyUptimeBuckets: vi.fn(async () => [
    { date: '2026-02-05', uptime_pct: 100 },
    { date: '2026-02-06', uptime_pct: 99.5 },
  ]),
  getRecentIncidentsPublic: vi.fn(async () => []),
}));

const mockedGetStatusPageConfig = vi.mocked(getStatusPageConfig);
const mockedGetUptimeSummary = vi.mocked(getUptimeSummary);
const mockedGetLatestSnapshot = vi.mocked(getLatestSnapshot);
const mockedGetDailyUptimeBuckets = vi.mocked(getDailyUptimeBuckets);
const mockedGetRecentIncidentsPublic = vi.mocked(getRecentIncidentsPublic);

describe('status-page routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    clearStatusPageCache();

    // Re-establish defaults after clearAllMocks
    mockedGetStatusPageConfig.mockResolvedValue({
      enabled: true,
      title: 'System Status',
      description: 'Current system health',
      showIncidents: true,
      autoRefreshSeconds: 30,
    });
    mockedGetUptimeSummary.mockResolvedValue({
      containers: { '24h': 99.95, '7d': 99.95, '30d': 99.95 },
      endpoints: { '24h': 100, '7d': 100, '30d': 100 },
    });
    mockedGetLatestSnapshot.mockResolvedValue({
      containersRunning: 5,
      containersStopped: 0,
      containersUnhealthy: 0,
      endpointsUp: 2,
      endpointsDown: 0,
      createdAt: '2026-02-06T12:00:00Z',
    });
    mockedGetDailyUptimeBuckets.mockResolvedValue([
      { date: '2026-02-05', uptime_pct: 100 },
      { date: '2026-02-06', uptime_pct: 99.5 },
    ]);
    mockedGetRecentIncidentsPublic.mockResolvedValue([]);

    app = Fastify();
    await app.register(statusPageRoutes);
    await app.ready();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /api/status', () => {
    it('should return status page data when enabled', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/status',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.title).toBe('System Status');
      expect(body.overallStatus).toBe('operational');
      expect(body.uptime).toBeDefined();
      expect(body.uptime['24h']).toBe(99.95);
      expect(body.endpointUptime['24h']).toBe(100);
      expect(body.snapshot).toBeDefined();
      expect(body.snapshot.containersRunning).toBe(5);
      expect(body.uptimeTimeline).toHaveLength(2);
      expect(body.autoRefreshSeconds).toBe(30);
    });

    it('should return 404 when status page is disabled', async () => {
      mockedGetStatusPageConfig.mockResolvedValue({
        enabled: false,
        title: 'System Status',
        description: '',
        showIncidents: true,
        autoRefreshSeconds: 30,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/status',
      });

      expect(response.statusCode).toBe(404);
    });

    it('should only run the config lookup when disabled (#1506)', async () => {
      mockedGetStatusPageConfig.mockResolvedValue({
        enabled: false,
        title: 'System Status',
        description: '',
        showIncidents: true,
        autoRefreshSeconds: 30,
      });

      await app.inject({ method: 'GET', url: '/api/status' });

      expect(mockedGetStatusPageConfig).toHaveBeenCalledTimes(1);
      expect(mockedGetLatestSnapshot).not.toHaveBeenCalled();
      expect(mockedGetUptimeSummary).not.toHaveBeenCalled();
      expect(mockedGetDailyUptimeBuckets).not.toHaveBeenCalled();
      expect(mockedGetRecentIncidentsPublic).not.toHaveBeenCalled();
    });

    it('should report degraded when containers are stopped', async () => {
      mockedGetLatestSnapshot.mockResolvedValue({
        containersRunning: 3,
        containersStopped: 2,
        containersUnhealthy: 0,
        endpointsUp: 2,
        endpointsDown: 0,
        createdAt: '2026-02-06T12:00:00Z',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/status',
      });

      const body = JSON.parse(response.payload);
      expect(body.overallStatus).toBe('degraded');
    });

    it('should report major_outage when endpoints are down', async () => {
      mockedGetLatestSnapshot.mockResolvedValue({
        containersRunning: 0,
        containersStopped: 5,
        containersUnhealthy: 0,
        endpointsUp: 0,
        endpointsDown: 2,
        createdAt: '2026-02-06T12:00:00Z',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/status',
      });

      const body = JSON.parse(response.payload);
      expect(body.overallStatus).toBe('major_outage');
    });

    it('should include incidents when showIncidents is true', async () => {
      mockedGetRecentIncidentsPublic.mockResolvedValue([
        {
          id: 'inc-1',
          title: 'High CPU on web-app',
          severity: 'critical',
          status: 'resolved',
          created_at: '2026-02-06T10:00:00Z',
          resolved_at: '2026-02-06T10:30:00Z',
          summary: '2 anomalies detected',
        },
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/status',
      });

      const body = JSON.parse(response.payload);
      expect(body.recentIncidents).toHaveLength(1);
      expect(body.recentIncidents[0].title).toBe('High CPU on web-app');
    });

    it('should exclude incidents when showIncidents is false', async () => {
      mockedGetStatusPageConfig.mockResolvedValue({
        enabled: true,
        title: 'Status',
        description: '',
        showIncidents: false,
        autoRefreshSeconds: 30,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/status',
      });

      const body = JSON.parse(response.payload);
      expect(body.recentIncidents).toBeUndefined();
      expect(mockedGetRecentIncidentsPublic).not.toHaveBeenCalled();
    });

    it('should handle null snapshot gracefully', async () => {
      mockedGetLatestSnapshot.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/api/status',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.snapshot).toBeNull();
      expect(body.overallStatus).toBe('operational');
    });

    it('should not require authentication', async () => {
      // No auth headers needed — this is a public endpoint
      const response = await app.inject({
        method: 'GET',
        url: '/api/status',
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('GET /api/status caching (#1506)', () => {
    it('should serve the cached payload within the TTL without re-querying', async () => {
      const first = await app.inject({ method: 'GET', url: '/api/status' });
      const second = await app.inject({ method: 'GET', url: '/api/status' });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(second.payload).toBe(first.payload);

      // The entire fan-out ran exactly once across both requests
      expect(mockedGetStatusPageConfig).toHaveBeenCalledTimes(1);
      expect(mockedGetUptimeSummary).toHaveBeenCalledTimes(1);
      expect(mockedGetLatestSnapshot).toHaveBeenCalledTimes(1);
      expect(mockedGetDailyUptimeBuckets).toHaveBeenCalledTimes(1);
      expect(mockedGetRecentIncidentsPublic).toHaveBeenCalledTimes(1);
    });

    it('should reload after the TTL expires', async () => {
      const t0 = Date.now();
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(t0);

      await app.inject({ method: 'GET', url: '/api/status' });
      expect(mockedGetStatusPageConfig).toHaveBeenCalledTimes(1);

      nowSpy.mockReturnValue(t0 + STATUS_PAGE_CACHE_TTL_MS + 1);
      await app.inject({ method: 'GET', url: '/api/status' });
      expect(mockedGetStatusPageConfig).toHaveBeenCalledTimes(2);
    });

    it('should cache the disabled (404) result too', async () => {
      mockedGetStatusPageConfig.mockResolvedValue({
        enabled: false,
        title: 'System Status',
        description: '',
        showIncidents: true,
        autoRefreshSeconds: 30,
      });

      const first = await app.inject({ method: 'GET', url: '/api/status' });
      const second = await app.inject({ method: 'GET', url: '/api/status' });

      expect(first.statusCode).toBe(404);
      expect(second.statusCode).toBe(404);
      expect(mockedGetStatusPageConfig).toHaveBeenCalledTimes(1);
    });

    it('should not cache a failed load', async () => {
      mockedGetUptimeSummary.mockRejectedValueOnce(new Error('db down'));

      const failed = await app.inject({ method: 'GET', url: '/api/status' });
      expect(failed.statusCode).toBe(500);

      const recovered = await app.inject({ method: 'GET', url: '/api/status' });
      expect(recovered.statusCode).toBe(200);
      expect(mockedGetUptimeSummary).toHaveBeenCalledTimes(2);
    });

    it('should share one load between concurrent cold-cache requests', async () => {
      const [a, b] = await Promise.all([
        app.inject({ method: 'GET', url: '/api/status' }),
        app.inject({ method: 'GET', url: '/api/status' }),
      ]);

      expect(a.statusCode).toBe(200);
      expect(b.statusCode).toBe(200);
      expect(mockedGetStatusPageConfig).toHaveBeenCalledTimes(1);
      expect(mockedGetUptimeSummary).toHaveBeenCalledTimes(1);
    });
  });
});
