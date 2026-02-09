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
      // DHI images (dhi.io/nginx) run as non-root by default (UID 65532),
      // so an explicit USER directive is not required when using them.
      const hasUserDirective = /^USER\s+\S+/m.test(content);
      const usesDhiNginx = /dhi\.io\/nginx/m.test(content);
      expect(hasUserDirective || usesDhiNginx).toBe(true);
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

    it('drops privileges via entrypoint (su-exec to node user)', () => {
      expect(content).toMatch(/su-exec/);
      expect(content).toMatch(/docker-entrypoint\.sh/);
    });

    it('has a healthcheck', () => {
      expect(content).toMatch(/^HEALTHCHECK\s/m);
    });

    it('uses dumb-init for PID 1', () => {
      expect(content).toMatch(/dumb-init/);
    });
  });

  describe('backend/docker-entrypoint.sh', () => {
    const content = readFile('backend/docker-entrypoint.sh');

    it('fixes data directory ownership', () => {
      expect(content).toMatch(/chown.*node.*\/app\/data/);
    });

    it('drops to non-root user via su-exec', () => {
      expect(content).toMatch(/exec su-exec node/);
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

describe('Docker Hardened Images (DHI) consistency', () => {
  const backendProd = readFile('backend/Dockerfile');
  const backendDev = readFile('backend/Dockerfile.dev');
  const frontendProd = readFile('frontend/Dockerfile');
  const frontendDev = readFile('frontend/Dockerfile.dev');

  it('backend production uses DHI node image', () => {
    expect(backendProd).toMatch(/FROM\s+dhi\.io\/node:/m);
  });

  it('backend dev uses DHI node image', () => {
    expect(backendDev).toMatch(/FROM\s+dhi\.io\/node:/m);
  });

  it('frontend production uses DHI images', () => {
    expect(frontendProd).toMatch(/FROM\s+dhi\.io\/node:/m);
    expect(frontendProd).toMatch(/FROM\s+dhi\.io\/nginx:/m);
  });

  it('frontend dev uses DHI node image', () => {
    expect(frontendDev).toMatch(/FROM\s+dhi\.io\/node:/m);
  });

  it('dev and production use same DHI node base image', () => {
    const extractNodeTag = (content: string) => {
      const match = content.match(/FROM\s+dhi\.io\/node:(\S+)/);
      return match?.[1];
    };
    const backendProdTag = extractNodeTag(backendProd);
    const backendDevTag = extractNodeTag(backendDev);
    const frontendProdTag = extractNodeTag(frontendProd);
    const frontendDevTag = extractNodeTag(frontendDev);

    expect(backendProdTag).toBe(backendDevTag);
    expect(frontendProdTag).toBe(frontendDevTag);
    expect(backendProdTag).toBe(frontendProdTag);
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
