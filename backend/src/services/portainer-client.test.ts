import { describe, expect, it } from 'vitest';
import { sanitizeContainerLabels } from './portainer-client.js';

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
