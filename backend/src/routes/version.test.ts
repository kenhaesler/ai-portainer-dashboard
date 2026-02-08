import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { versionRoutes } from './version.js';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

import { readFileSync, existsSync } from 'node:fs';

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
    vi.mocked(readFileSync).mockReset();
    vi.mocked(existsSync).mockReset();
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
    vi.mocked(existsSync).mockReturnValue(false);
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/version' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toEqual({ commit: 'abc1234' });
  });

  it('falls back to dev when commit is not set', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/version' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.commit).toBe('dev');
  });

  it('reads commit hash from git head ref when env is missing', async () => {
    vi.mocked(existsSync).mockImplementation((file) => {
      const filePath = String(file);
      if (filePath.endsWith('.git')) return true;
      if (filePath.endsWith('HEAD')) return true;
      if (filePath.endsWith('refs/heads/dev')) return true;
      return false;
    });

    vi.mocked(readFileSync).mockImplementation((file) => {
      const filePath = String(file);
      if (filePath.endsWith('HEAD')) return 'ref: refs/heads/dev';
      if (filePath.endsWith('refs/heads/dev')) return 'deadbeefcafefeed1234';
      return '';
    });

    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/version' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.commit).toBe('deadbee');
  });
});
