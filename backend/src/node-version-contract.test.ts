import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const NODE_ENGINE = '^22.22.2 || ^24.15.0 || >=26.0.0';

function read(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), 'utf8');
}

describe('Node version contract', () => {
  it('declares the dependency-compatible engine intersection', () => {
    const manifest = JSON.parse(read('package.json')) as { engines?: { node?: string } };

    expect(manifest.engines?.node).toBe(NODE_ENGINE);
  });

  it('keeps operator and contributor documentation aligned with the manifest', () => {
    expect(read('README.md')).toContain('Node.js 22.22.2+ (22.x), 24.15.0+ (24.x), or 26+');
    expect(read('docker/.env.example')).toContain(
      'Local Node requirement: 22.22.2+ (22.x), 24.15.0+ (24.x), or 26+',
    );
    expect(read('CLAUDE.md')).toContain(`supported local Node ranges are \`${NODE_ENGINE}\``);
    expect(read('docs/architecture.md')).toContain(
      `local development engine range is \`${NODE_ENGINE}\``,
    );
  });
});
