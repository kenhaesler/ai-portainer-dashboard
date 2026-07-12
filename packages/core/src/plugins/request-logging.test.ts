import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import requestLogging from './request-logging.js';
import { resetConfig, setConfigForTest } from '../config/index.js';

/**
 * Tests for the access-log replacement (#1552).
 *
 * The production server is built with `disableRequestLogging: true` and this
 * plugin, so the test app mirrors that exact combination: excluded paths
 * (health probes, Socket.IO, assets) must produce ZERO log lines, normal
 * routes exactly one, and LOG_HTTP_SUCCESS=false demotes 2xx/3xx to debug
 * while 4xx/5xx keep warn/error.
 */

interface LogLine {
  level: number;
  msg: string;
  method?: string;
  url?: string;
  statusCode?: number;
  durationMs?: number;
}

function buildApp(level: 'debug' | 'info' = 'debug') {
  const lines: LogLine[] = [];
  const stream = {
    write(line: string) {
      lines.push(JSON.parse(line) as LogLine);
    },
  };
  // Mirrors the production factory options (packages/server/src/app.ts):
  // logger on, built-in request logging off.
  const app = Fastify({
    logger: { level, stream },
    disableRequestLogging: true,
  });
  return { app, lines };
}

describe('request-logging plugin (#1552)', () => {
  let app: FastifyInstance;
  let lines: LogLine[];

  async function setup(level: 'debug' | 'info' = 'debug') {
    ({ app, lines } = buildApp(level));
    await app.register(requestLogging);
    app.get('/health', async () => ({ status: 'ok' }));
    app.get('/health/ready', async () => ({ status: 'ok' }));
    app.get('/api/health', async () => ({ status: 'ok' }));
    app.get('/socket.io/poll', async () => ({ ok: true }));
    app.get('/api/containers', async () => ({ ok: true }));
    app.get('/api/broken', async (_req, reply) => {
      return reply.status(500).send({ error: 'internal' });
    });
    await app.ready();
  }

  afterEach(async () => {
    resetConfig();
    await app.close();
  });

  const accessLogs = () => lines.filter((l) => l.msg === 'request completed');

  it('emits no log lines for the /health liveness probe', async () => {
    await setup();
    await app.inject({ method: 'GET', url: '/health' });
    await app.inject({ method: 'GET', url: '/health/ready' });
    expect(lines).toHaveLength(0);
  });

  it('emits no log lines for /api/health, Socket.IO, assets, and favicon paths', async () => {
    await setup();
    await app.inject({ method: 'GET', url: '/api/health' });
    await app.inject({ method: 'GET', url: '/socket.io/poll' });
    await app.inject({ method: 'GET', url: '/assets/app.js' });
    await app.inject({ method: 'GET', url: '/favicon.ico' });
    expect(accessLogs()).toHaveLength(0);
  });

  it('logs exactly one info line for a successful API request', async () => {
    await setup();
    await app.inject({ method: 'GET', url: '/api/containers' });

    const logs = accessLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe(30); // info
    expect(logs[0].method).toBe('GET');
    expect(logs[0].url).toBe('/api/containers');
    expect(logs[0].statusCode).toBe(200);
    expect(logs[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('demotes successful requests to debug when LOG_HTTP_SUCCESS=false', async () => {
    await setup();
    setConfigForTest({ LOG_HTTP_SUCCESS: false });

    await app.inject({ method: 'GET', url: '/api/containers' });

    const logs = accessLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe(20); // debug
  });

  it('suppresses success lines entirely at info level when LOG_HTTP_SUCCESS=false', async () => {
    await setup('info');
    setConfigForTest({ LOG_HTTP_SUCCESS: false });

    await app.inject({ method: 'GET', url: '/api/containers' });

    expect(accessLogs()).toHaveLength(0);
  });

  it('logs 4xx responses at warn even when LOG_HTTP_SUCCESS=false', async () => {
    await setup();
    setConfigForTest({ LOG_HTTP_SUCCESS: false });

    await app.inject({ method: 'GET', url: '/api/nonexistent' });

    const logs = accessLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe(40); // warn
    expect(logs[0].statusCode).toBe(404);
  });

  it('logs 5xx responses at error even when LOG_HTTP_SUCCESS=false', async () => {
    await setup();
    setConfigForTest({ LOG_HTTP_SUCCESS: false });

    await app.inject({ method: 'GET', url: '/api/broken' });

    const logs = accessLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe(50); // error
    expect(logs[0].statusCode).toBe(500);
  });

  it('logs the route pattern, not the raw URL with query string', async () => {
    await setup();
    await app.inject({ method: 'GET', url: '/api/containers?ticket=secret-value' });

    const logs = accessLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].url).toBe('/api/containers');
  });
});
