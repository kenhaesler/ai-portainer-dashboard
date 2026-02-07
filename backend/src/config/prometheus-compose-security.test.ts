import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('prometheus docker exposure guard', () => {
  it('does not publish Prometheus default host port 9090 in compose files', () => {
    const devCompose = fs.readFileSync(path.resolve(process.cwd(), '..', 'docker-compose.dev.yml'), 'utf8');
    const prodCompose = fs.readFileSync(path.resolve(process.cwd(), '..', 'docker-compose.yml'), 'utf8');
    const combined = `${devCompose}\n${prodCompose}`.toLowerCase();

    expect(combined).not.toContain('9090:9090');
    expect(combined).not.toContain('prometheus:9090');
  });
});
