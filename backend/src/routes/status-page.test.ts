import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { statusPageRoutes } from './status-page.js';
import {
  getStatusPageConfig,
  getOverallUptime,
  getEndpointUptime,
  getLatestSnapshot,
  getDailyUptimeBuckets,
  getRecentIncidentsPublic,
} from '../services/status-page-store.js';

vi.mock('../services/status-page-store.js', () => ({
  getStatusPageConfig: vi.fn(() => ({
    enabled: true,
    title: 'System Status',
    description: 'Current system health',
    showIncidents: true,
    autoRefreshSeconds: 30,
  })),
  getOverallUptime: vi.fn(() => 99.95),
  getEndpointUptime: vi.fn(() => 100),
  getLatestSnapshot: vi.fn(() => ({
    containersRunning: 5,
    containersStopped: 0,
    containersUnhealthy: 0,
    endpointsUp: 2,
    endpointsDown: 0,
    createdAt: '2026-02-06T12:00:00Z',
  })),
  getDailyUptimeBuckets: vi.fn(() => [
    { date: '2026-02-05', uptime_pct: 100 },
    { date: '2026-02-06', uptime_pct: 99.5 },
  ]),
  getRecentIncidentsPublic: vi.fn(() => []),
}));

vi.mock('../db/sqlite.js', () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
      get: vi.fn(),
      run: vi.fn(),
    })),
  })),
}));

const mockedGetStatusPageConfig = vi.mocked(getStatusPageConfig);
const mockedGetOverallUptime = vi.mocked(getOverallUptime);
const mockedGetEndpointUptime = vi.mocked(getEndpointUptime);
const mockedGetLatestSnapshot = vi.mocked(getLatestSnapshot);
const mockedGetDailyUptimeBuckets = vi.mocked(getDailyUptimeBuckets);
const mockedGetRecentIncidentsPublic = vi.mocked(getRecentIncidentsPublic);

describe('status-page routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Re-establish defaults after clearAllMocks
    mockedGetStatusPageConfig.mockReturnValue({
      enabled: true,
      title: 'System Status',
      description: 'Current system health',
      showIncidents: true,
      autoRefreshSeconds: 30,
    });
    mockedGetOverallUptime.mockReturnValue(99.95);
    mockedGetEndpointUptime.mockReturnValue(100);
    mockedGetLatestSnapshot.mockReturnValue({
      containersRunning: 5,
      containersStopped: 0,
      containersUnhealthy: 0,
      endpointsUp: 2,
      endpointsDown: 0,
      createdAt: '2026-02-06T12:00:00Z',
    });
    mockedGetDailyUptimeBuckets.mockReturnValue([
      { date: '2026-02-05', uptime_pct: 100 },
      { date: '2026-02-06', uptime_pct: 99.5 },
    ]);
    mockedGetRecentIncidentsPublic.mockReturnValue([]);

    app = Fastify();
    await app.register(statusPageRoutes);
    await app.ready();
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
      expect(body.snapshot).toBeDefined();
      expect(body.snapshot.containersRunning).toBe(5);
      expect(body.uptimeTimeline).toHaveLength(2);
      expect(body.autoRefreshSeconds).toBe(30);
    });

    it('should return 404 when status page is disabled', async () => {
      mockedGetStatusPageConfig.mockReturnValue({
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

    it('should report degraded when containers are stopped', async () => {
      mockedGetLatestSnapshot.mockReturnValue({
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
      mockedGetLatestSnapshot.mockReturnValue({
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
      mockedGetRecentIncidentsPublic.mockReturnValue([
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
      mockedGetStatusPageConfig.mockReturnValue({
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
    });

    it('should handle null snapshot gracefully', async () => {
      mockedGetLatestSnapshot.mockReturnValue(null);

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
});
