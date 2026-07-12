import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import errorHandlerPlugin, { formatErrorResponse, errorDetails } from './error-handler.js';
import { HttpError } from '../utils/http-error.js';

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

  it('honours the legacy status spelling as a fallback (#1511)', () => {
    // PortainerError carries only `.status` — previously misreported as 500.
    const r = formatErrorResponse({ status: 404, message: 'Portainer resource not found' }, false);
    expect(r.statusCode).toBe(404);
    expect(r.body.error).toBe('Portainer resource not found');
  });

  it('masks status-spelled 5xx errors in production', () => {
    const r = formatErrorResponse({ status: 502, message: 'connect ECONNREFUSED 10.0.0.5:9443' }, false);
    expect(r.statusCode).toBe(502);
    expect(r.body.error).toBe('Internal Server Error');
  });

  it('prefers statusCode over status when both are present', () => {
    const r = formatErrorResponse({ statusCode: 422, status: 500, message: 'capability unavailable' }, false);
    expect(r.statusCode).toBe(422);
    expect(r.body.error).toBe('capability unavailable');
  });
});

describe('errorDetails (#1518)', () => {
  it('returns the error message outside production', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      expect(errorDetails(new Error('relation "metrics" does not exist'))).toBe('relation "metrics" does not exist');
      expect(errorDetails(['local: ECONNREFUSED'])).toEqual(['local: ECONNREFUSED']);
      expect(errorDetails(undefined)).toBe('Unknown error');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('returns undefined in production so the field is omitted from JSON bodies', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(errorDetails(new Error('syntax error at or near "SELECT"'))).toBeUndefined();
      expect(errorDetails(['local: ECONNREFUSED'])).toBeUndefined();
      expect(JSON.stringify({ error: 'Failed', details: errorDetails(new Error('secret')) })).toBe('{"error":"Failed"}');
    } finally {
      process.env.NODE_ENV = prev;
    }
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

  it('maps a thrown HttpError to its statusCode (#1511)', async () => {
    const app = Fastify({ logger: false });
    await app.register(errorHandlerPlugin);
    app.get('/capability', async () => {
      throw new HttpError(422, 'Edge Async endpoints do not support "exec" operations.');
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/capability' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toContain('Edge Async');
    await app.close();
  });

  it('maps a thrown status-spelled error (PortainerError shape) to its status instead of 500 (#1511)', async () => {
    const app = Fastify({ logger: false });
    await app.register(errorHandlerPlugin);
    app.get('/tunnel', async () => {
      throw Object.assign(new Error('Edge agent tunnel did not establish within timeout'), { status: 504 });
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/tunnel' });
    expect(res.statusCode).toBe(504);
    await app.close();
  });
});
