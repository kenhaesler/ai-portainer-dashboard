/**
 * Field-presence test for the GET /api/investigations response schema (#1545).
 *
 * getInvestigations returns InvestigationWithInsight[] (SELECT i.* + the joined
 * insight_title/insight_severity/insight_category). The response schema is
 * z.object({ investigations: z.array(InvestigationWithInsightSchema) }) — it
 * must preserve the 18 investigation columns AND the 3 join fields, while
 * pruning anything else. The store is mocked (the boundary).
 */
import { describe, it, expect, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';

vi.mock('../services/investigation-store.js', () => ({
  getInvestigations: vi.fn(),
  getInvestigation: vi.fn(),
  getInvestigationByInsightId: vi.fn(),
}));

import { getInvestigations } from '../services/investigation-store.js';
import { investigationRoutes } from '../routes/investigations.js';

const INVESTIGATION = {
  id: 'inv-1',
  insight_id: 'ins-1',
  endpoint_id: 1,
  container_id: 'c1',
  container_name: 'web',
  status: 'complete',
  evidence_summary: null,
  root_cause: 'oom-kill',
  contributing_factors: null,
  severity_assessment: null,
  recommended_actions: null,
  confidence_score: 0.9,
  analysis_duration_ms: 1200,
  llm_model: 'gpt-4o-mini',
  ai_summary: 'Container was OOM-killed',
  error_message: null,
  created_at: '2026-07-13T00:00:00.000Z',
  completed_at: '2026-07-13T00:01:00.000Z',
  // Joined insight metadata (InvestigationWithInsight)
  insight_title: 'High CPU',
  insight_severity: 'warning',
  insight_category: 'performance',
};

function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('authenticate', async () => undefined);
  app.decorate('requireRole', () => async () => undefined);
  return app;
}

describe('GET /api/investigations response schema', () => {
  it('preserves the 18 columns + insight_* join fields and prunes internals', async () => {
    vi.mocked(getInvestigations).mockResolvedValue([
      { ...INVESTIGATION, internal_secret: 'should-be-pruned' },
    ] as never);

    const app = buildApp();
    await app.register(investigationRoutes);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/investigations' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.investigations[0]).toEqual(INVESTIGATION);
    await app.close();
  });
});
