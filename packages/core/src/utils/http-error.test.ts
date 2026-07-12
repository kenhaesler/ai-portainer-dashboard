import { describe, it, expect } from 'vitest';
import { HttpError, getErrorStatusCode } from './http-error.js';

describe('HttpError', () => {
  it('carries statusCode, message, and name', () => {
    const err = new HttpError(422, 'capability unavailable');
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(422);
    expect(err.message).toBe('capability unavailable');
    expect(err.name).toBe('HttpError');
  });

  it('supports an optional machine-readable code and cause', () => {
    const cause = new Error('upstream');
    const err = new HttpError(504, 'tunnel timeout', { code: 'EDGE_TUNNEL_TIMEOUT', cause });
    expect(err.code).toBe('EDGE_TUNNEL_TIMEOUT');
    expect(err.cause).toBe(cause);
  });
});

describe('getErrorStatusCode', () => {
  it('reads the canonical statusCode spelling (HttpError, Fastify)', () => {
    expect(getErrorStatusCode(new HttpError(422, 'nope'))).toBe(422);
    const fastifyStyle = Object.assign(new Error('bad'), { statusCode: 400 });
    expect(getErrorStatusCode(fastifyStyle)).toBe(400);
  });

  it('falls back to the legacy status spelling (PortainerError, fetch-style)', () => {
    const portainerStyle = Object.assign(new Error('upstream 502'), { status: 502 });
    expect(getErrorStatusCode(portainerStyle)).toBe(502);
  });

  it('prefers statusCode when both spellings are present', () => {
    const both = Object.assign(new Error('x'), { statusCode: 422, status: 500 });
    expect(getErrorStatusCode(both)).toBe(422);
  });

  it('returns undefined for plain errors and non-objects', () => {
    expect(getErrorStatusCode(new Error('plain'))).toBeUndefined();
    expect(getErrorStatusCode('string')).toBeUndefined();
    expect(getErrorStatusCode(null)).toBeUndefined();
    expect(getErrorStatusCode(undefined)).toBeUndefined();
  });

  it('ignores values that are not valid HTTP error statuses', () => {
    expect(getErrorStatusCode(Object.assign(new Error('x'), { status: 'failed' }))).toBeUndefined();
    expect(getErrorStatusCode(Object.assign(new Error('x'), { status: 302 }))).toBeUndefined();
    expect(getErrorStatusCode(Object.assign(new Error('x'), { statusCode: 600 }))).toBeUndefined();
    expect(getErrorStatusCode(Object.assign(new Error('x'), { statusCode: 404.5 }))).toBeUndefined();
  });
});
