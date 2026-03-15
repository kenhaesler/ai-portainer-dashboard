import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/core/src/config/ → repo root → docker/
const dockerDir = path.resolve(__dirname, '..', '..', '..', '..', 'docker');

describe('prometheus docker exposure guard', () => {
  it('does not publish Prometheus default host port 9090 in compose files', () => {
    const devCompose = fs.readFileSync(path.join(dockerDir, 'docker-compose.dev.yml'), 'utf8');
    const prodCompose = fs.readFileSync(path.join(dockerDir, 'docker-compose.yml'), 'utf8');
    const combined = `${devCompose}\n${prodCompose}`.toLowerCase();

    expect(combined).not.toContain('9090:9090');
    expect(combined).not.toContain('prometheus:9090');
  });

  it('does not expose Prometheus port 9090 on 0.0.0.0 in monitoring overlay', () => {
    const monitoringCompose = fs.readFileSync(
      path.join(dockerDir, 'docker-compose.monitoring.yml'),
      'utf8',
    );
    const lower = monitoringCompose.toLowerCase();

    // Must not bind Prometheus to all interfaces
    expect(lower).not.toContain('0.0.0.0:9090');
    // Must not publish bare 9090:9090 (implies all interfaces)
    expect(lower).not.toContain('9090:9090');
  });

  it('binds Grafana to 127.0.0.1 only in monitoring overlay', () => {
    const monitoringCompose = fs.readFileSync(
      path.join(dockerDir, 'docker-compose.monitoring.yml'),
      'utf8',
    );

    // Grafana port line must bind to localhost
    const portLines = monitoringCompose
      .split('\n')
      .filter((line) => line.includes('3000'));
    expect(portLines.length).toBeGreaterThan(0);
    for (const line of portLines) {
      if (line.includes(':3000')) {
        expect(line).toContain('127.0.0.1');
      }
    }
  });
});
