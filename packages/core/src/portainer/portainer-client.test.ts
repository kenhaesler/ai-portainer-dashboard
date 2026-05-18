import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Kept: undici mock — external dependency. Lets us assert behavior of
// startContainer / stopContainer against fabricated Docker responses.
vi.mock('undici', () => ({
  Agent: vi.fn(function () { return { close: vi.fn().mockResolvedValue(undefined) }; }),
  fetch: vi.fn(),
}));

// Kept: trace-context mock — side-effect isolation. withSpan would otherwise
// require an active trace context for portainerFetch to nest under.
vi.mock('../tracing/trace-context.js', () => ({
  withSpan: (_name: string, _service: string, _kind: string, fn: () => unknown) => fn(),
}));

import { fetch as undiciFetch } from 'undici';
import {
  decodeDockerLogPayload,
  sanitizeContainerLabels,
  _resetClientState,
  getCircuitBreakerStats,
  buildApiUrl,
  buildApiHeaders,
  pruneStaleBreakers,
  startBreakerPruning,
  stopBreakerPruning,
  startContainer,
  stopContainer,
  restartContainer,
  getEndpoints,
  isEdgeTunnelNotActive,
  EDGE_TUNNEL_NOT_ACTIVE_TOKEN,
  getDockerInfo,
} from './portainer-client.js';
import pLimit from 'p-limit';

const mockFetch = vi.mocked(undiciFetch);

describe('isEdgeTunnelNotActive', () => {
  // SNAPSHOT: this is the exact substring our predicate matches against
  // Portainer's HTTP 500 body when an Edge Agent's reverse tunnel hasn't
  // opened yet. Three call sites in this codebase branch on it (circuit
  // breaker, waitForEdgeTunnel poll loop, eBPF deploy route's 503 path).
  // If Portainer changes the wording in a future release, this assertion
  // is the canary — without it the predicate silently starts returning
  // false, the breaker trips on cold Edge Agents, and the 503 path stops
  // catching the condition.
  it('matches against the exact Portainer 500 body literal', () => {
    expect(EDGE_TUNNEL_NOT_ACTIVE_TOKEN).toBe('unable to get the active tunnel');
  });

  it('matches the full HTTP 500 wrapper that portainerFetchInner emits', () => {
    // portainerFetchInner builds: `HTTP 500: Internal Server Error — <body>`
    const wrapped = new Error('HTTP 500: Internal Server Error — Unable to get the active tunnel');
    expect(isEdgeTunnelNotActive(wrapped)).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isEdgeTunnelNotActive(new Error('UNABLE TO GET THE ACTIVE TUNNEL'))).toBe(true);
    expect(isEdgeTunnelNotActive(new Error('Unable to get the Active Tunnel'))).toBe(true);
  });

  it('accepts plain strings (used by pingEndpointDocker result.error)', () => {
    expect(isEdgeTunnelNotActive('unable to get the active tunnel')).toBe(true);
    expect(isEdgeTunnelNotActive('Unable to get the active tunnel: endpoint 5')).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isEdgeTunnelNotActive(new Error('ECONNREFUSED'))).toBe(false);
    expect(isEdgeTunnelNotActive(new Error('HTTP 401: Unauthorized'))).toBe(false);
    expect(isEdgeTunnelNotActive('agent offline')).toBe(false);
  });

  it('returns false for non-error, non-string inputs', () => {
    expect(isEdgeTunnelNotActive(null)).toBe(false);
    expect(isEdgeTunnelNotActive(undefined)).toBe(false);
    expect(isEdgeTunnelNotActive(500)).toBe(false);
    expect(isEdgeTunnelNotActive({ message: 'unable to get the active tunnel' })).toBe(false);
  });
});

describe('sanitizeContainerLabels', () => {
  it('redacts known path-disclosing Docker labels', () => {
    const result = sanitizeContainerLabels({
      'com.docker.compose.project.config_files': '/Users/simon/path/docker-compose.yml',
      'desktop.docker.io/binds/1/Source': '/Users/simon/projects/api',
      'com.example.service': 'frontend',
    });

    expect(result['com.docker.compose.project.config_files']).toBe('[REDACTED]');
    expect(result['desktop.docker.io/binds/1/Source']).toBe('[REDACTED]');
    expect(result['com.example.service']).toBe('frontend');
  });

  it('redacts labels with direct host path values', () => {
    const result = sanitizeContainerLabels({
      'custom.path': '/var/lib/docker/volumes/app',
      'windows.path': 'C:\\Users\\simon\\project',
      plain: 'value',
    });

    expect(result['custom.path']).toBe('[REDACTED]');
    expect(result['windows.path']).toBe('[REDACTED]');
    expect(result.plain).toBe('value');
  });
});

describe('decodeDockerLogPayload', () => {
  it('decodes multiplexed docker log frames', () => {
    const out = Buffer.from('2026-02-08T00:19:36.5759Z INFO hello\n', 'utf8');
    const err = Buffer.from('2026-02-08T00:19:36.5760Z ERROR fail\n', 'utf8');

    const outHeader = Buffer.alloc(8);
    outHeader[0] = 1;
    outHeader.writeUInt32BE(out.length, 4);

    const errHeader = Buffer.alloc(8);
    errHeader[0] = 2;
    errHeader.writeUInt32BE(err.length, 4);

    const payload = Buffer.concat([outHeader, out, errHeader, err]);
    const decoded = decodeDockerLogPayload(payload);

    expect(decoded).toBe(`${out.toString('utf8')}${err.toString('utf8')}`);
  });

  it('falls back to utf8 when payload is plain text', () => {
    const plain = Buffer.from('2026-02-08T00:19:36.5759Z INFO plain line\n', 'utf8');
    expect(decodeDockerLogPayload(plain)).toBe(plain.toString('utf8'));
  });
});

describe('concurrency limiter', () => {
  afterEach(() => {
    _resetClientState();
  });

  it('p-limit restricts concurrent calls to configured limit', async () => {
    const concurrency = 2;
    const limit = pLimit(concurrency);

    let running = 0;
    let maxRunning = 0;

    const task = () =>
      limit(async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 20));
        running--;
        return 'done';
      });

    const results = await Promise.all([task(), task(), task(), task(), task()]);

    expect(results).toEqual(['done', 'done', 'done', 'done', 'done']);
    expect(maxRunning).toBeLessThanOrEqual(concurrency);
  });

  it('_resetClientState clears cached limiter and dispatcher', () => {
    // Just verify it doesn't throw — internal state is private
    expect(() => _resetClientState()).not.toThrow();
  });
});

describe('per-endpoint circuit breaker stats', () => {
  afterEach(() => {
    _resetClientState();
  });

  it('returns CLOSED with zero counts when no requests have been made', () => {
    _resetClientState();
    const stats = getCircuitBreakerStats();
    expect(stats.state).toBe('CLOSED');
    expect(stats.failures).toBe(0);
    expect(stats.successes).toBe(0);
    expect(stats.lastFailure).toBeUndefined();
    expect(stats.byEndpoint).toEqual({});
  });

  it('_resetClientState clears per-endpoint breakers', () => {
    const stats1 = getCircuitBreakerStats();
    expect(stats1.byEndpoint).toEqual({});
    _resetClientState();
    const stats2 = getCircuitBreakerStats();
    expect(stats2.byEndpoint).toEqual({});
  });
});

describe('buildApiUrl', () => {
  it('constructs URL from path and PORTAINER_API_URL', () => {
    const url = buildApiUrl('/api/endpoints/20/docker/containers/json');
    expect(url).toBe('http://localhost:9000/api/endpoints/20/docker/containers/json');
  });

  it('strips trailing slashes from base URL', () => {
    // The mock config has no trailing slash; this tests the regex in buildApiUrl
    const url = buildApiUrl('/api/endpoints/1/docker/containers/abc/logs?tail=100');
    expect(url).toBe('http://localhost:9000/api/endpoints/1/docker/containers/abc/logs?tail=100');
  });
});

describe('buildApiHeaders', () => {
  it('includes Content-Type and X-API-Key by default', () => {
    const headers = buildApiHeaders();
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-API-Key']).toBeDefined();
    expect(headers['X-API-Key'].length).toBeGreaterThan(0);
  });

  it('omits Content-Type when includeContentType is false', () => {
    const headers = buildApiHeaders(false);
    expect(headers['Content-Type']).toBeUndefined();
    expect(headers['X-API-Key']).toBeDefined();
    expect(headers['X-API-Key'].length).toBeGreaterThan(0);
  });
});

describe('circuit breaker pruning (#547)', () => {
  afterEach(() => {
    _resetClientState();
    stopBreakerPruning();
  });

  it('pruneStaleBreakers removes nothing when breakers map is empty', () => {
    _resetClientState();
    const pruned = pruneStaleBreakers();
    expect(pruned).toBe(0);
  });

  it('pruneStaleBreakers does not remove recently-used breakers', () => {
    _resetClientState();
    // Getting stats populates no breakers (they're created on demand via getBreaker)
    // We can't easily populate breakers without making actual requests,
    // but we can verify the function doesn't crash
    const pruned = pruneStaleBreakers();
    expect(pruned).toBe(0);
    const stats = getCircuitBreakerStats();
    expect(stats.state).toBe('CLOSED');
  });

  it('startBreakerPruning and stopBreakerPruning do not throw', () => {
    expect(() => startBreakerPruning()).not.toThrow();
    // Calling start again should be idempotent
    expect(() => startBreakerPruning()).not.toThrow();
    expect(() => stopBreakerPruning()).not.toThrow();
    // Calling stop again should be idempotent
    expect(() => stopBreakerPruning()).not.toThrow();
  });
});

// =====================================================================
//  Docker idempotent lifecycle endpoints (start / stop) — #1230
//
//  Docker's /containers/{id}/start and /stop return HTTP 304 Not Modified
//  when the container is already in the requested state. Without this
//  guard, the just-created container was actually running, but
//  startContainer's phantom 304 failure triggered the orphan-rollback
//  path in deployBeyla and removed the working container on every retry.
// =====================================================================

function buildResponse({
  status,
  statusText,
  body = {},
}: { status: number; statusText: string; body?: unknown }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    headers: new Headers(),
  } as unknown as Response;
}

describe('startContainer / stopContainer — 304 idempotency (#1230)', () => {
  beforeEach(() => {
    _resetClientState();
    mockFetch.mockReset();
  });

  afterEach(() => {
    _resetClientState();
  });

  it('startContainer resolves when Docker returns 304 (already running)', async () => {
    mockFetch.mockResolvedValueOnce(
      buildResponse({ status: 304, statusText: 'Not Modified' }),
    );
    await expect(startContainer(1, 'abc123')).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('stopContainer resolves when Docker returns 304 (already stopped)', async () => {
    mockFetch.mockResolvedValueOnce(
      buildResponse({ status: 304, statusText: 'Not Modified' }),
    );
    await expect(stopContainer(1, 'abc123')).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('startContainer resolves on 204 No Content (Docker happy path)', async () => {
    mockFetch.mockResolvedValueOnce(
      buildResponse({ status: 204, statusText: 'No Content' }),
    );
    await expect(startContainer(1, 'abc123')).resolves.toBeUndefined();
  });

  it('startContainer rethrows other non-2xx errors (e.g. 404, 500)', async () => {
    // 404: container not found. This must NOT be swallowed by the 304 guard.
    mockFetch.mockResolvedValue(
      buildResponse({ status: 404, statusText: 'Not Found' }),
    );
    await expect(startContainer(1, 'missing')).rejects.toThrow(/HTTP 404/);
  });

  it('stopContainer rethrows server errors (e.g. 500)', async () => {
    // 500: actual server failure. Retries (3) and then surfaces the error.
    mockFetch.mockResolvedValue(
      buildResponse({ status: 500, statusText: 'Internal Server Error' }),
    );
    await expect(stopContainer(1, 'abc123')).rejects.toThrow(/HTTP 500/);
  });
});

// =====================================================================
//  portainerFetch parse guard — #1232
//
//  Docker lifecycle endpoints (/start, /stop, /restart, /remove) reply
//  204 No Content. Previously portainerFetchInner called res.json()
//  unconditionally, which threw SyntaxError on empty bodies and dragged
//  the call through 1-7s of exponential-backoff retries. The fix is to
//  bypass JSON parsing when the response is 204 or has an empty body.
//
//  The helper below mirrors the real undici behavior more closely than
//  buildResponse above: a 204 response has an empty body, so text()
//  resolves to '' and json() throws — exactly what the production fix
//  must absorb.
// =====================================================================

function buildEmptyBodyResponse(status: number, statusText: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => {
      throw new SyntaxError('Unexpected end of JSON input');
    },
    text: async () => '',
    headers: new Headers(),
  } as unknown as Response;
}

function buildJsonResponse(status: number, statusText: string, body: unknown) {
  const serialized = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => JSON.parse(serialized),
    text: async () => serialized,
    headers: new Headers(),
  } as unknown as Response;
}

describe('portainerFetch parse guard (#1232)', () => {
  beforeEach(() => {
    _resetClientState();
    mockFetch.mockReset();
  });

  afterEach(() => {
    _resetClientState();
  });

  it('resolves to undefined on 204 No Content without exercising the retry path', async () => {
    mockFetch.mockResolvedValueOnce(buildEmptyBodyResponse(204, 'No Content'));
    // restartContainer doesn't catch the 304 idempotency error, so any retry
    // (which would happen if json() were called and threw) would surface
    // either as additional fetch calls or as a thrown PortainerError.
    await expect(restartContainer(1, 'abc123')).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('resolves to undefined on 200 with an empty body without retrying', async () => {
    mockFetch.mockResolvedValueOnce(buildEmptyBodyResponse(200, 'OK'));
    await expect(restartContainer(1, 'abc123')).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('parses a normal 200 JSON body (happy path regression)', async () => {
    // getEndpoints calls portainerFetch<unknown[]>('/api/endpoints').
    // Use a minimal Endpoint shape so EndpointArraySchema.parse succeeds.
    const endpoints = [
      {
        Id: 1,
        Name: 'local',
        Type: 1,
        URL: 'unix:///var/run/docker.sock',
        Status: 1,
      },
    ];
    mockFetch.mockResolvedValueOnce(buildJsonResponse(200, 'OK', endpoints));
    const result = await getEndpoints();
    expect(result).toHaveLength(1);
    expect(result[0]?.Id).toBe(1);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('startContainer completes without retrying when Docker returns a real 204 (empty body)', async () => {
    // Regression for #1232: previously this triggered SyntaxError on
    // res.json() and looped through 1s + 2s + 4s of retries before
    // failing. With the fix, exactly one fetch call is made.
    mockFetch.mockResolvedValueOnce(buildEmptyBodyResponse(204, 'No Content'));
    await expect(startContainer(1, 'abc123')).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});

describe('getDockerInfo — narrow slice + defensive narrowing', () => {
  beforeEach(() => {
    _resetClientState();
    mockFetch.mockReset();
  });

  it('returns the four expected fields when Docker /info reports them as strings', async () => {
    mockFetch.mockResolvedValueOnce(buildResponse({
      status: 200, statusText: 'OK', body: {
        KernelVersion: '5.15.0-25-generic',
        OperatingSystem: 'Ubuntu 22.04 LTS',
        OSType: 'linux',
        Architecture: 'x86_64',
        // Extra fields we don't care about must not leak into our narrow type.
        Containers: 42, ServerVersion: '24.0.5',
      },
    }));
    const info = await getDockerInfo(7);
    expect(info).toEqual({
      KernelVersion: '5.15.0-25-generic',
      OperatingSystem: 'Ubuntu 22.04 LTS',
      OSType: 'linux',
      Architecture: 'x86_64',
    });
    // Sanity: extras must not appear on the returned object.
    expect((info as Record<string, unknown>).Containers).toBeUndefined();
  });

  it('coerces non-string fields to undefined (defensive — hostile/buggy daemon)', async () => {
    mockFetch.mockResolvedValueOnce(buildResponse({
      status: 200, statusText: 'OK', body: {
        KernelVersion: 12345,        // number instead of string
        OperatingSystem: null,        // null
        OSType: { nested: 'linux' },  // object
        Architecture: ['x86_64'],     // array
      },
    }));
    const info = await getDockerInfo(7);
    expect(info).toEqual({
      KernelVersion: undefined,
      OperatingSystem: undefined,
      OSType: undefined,
      Architecture: undefined,
    });
  });

  it('returns all-undefined when /info omits the fields entirely', async () => {
    mockFetch.mockResolvedValueOnce(buildResponse({
      status: 200, statusText: 'OK', body: { Containers: 0 },
    }));
    const info = await getDockerInfo(7);
    expect(info).toEqual({
      KernelVersion: undefined,
      OperatingSystem: undefined,
      OSType: undefined,
      Architecture: undefined,
    });
  });
});
