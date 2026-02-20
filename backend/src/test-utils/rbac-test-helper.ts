/**
 * Shared RBAC test helpers for route tests.
 *
 * Usage:
 *   let currentRole: Role = 'admin';
 *   // ... app setup with preHandler that reads currentRole ...
 *
 *   describe('RBAC', () => {
 *     testAdminOnly(() => app, (r) => { currentRole = r; }, 'POST', '/api/backup');
 *   });
 */
import { it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';

export type Role = 'viewer' | 'operator' | 'admin';
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Generates RBAC denial tests for admin-only routes.
 * Creates `it()` blocks verifying that viewer and operator roles receive 403.
 */
export function testAdminOnly(
  getApp: () => FastifyInstance,
  setRole: (role: Role) => void,
  method: HttpMethod,
  url: string,
  body?: unknown,
): void {
  testMinRole(getApp, setRole, 'admin', method, url, body);
}

/**
 * Generates RBAC denial tests for routes requiring a minimum role.
 * Creates `it()` blocks verifying that all lower roles receive 403.
 *
 * - minRole 'admin'    → tests viewer, operator
 * - minRole 'operator' → tests viewer
 */
export function testMinRole(
  getApp: () => FastifyInstance,
  setRole: (role: Role) => void,
  minRole: 'operator' | 'admin',
  method: HttpMethod,
  url: string,
  body?: unknown,
): void {
  const deniedRoles: Role[] = minRole === 'admin'
    ? ['viewer', 'operator']
    : ['viewer'];

  for (const role of deniedRoles) {
    it(`rejects ${role} with 403 on ${method} ${url}`, async () => {
      setRole(role);
      const response = await getApp().inject({
        method,
        url,
        ...(body !== undefined ? { payload: body } : {}),
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'Insufficient permissions' });
    });
  }
}
