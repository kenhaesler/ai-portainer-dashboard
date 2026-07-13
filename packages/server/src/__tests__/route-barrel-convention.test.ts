import { describe, it, expect } from 'vitest';

// #1533 regression: routes must be registered from each package's
// `routes/index.js` subpath, never re-exported from the package barrel. This
// keeps route-module side effects (cache-sweep timers) off the barrel import
// path and matches the core/src/CLAUDE.md rule. These tests fail if a route
// registrar leaks back onto a barrel or the routes subpath drops one.
import * as aiBarrel from '@dashboard/ai';
import * as aiRoutes from '@dashboard/ai/routes/index.js';
import * as opsBarrel from '@dashboard/operations';
import * as opsRoutes from '@dashboard/operations/routes/index.js';
import * as obsBarrel from '@dashboard/observability';
import * as obsRoutes from '@dashboard/observability/routes/index.js';
import * as foundationBarrel from '@dashboard/foundation';
import * as foundationRoutes from '@dashboard/foundation/routes/index.js';

const cases: Array<{
  name: string;
  barrel: Record<string, unknown>;
  routes: Record<string, unknown>;
  registrars: string[];
}> = [
  {
    name: '@dashboard/ai',
    barrel: aiBarrel as unknown as Record<string, unknown>,
    routes: aiRoutes as unknown as Record<string, unknown>,
    registrars: ['monitoringRoutes', 'incidentsRoutes', 'correlationRoutes', 'llmRoutes'],
  },
  {
    name: '@dashboard/operations',
    barrel: opsBarrel as unknown as Record<string, unknown>,
    routes: opsRoutes as unknown as Record<string, unknown>,
    registrars: ['remediationRoutes', 'webhookRoutes', 'notificationRoutes'],
  },
  {
    name: '@dashboard/observability',
    barrel: obsBarrel as unknown as Record<string, unknown>,
    routes: obsRoutes as unknown as Record<string, unknown>,
    registrars: ['observabilityRoutes'],
  },
  {
    name: '@dashboard/foundation',
    barrel: foundationBarrel as unknown as Record<string, unknown>,
    routes: foundationRoutes as unknown as Record<string, unknown>,
    registrars: ['authRoutes', 'dashboardRoutes', 'settingsRoutes', 'userRoutes'],
  },
];

describe('route registrars are exposed via routes/index.js, not the barrel (#1533)', () => {
  for (const { name, barrel, routes, registrars } of cases) {
    for (const registrar of registrars) {
      it(`${name}: ${registrar} is on the routes subpath but not the barrel`, () => {
        expect(typeof routes[registrar]).toBe('function');
        expect(Object.keys(barrel)).not.toContain(registrar);
      });
    }
  }
});
