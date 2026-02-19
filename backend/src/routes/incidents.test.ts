import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { incidentsRoutes } from './incidents.js';
import { getIncidents, getIncident, resolveIncident, getIncidentCount } from '../services/incident-store.js';

// Mock the stores — all functions are now async
vi.mock('../services/incident-store.js', () => ({
  getIncidents: vi.fn(() => Promise.resolve([])),
  getIncident: vi.fn(() => Promise.resolve(null)),
  resolveIncident: vi.fn(() => Promise.resolve()),
  getIncidentCount: vi.fn(() => Promise.resolve({ active: 0, resolved: 0, total: 0 })),
}));

// Kept: route imports getDbForDomain directly for insights queries
vi.mock('../db/app-db-router.js', () => ({
  getDbForDomain: vi.fn(() => ({
    query: vi.fn(() => Promise.resolve([])),
    queryOne: vi.fn(() => Promise.resolve(null)),
    execute: vi.fn(() => Promise.resolve({ changes: 0 })),
  })),
}));

const mockedGetIncidents = vi.mocked(getIncidents);
const mockedGetIncident = vi.mocked(getIncident);
const mockedResolveIncident = vi.mocked(resolveIncident);
const mockedGetIncidentCount = vi.mocked(getIncidentCount);

describe('incidents routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify();

    // Mock auth decorator
    app.decorate('authenticate', async () => {});
    await app.register(incidentsRoutes);
    await app.ready();
  });

  describe('GET /api/incidents', () => {
    it('should return incidents list with counts', async () => {
      mockedGetIncidents.mockResolvedValue([
        { id: 'inc-1', title: 'Test incident', severity: 'critical', status: 'active' } as never,
      ]);
      mockedGetIncidentCount.mockResolvedValue({ active: 1, resolved: 0, total: 1 });

      const response = await app.inject({
        method: 'GET',
        url: '/api/incidents',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.incidents).toHaveLength(1);
      expect(body.counts.active).toBe(1);
    });

    it('should filter by status', async () => {
      await app.inject({
        method: 'GET',
        url: '/api/incidents?status=active',
      });

      expect(mockedGetIncidents).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'active' }),
      );
    });
  });

  describe('GET /api/incidents/:id', () => {
    it('should return 404 for non-existent incident', async () => {
      mockedGetIncident.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/api/incidents/non-existent',
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return incident with related insights', async () => {
      mockedGetIncident.mockResolvedValue({
        id: 'inc-1',
        title: 'Test incident',
        root_cause_insight_id: 'insight-1',
        related_insight_ids: ['insight-2'],
      } as never);

      const response = await app.inject({
        method: 'GET',
        url: '/api/incidents/inc-1',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.id).toBe('inc-1');
      expect(body.relatedInsights).toBeDefined();
    });
  });

  describe('POST /api/incidents/:id/resolve', () => {
    it('should return 404 for non-existent incident', async () => {
      mockedGetIncident.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/api/incidents/non-existent/resolve',
      });

      expect(response.statusCode).toBe(404);
    });

    it('should resolve an existing incident', async () => {
      mockedGetIncident.mockResolvedValue({ id: 'inc-1', status: 'active' } as never);

      const response = await app.inject({
        method: 'POST',
        url: '/api/incidents/inc-1/resolve',
      });

      expect(response.statusCode).toBe(200);
      expect(mockedResolveIncident).toHaveBeenCalledWith('inc-1');
    });
  });
});
