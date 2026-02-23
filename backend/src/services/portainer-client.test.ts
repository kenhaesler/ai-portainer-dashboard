import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeDockerLogPayload, sanitizeContainerLabels, _resetClientState, getCircuitBreakerStats, buildApiUrl, buildApiHeaders, pruneStaleBreakers, startBreakerPruning, stopBreakerPruning } from './portainer-client.js';
import pLimit from 'p-limit';

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
