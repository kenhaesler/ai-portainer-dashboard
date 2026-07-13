/**
 * Field-presence test for the GET /api/incidents response schema (#1545).
 *
 * getIncidents does SELECT * FROM incidents, so rows carry a `signature` column
 * (added in migration 029) that is NOT part of the frontend Incident type. The
 * response schema z.object({ incidents: z.array(IncidentSchema), counts, limit,
 * offset }) must preserve every IncidentSchema field + counts/limit/offset and
 * prune the internal `signature`. The store is mocked (the boundary).
 */
import { describe, it, expect, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';

vi.mock('../services/incident-store.js', () => ({
  getIncidents: vi.fn(),
  getIncident: vi.fn(),
  resolveIncident: vi.fn(),
  getIncidentCount: vi.fn(),
  getIncidentGroups: vi.fn(),
  resolveIncidentsBatch: vi.fn(),
}));

import { getIncidents, getIncidentCount } from '../services/incident-store.js';
import { incidentsRoutes } from '../routes/incidents.js';

const INCIDENT = {
  id: 'inc-1',
  title: 'CPU spike across web tier',
  severity: 'critical',
  status: 'active',
  root_cause_insight_id: 'ins-1',
  related_insight_ids: ['ins-1', 'ins-2'],
  affected_containers: ['c1', 'c2'],
  endpoint_id: 1,
  endpoint_name: 'ep-1',
  correlation_type: 'temporal',
  correlation_confidence: 'high',
  insight_count: 2,
  summary: 'Correlated CPU anomalies',
  created_at: '2026-07-13T00:00:00.000Z',
  updated_at: '2026-07-13T00:00:00.000Z',
  resolved_at: null,
};
const COUNTS = { active: 1, resolved: 0, total: 1 };

function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('authenticate', async () => undefined);
  app.decorate('requireRole', () => async () => undefined);
  return app;
}

describe('GET /api/incidents response schema', () => {
  it('preserves IncidentSchema fields + counts/limit/offset and prunes signature', async () => {
    // Row carries the internal `signature` column the schema must prune.
    vi.mocked(getIncidents).mockResolvedValue([{ ...INCIDENT, signature: 'sig-1' }] as never);
    vi.mocked(getIncidentCount).mockResolvedValue(COUNTS as never);

    const app = buildApp();
    await app.register(incidentsRoutes);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/incidents' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.counts).toEqual(COUNTS);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
    expect(body.incidents[0]).toEqual(INCIDENT);
    expect(body.incidents[0].signature).toBeUndefined();
    await app.close();
  });
});
