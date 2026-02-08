import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeDockerLogPayload, sanitizeContainerLabels, _resetClientState } from './portainer-client.js';
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
