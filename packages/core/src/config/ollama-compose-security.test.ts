import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('ollama docker exposure guard', () => {
  it('does not publish Ollama default host port in compose files', () => {
    const devCompose = fs.readFileSync(path.resolve(process.cwd(), '../..', 'docker', 'docker-compose.dev.yml'), 'utf8');
    const prodCompose = fs.readFileSync(path.resolve(process.cwd(), '../..', 'docker', 'docker-compose.yml'), 'utf8');
    const combined = `${devCompose}\n${prodCompose}`.toLowerCase();

    expect(combined).not.toContain('11534:11434');
    expect(combined).not.toContain('11434:11434');
    expect(combined).not.toContain('service: ollama');
  });
});
