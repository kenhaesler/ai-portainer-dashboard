import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import swaggerPlugin from './swagger.js';

describe('swagger plugin', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('does not expose /docs in production', async () => {
    process.env.NODE_ENV = 'production';
    const app = Fastify();

    await app.register(swaggerPlugin);
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/docs' });
    expect(response.statusCode).toBe(404);

    await app.close();
  });

  it('exposes /docs in non-production', async () => {
    process.env.NODE_ENV = 'development';
    const app = Fastify();

    await app.register(swaggerPlugin);
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/docs' });
    expect(response.statusCode).toBe(200);

    await app.close();
  });
});
