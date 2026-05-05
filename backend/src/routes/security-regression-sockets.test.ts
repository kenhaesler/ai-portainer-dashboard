/**
 * Security Regression — Socket.IO Namespace Security
 *
 * Verifies admin-role enforcement and per-event throttling on Socket.IO
 * namespaces:
 *   • Remediation namespace requires admin role (defence-in-depth)
 *   • llm-chat handler implements per-user throttle on chat:message
 *   • monitoring + remediation namespaces use the shared throttle utility
 *   • insights:history payload validation (Zod): clamps limit, validates severity
 *
 * @see https://github.com/kenhaesler/ai-portainer-dashboard/issues/977
 * @see https://github.com/kenhaesler/ai-portainer-dashboard/issues/1102
 * @see https://github.com/kenhaesler/ai-portainer-dashboard/issues/1103
 * @see https://github.com/kenhaesler/ai-portainer-dashboard/issues/1188 (split)
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { setConfigForTest } from '@dashboard/core/config/index.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

// ─── Service Mocks ─────────────────────────────────────────────────────
// Required so the runtime monitoring/remediation namespace setup imports
// resolve without real DB/Portainer calls.
vi.mock('@dashboard/core/db/app-db-router.js', () => ({
  getDbForDomain: vi.fn(() => ({
    queryOne: vi.fn(async () => null),
    query: vi.fn(async () => []),
    execute: vi.fn(async () => ({ changes: 0 })),
    transaction: vi.fn(async (fn: (db: Record<string, unknown>) => Promise<unknown>) => fn({
      execute: vi.fn(async () => ({ changes: 0 })),
      queryOne: vi.fn(async () => null),
      query: vi.fn(async () => []),
    })),
    healthCheck: vi.fn(async () => true),
  })),
}));

vi.mock('@dashboard/core/db/timescale.js', () => ({
  getMetricsDb: vi.fn(() => ({
    query: vi.fn().mockResolvedValue({ rows: [] }),
  })),
  isMetricsDbHealthy: vi.fn().mockResolvedValue(true),
}));

vi.mock('@dashboard/core/services/audit-logger.js', () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock('@dashboard/core/services/typed-event-bus.js', () => ({
  eventBus: { emit: vi.fn(), on: vi.fn(() => vi.fn()), onAny: vi.fn(() => vi.fn()), emitAsync: vi.fn() },
}));

vi.mock('@dashboard/core/portainer/portainer-client.js', async (importOriginal) => await importOriginal());
vi.mock('@dashboard/core/portainer/portainer-cache.js', async (importOriginal) => await importOriginal());

// Suite-wide config baseline for any module that reads getConfig() at load.
beforeAll(() => {
  setConfigForTest({
    PORTAINER_API_URL: 'http://localhost:9000',
    OLLAMA_BASE_URL: 'http://localhost:11434',
    OLLAMA_MODEL: 'llama3.2',
    JWT_ALGORITHM: 'HS256',
    CACHE_ENABLED: false,
  });
});

// =====================================================================
//  REMEDIATION WEBSOCKET NAMESPACE ADMIN ROLE (issue #977, CWE-862)
// =====================================================================
describe('Remediation WebSocket namespace admin role enforcement', () => {
  it('socket-io plugin must apply admin role middleware to the /remediation namespace', () => {
    // Source-code guard: verify the socket-io plugin enforces admin role
    // on the remediation namespace via a dedicated middleware (.use()).
    const file = path.resolve(process.cwd(), '..', 'packages', 'core', 'src', 'plugins', 'socket-io.ts');
    const content = readFileSync(file, 'utf8');

    expect(content).toMatch(/remediationNamespace\.use\(/);
    expect(content).toMatch(/role.*!==.*['"]admin['"]/);
    expect(content).toContain('Admin role required');
  });

  it('remediation socket handler must have defence-in-depth admin role check', () => {
    const file = path.resolve(process.cwd(), '..', 'packages', 'operations', 'src', 'sockets', 'remediation.ts');
    const content = readFileSync(file, 'utf8');

    expect(content).toMatch(/role.*!==.*['"]admin['"]/);
    expect(content).toContain('Admin role required');
    expect(content).toContain('disconnect');
  });

  it('remediation namespace must NOT be in the shared auth-only middleware loop', () => {
    // Ensure the remediation namespace is handled separately from
    // llm/monitoring so it can have its own admin-role middleware.
    const file = path.resolve(process.cwd(), '..', 'packages', 'core', 'src', 'plugins', 'socket-io.ts');
    const content = readFileSync(file, 'utf8');

    const sharedLoopMatch = content.match(/for\s*\(.*\[.*\]\)\s*\{[\s\S]*?\}/);
    expect(sharedLoopMatch).not.toBeNull();

    const sharedLoopEnd = content.indexOf(sharedLoopMatch![0]) + sharedLoopMatch![0].length;
    const adminMiddlewareIdx = content.indexOf('remediationNamespace.use(');
    expect(adminMiddlewareIdx).toBeGreaterThan(sharedLoopEnd);
  });
});

// =====================================================================
//  WEBSOCKET CHAT THROTTLE (per-user rate limiting, issue #1102)
// =====================================================================
describe('WebSocket Chat Throttle', () => {
  it('llm-chat.ts must implement per-user throttle on chat:message handler', () => {
    const file = path.resolve(process.cwd(), '..', 'packages', 'ai-intelligence', 'src', 'sockets', 'llm-chat.ts');
    const content = readFileSync(file, 'utf8');

    // Must use the shared throttle utility from @dashboard/core
    expect(content).toContain('createSocketThrottle');
    expect(content).toContain("from '@dashboard/core/utils/socket-throttle.js'");

    // Must emit a throttle event when rate is exceeded
    expect(content).toContain('chat:throttled');

    // Must reference the configurable throttle window
    expect(content).toMatch(/CHAT_THROTTLE_MS/);

    // Must clean up throttle entries on disconnect to prevent memory leaks
    expect(content).toMatch(/chatThrottle\.clearByUserId/);
  });

  it('llm-chat.ts must export throttle handle for testability', () => {
    const file = path.resolve(process.cwd(), '..', 'packages', 'ai-intelligence', 'src', 'sockets', 'llm-chat.ts');
    const content = readFileSync(file, 'utf8');

    expect(content).toMatch(/export\s+\{[^}]*chatThrottle/);
    expect(content).toMatch(/export\s+\{[^}]*CHAT_THROTTLE_MS/);
  });
});

// =====================================================================
//  MONITORING + REMEDIATION SOCKET SECURITY (issues #1102, #1103)
// =====================================================================
//
// #1102 — monitoring + remediation Socket.IO namespaces had NO per-event
// rate limiting. Verified via runtime tests below using the same
// mock-socket pattern as `monitoring-socket.test.ts`.
//
// #1103 — `insights:history` accepted unbounded `limit` (DoS via huge
// numbers) and unvalidated `severity`. Now Zod-validated and clamped.
//
describe('Monitoring + Remediation Socket Security', () => {
  describe('source-code guards', () => {
    it('monitoring.ts uses the shared socket throttle utility', () => {
      const file = path.resolve(
        process.cwd(),
        '..',
        'packages',
        'ai-intelligence',
        'src',
        'sockets',
        'monitoring.ts',
      );
      const content = readFileSync(file, 'utf8');
      expect(content).toContain('createSocketThrottle');
      expect(content).toContain("from '@dashboard/core/utils/socket-throttle.js'");
      // Must throttle the read events called out in #1102
      expect(content).toMatch(/insights:history/);
      expect(content).toMatch(/investigations:history/);
      expect(content).toContain('insights:throttled');
      expect(content).toContain('investigations:throttled');
      // Must clean up on disconnect to prevent memory leaks
      expect(content).toMatch(/monitoringThrottle\.clearByUserId/);
    });

    it('remediation.ts uses the shared socket throttle utility', () => {
      const file = path.resolve(
        process.cwd(),
        '..',
        'packages',
        'operations',
        'src',
        'sockets',
        'remediation.ts',
      );
      const content = readFileSync(file, 'utf8');
      expect(content).toContain('createSocketThrottle');
      expect(content).toContain("from '@dashboard/core/utils/socket-throttle.js'");
      expect(content).toMatch(/actions:list/);
      expect(content).toContain('actions:throttled');
      expect(content).toMatch(/remediationThrottle\.clearByUserId/);
    });

    it('monitoring.ts validates insights:history payload with Zod (#1103)', () => {
      const file = path.resolve(
        process.cwd(),
        '..',
        'packages',
        'ai-intelligence',
        'src',
        'sockets',
        'monitoring.ts',
      );
      const content = readFileSync(file, 'utf8');
      // Must import Zod
      expect(content).toMatch(/from 'zod\/v4'/);
      // Must clamp limit to a sane range — the upper bound is the key
      // bit (#1103 was an unbounded limit DoS).
      expect(content).toMatch(/\.max\(500\)/);
      // Must validate severity against the enum (no free-form strings)
      expect(content).toMatch(/z\.enum\(SEVERITY_VALUES\)/);
    });

    it('monitoring.ts validates investigations:history limit too (#1103)', () => {
      const file = path.resolve(
        process.cwd(),
        '..',
        'packages',
        'ai-intelligence',
        'src',
        'sockets',
        'monitoring.ts',
      );
      const content = readFileSync(file, 'utf8');
      expect(content).toMatch(/investigationsHistorySchema/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Runtime behaviour — uses the same mock-socket pattern as the existing
  // monitoring-socket test in packages/ai-intelligence. The top-level
  // `getDbForDomain` mock returns `query: () => []` which is exactly what
  // we need to verify validation + throttle behaviour: a successful path
  // simply produces an empty result set.
  // ─────────────────────────────────────────────────────────────────────
  describe('runtime behaviour — insights:history (#1102, #1103)', () => {
    function makeMockSocket(userId: string) {
      const handlers = new Map<string, (...args: unknown[]) => unknown>();
      const emitted: Array<{ event: string; args: unknown[] }> = [];
      const socket = {
        id: `mock-${userId}`,
        data: { user: { sub: userId } },
        on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
          handlers.set(event, handler);
        }),
        emit: vi.fn((event: string, ...args: unknown[]) => {
          emitted.push({ event, args });
        }),
        join: vi.fn(),
        leave: vi.fn(),
        rooms: new Set<string>([`mock-${userId}`]),
      };
      // EventEmitter masquerades as a Socket.IO Namespace for handler tests.
      const ns = new EventEmitter() as any;
      ns.to = vi.fn(() => ({ emit: vi.fn() }));
      return { ns, socket, handlers, emitted };
    }

    let setupMonitoringNamespace: typeof import('@dashboard/ai').setupMonitoringNamespace;
    let monitoringThrottle: typeof import('@dashboard/ai').monitoringThrottle;

    beforeAll(async () => {
      const aiModule = await import('@dashboard/ai');
      setupMonitoringNamespace = aiModule.setupMonitoringNamespace;
      monitoringThrottle = aiModule.monitoringThrottle;
    });

    it('clamps limit to <= 500 (rejects DoS via huge limit) — #1103', async () => {
      const userId = 'user-clamp-1';
      monitoringThrottle.clearByUserId(userId);

      const { ns, socket, handlers, emitted } = makeMockSocket(userId);
      setupMonitoringNamespace(ns);
      ns.emit('connection', socket);

      const handler = handlers.get('insights:history')!;
      await handler({ limit: 999_999_999 });

      // Must emit the validation error (NOT 999M rows)
      const errors = emitted.filter((e) => e.event === 'insights:error');
      expect(errors).toHaveLength(1);
      expect((errors[0].args[0] as Record<string, unknown>).code).toBe('INVALID_PAYLOAD');
      // Must NOT have emitted a successful insights:history payload
      const ok = emitted.filter((e) => e.event === 'insights:history');
      expect(ok).toHaveLength(0);
    });

    it('rejects invalid severity enum value — #1103', async () => {
      const userId = 'user-sev-1';
      monitoringThrottle.clearByUserId(userId);

      const { ns, socket, handlers, emitted } = makeMockSocket(userId);
      setupMonitoringNamespace(ns);
      ns.emit('connection', socket);

      await handlers.get('insights:history')!({ severity: 'hax' });

      const errors = emitted.filter((e) => e.event === 'insights:error');
      expect(errors).toHaveLength(1);
      expect((errors[0].args[0] as Record<string, unknown>).code).toBe('INVALID_PAYLOAD');
    });

    it('accepts valid severity + reasonable limit — #1103', async () => {
      const userId = 'user-ok-1';
      monitoringThrottle.clearByUserId(userId);

      const { ns, socket, handlers, emitted } = makeMockSocket(userId);
      setupMonitoringNamespace(ns);
      ns.emit('connection', socket);

      await handlers.get('insights:history')!({ severity: 'critical', limit: 100 });

      // No validation error, and a successful response is emitted
      const errors = emitted.filter((e) => e.event === 'insights:error');
      expect(errors).toHaveLength(0);
      const ok = emitted.filter((e) => e.event === 'insights:history');
      expect(ok).toHaveLength(1);
    });

    it('rejects limit=-1 — #1103', async () => {
      const userId = 'user-neg-1';
      monitoringThrottle.clearByUserId(userId);

      const { ns, socket, handlers, emitted } = makeMockSocket(userId);
      setupMonitoringNamespace(ns);
      ns.emit('connection', socket);

      await handlers.get('insights:history')!({ limit: -1 });

      const errors = emitted.filter((e) => e.event === 'insights:error');
      expect(errors).toHaveLength(1);
      expect((errors[0].args[0] as Record<string, unknown>).code).toBe('INVALID_PAYLOAD');
    });

    it('throttles two rapid insights:history calls from the same user — #1102', async () => {
      const userId = 'user-throttle-1';
      monitoringThrottle.clearByUserId(userId);

      const { ns, socket, handlers, emitted } = makeMockSocket(userId);
      setupMonitoringNamespace(ns);
      ns.emit('connection', socket);

      const handler = handlers.get('insights:history')!;

      // First call passes (no throttle, valid payload)
      await handler({ limit: 10 });
      // Second call within 1s is throttled
      await handler({ limit: 10 });

      const throttled = emitted.filter((e) => e.event === 'insights:throttled');
      expect(throttled).toHaveLength(1);
      expect((throttled[0].args[0] as Record<string, unknown>).retryAfterMs).toBeGreaterThan(0);
      // Critically — it does NOT silently drop. A polite event was emitted.
    });

    it('throttle is per-user — different users have independent buckets — #1102', async () => {
      monitoringThrottle.clearByUserId('user-a');
      monitoringThrottle.clearByUserId('user-b');

      const a = makeMockSocket('user-a');
      const b = makeMockSocket('user-b');

      setupMonitoringNamespace(a.ns);
      a.ns.emit('connection', a.socket);

      setupMonitoringNamespace(b.ns);
      b.ns.emit('connection', b.socket);

      await a.handlers.get('insights:history')!({});
      await a.handlers.get('insights:history')!({});
      await b.handlers.get('insights:history')!({});

      // user-a should have one throttled emission, user-b should have none
      expect(a.emitted.filter((e) => e.event === 'insights:throttled')).toHaveLength(1);
      expect(b.emitted.filter((e) => e.event === 'insights:throttled')).toHaveLength(0);
    });
  });

  describe('runtime behaviour — actions:list (#1102)', () => {
    function makeAdminSocket(userId: string) {
      const handlers = new Map<string, (...args: unknown[]) => unknown>();
      const emitted: Array<{ event: string; args: unknown[] }> = [];
      const socket = {
        id: `mock-${userId}`,
        data: { user: { sub: userId, role: 'admin' } },
        on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
          handlers.set(event, handler);
        }),
        emit: vi.fn((event: string, ...args: unknown[]) => {
          emitted.push({ event, args });
        }),
        disconnect: vi.fn(),
      };
      const ns = new EventEmitter() as any;
      return { ns, socket, handlers, emitted };
    }

    let setupRemediationNamespace: typeof import('@dashboard/operations').setupRemediationNamespace;
    let remediationThrottle: typeof import('@dashboard/operations').remediationThrottle;

    beforeAll(async () => {
      const operationsModule = await import('@dashboard/operations');
      setupRemediationNamespace = operationsModule.setupRemediationNamespace;
      remediationThrottle = operationsModule.remediationThrottle;
    });

    it('throttles two rapid actions:list calls from the same user — #1102', async () => {
      const userId = 'admin-throttle-1';
      remediationThrottle.clearByUserId(userId);

      const { ns, socket, handlers, emitted } = makeAdminSocket(userId);
      setupRemediationNamespace(ns);
      ns.emit('connection', socket);

      const handler = handlers.get('actions:list')!;
      await handler({});
      await handler({});

      const throttled = emitted.filter((e) => e.event === 'actions:throttled');
      expect(throttled).toHaveLength(1);
      expect((throttled[0].args[0] as Record<string, unknown>).retryAfterMs).toBeGreaterThan(0);
    });
  });
});
