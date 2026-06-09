import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { systemInfoRoutes } from '../routes/system-info.js';

describe('GET /api/admin/system-info', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('authenticate', async () => undefined);
    app.decorate('requireRole', () => async () => undefined);
    await app.register(systemInfoRoutes, { appVersion: '9.9.9-test' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the injected app version plus the running node and fastify versions', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/admin/system-info' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.app).toBe('9.9.9-test');
    expect(body.node).toBe(process.versions.node);
    expect(typeof body.fastify).toBe('string');
    expect(body.fastify.length).toBeGreaterThan(0);
  });

  it('wires requireRole("admin") as a preHandler and denies when it rejects', async () => {
    const rolesChecked: string[] = [];
    const denyApp = Fastify({ logger: false });
    denyApp.setValidatorCompiler(validatorCompiler);
    denyApp.setSerializerCompiler(serializerCompiler);
    denyApp.decorate('authenticate', async () => undefined);
    denyApp.decorate('requireRole', (role: string) => {
      rolesChecked.push(role);
      return async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
        reply.code(403).send({ error: 'forbidden' });
      };
    });
    await denyApp.register(systemInfoRoutes, { appVersion: 'x' });
    await denyApp.ready();

    const response = await denyApp.inject({ method: 'GET', url: '/api/admin/system-info' });

    expect(rolesChecked).toContain('admin');
    expect(response.statusCode).toBe(403);
    await denyApp.close();
  });
});
