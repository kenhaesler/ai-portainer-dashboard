import { describe, expect, it } from 'vitest';
import { decodeDockerLogPayload, sanitizeContainerLabels } from './portainer-client.js';

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
