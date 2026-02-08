import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');

function readFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), 'utf-8');
}

function readLines(relativePath: string): string[] {
  return readFile(relativePath)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

describe('Dockerfile security best practices', () => {
  describe('backend/Dockerfile (production)', () => {
    const content = readFile('backend/Dockerfile');

    it('uses multi-stage build', () => {
      const fromStatements = content.match(/^FROM\s/gm);
      expect(fromStatements?.length).toBeGreaterThanOrEqual(2);
    });

    it('runs as non-root user', () => {
      expect(content).toMatch(/^USER\s+\S+/m);
    });

    it('has a healthcheck', () => {
      expect(content).toMatch(/^HEALTHCHECK\s/m);
    });

    it('uses npm ci for reproducible builds', () => {
      expect(content).toMatch(/npm ci/);
    });

    it('sets NODE_ENV=production', () => {
      expect(content).toMatch(/NODE_ENV=production/);
    });

    it('uses dumb-init for PID 1', () => {
      expect(content).toMatch(/dumb-init/);
    });
  });

  describe('frontend/Dockerfile (production)', () => {
    const content = readFile('frontend/Dockerfile');

    it('uses multi-stage build', () => {
      const fromStatements = content.match(/^FROM\s/gm);
      expect(fromStatements?.length).toBeGreaterThanOrEqual(2);
    });

    it('runs as non-root user', () => {
      expect(content).toMatch(/^USER\s+\S+/m);
    });

    it('has a healthcheck', () => {
      expect(content).toMatch(/^HEALTHCHECK\s/m);
    });

    it('uses npm ci for reproducible builds', () => {
      expect(content).toMatch(/npm ci/);
    });
  });

  describe('backend/Dockerfile.dev', () => {
    const content = readFile('backend/Dockerfile.dev');

    it('runs as non-root user', () => {
      expect(content).toMatch(/^USER\s+\S+/m);
    });

    it('has a healthcheck', () => {
      expect(content).toMatch(/^HEALTHCHECK\s/m);
    });

    it('uses dumb-init for PID 1', () => {
      expect(content).toMatch(/dumb-init/);
    });
  });

  describe('frontend/Dockerfile.dev', () => {
    const content = readFile('frontend/Dockerfile.dev');

    it('runs as non-root user', () => {
      expect(content).toMatch(/^USER\s+\S+/m);
    });

    it('has a healthcheck', () => {
      expect(content).toMatch(/^HEALTHCHECK\s/m);
    });
  });
});

describe('.dockerignore security', () => {
  const requiredEntries = [
    'node_modules',
    '.env',
    '.env.*',
    '.git',
  ];

  describe('backend/.dockerignore', () => {
    const entries = readLines('backend/.dockerignore');

    for (const entry of requiredEntries) {
      it(`excludes ${entry}`, () => {
        expect(entries).toContain(entry);
      });
    }

    it('excludes data directory', () => {
      expect(entries.some((e) => e === 'data/' || e === 'data')).toBe(true);
    });
  });

  describe('frontend/.dockerignore', () => {
    const entries = readLines('frontend/.dockerignore');

    for (const entry of requiredEntries) {
      it(`excludes ${entry}`, () => {
        expect(entries).toContain(entry);
      });
    }
  });
});
