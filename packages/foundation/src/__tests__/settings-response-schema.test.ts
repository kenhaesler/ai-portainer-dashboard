/**
 * Field-presence test for the GET /api/settings response schema (#1545).
 *
 * The settings table is exactly { key, value, category, updated_at } and the
 * frontend reads key/value/category. Declaring `response: { 200: z.array(
 * SettingSchema) }` must preserve those fields and prune anything else. The DB
 * router is mocked to return a controlled row incl. a synthetic internal field.
 */
import { describe, it, expect, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';

const ROW = {
  key: 'llm.model',
  value: 'gpt-4o-mini',
  category: 'ai',
  updated_at: '2026-07-13T00:00:00.000Z',
};

vi.mock('@dashboard/core/db/app-db-router.js', () => ({
  getDbForDomain: () => ({
    // Return the row with a synthetic extra column the schema must prune.
    query: async () => [{ ...ROW, internal_only: 'should-be-pruned' }],
  }),
}));

import { settingsRoutes } from '../routes/settings.js';

function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('authenticate', async () => undefined);
  app.decorate('requireRole', () => async () => undefined);
  return app;
}

describe('GET /api/settings response schema', () => {
  it('returns key/value/category/updated_at and prunes internal columns', async () => {
    const app = buildApp();
    await app.register(settingsRoutes);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]).toEqual(ROW);
    await app.close();
  });
});
