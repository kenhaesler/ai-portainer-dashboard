import { describe, it, expect } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { assertUser } from './auth-helpers.js';

describe('assertUser', () => {
  it('returns request.user when present', () => {
    const user = { sub: 'u1', username: 'alice', sessionId: 's1', role: 'admin' as const };
    const request = { user } as unknown as FastifyRequest;

    expect(assertUser(request)).toBe(user);
  });

  it('throws a loud error when request.user is undefined', () => {
    const request = { user: undefined } as unknown as FastifyRequest;

    expect(() => assertUser(request)).toThrow(
      /assertUser called without authenticate preHandler/,
    );
  });

  it('throws when request.user is missing entirely', () => {
    // Simulate a request that has never been touched by an `authenticate`
    // preHandler — the property may be absent rather than explicitly
    // undefined.
    const request = {} as unknown as FastifyRequest;

    expect(() => assertUser(request)).toThrow(
      /assertUser called without authenticate preHandler/,
    );
  });
});
