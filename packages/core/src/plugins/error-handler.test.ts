import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import errorHandlerPlugin, { formatErrorResponse } from './error-handler.js';

describe('formatErrorResponse', () => {
  it('hides 5xx messages in production but logs nothing sensitive to the client', () => {
    const r = formatErrorResponse({ statusCode: 500, message: 'syntax error at or near "SELECT" — table users' }, false);
    expect(r.statusCode).toBe(500);
    expect(r.body.error).toBe('Internal Server Error');
    expect(JSON.stringify(r.body)).not.toContain('SELECT');
  });

  it('surfaces 5xx messages in development for debuggability', () => {
    const r = formatErrorResponse({ statusCode: 500, message: 'boom' }, true);
    expect(r.body.error).toBe('boom');
  });

  it('treats an error with no statusCode as 500', () => {
    const r = formatErrorResponse({ message: 'raw db error' }, false);
    expect(r.statusCode).toBe(500);
    expect(r.body.error).toBe('Internal Server Error');
  });

  it('preserves 4xx client/validation errors and their details', () => {
    const r = formatErrorResponse({ statusCode: 400, message: 'querystring/limit must be <= 1000', validation: [{ field: 'limit' }] }, false);
    expect(r.statusCode).toBe(400);
    expect(r.body.error).toContain('limit');
    expect(r.body.details).toEqual([{ field: 'limit' }]);
  });
});

describe('error-handler plugin (production mode)', () => {
  it('returns a generic 500 body for an uncaught error and does not reflect the message', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const app = Fastify({ logger: false });
      await app.register(errorHandlerPlugin);
      app.get('/boom', async () => {
        throw new Error('connection terminated: password authentication failed for user "app_user"');
      });
      await app.ready();

      const res = await app.inject({ method: 'GET', url: '/boom' });
      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({ error: 'Internal Server Error' });
      expect(res.payload).not.toContain('app_user');
      await app.close();
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('preserves an explicit 4xx error message', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const app = Fastify({ logger: false });
      await app.register(errorHandlerPlugin);
      app.get('/bad', async () => {
        const err = new Error('Missing required field') as Error & { statusCode?: number };
        err.statusCode = 400;
        throw err;
      });
      await app.ready();

      const res = await app.inject({ method: 'GET', url: '/bad' });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Missing required field');
      await app.close();
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
