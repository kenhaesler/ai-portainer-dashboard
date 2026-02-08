import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { versionRoutes } from './version.js';

function buildApp() {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.register(versionRoutes);
  return app;
}

describe('version routes', () => {
  const originalGitCommit = process.env.GIT_COMMIT;

  beforeEach(() => {
    delete process.env.GIT_COMMIT;
  });

  afterEach(() => {
    if (originalGitCommit) {
      process.env.GIT_COMMIT = originalGitCommit;
    } else {
      delete process.env.GIT_COMMIT;
    }
  });

  it('returns commit hash from environment', async () => {
    process.env.GIT_COMMIT = 'abc1234';
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/version' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toEqual({ commit: 'abc1234' });
  });

  it('falls back to dev when commit is not set', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/version' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.commit).toBe('dev');
  });
});
