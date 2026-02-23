import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { getTestDb, truncateTestTables, closeTestDb } from '../core/db/test-db-helper.js';
import type { AppDb } from '../core/db/app-db.js';

let testDb: AppDb;

// Kept: app-db-router mock — redirects to test PostgreSQL instance
vi.mock('../db/app-db-router.js', () => ({
  getDbForDomain: () => testDb,
}));

import { parseImageRef, getStalenessSummary, upsertStalenessRecord } from './image-staleness.js';

beforeAll(async () => { testDb = await getTestDb(); });
afterAll(async () => { await closeTestDb(); });
beforeEach(async () => {
  await truncateTestTables('image_staleness');
});

describe('image-staleness', () => {
  describe('parseImageRef', () => {
    it('parses simple image name', () => {
      const result = parseImageRef('nginx:latest');
      expect(result).toEqual({ registry: 'docker.io', name: 'library/nginx', tag: 'latest' });
    });

    it('parses image with no tag', () => {
      const result = parseImageRef('redis');
      expect(result).toEqual({ registry: 'docker.io', name: 'library/redis', tag: 'latest' });
    });

    it('parses namespaced image', () => {
      const result = parseImageRef('portainer/portainer-ce:2.19.0');
      expect(result).toEqual({ registry: 'docker.io', name: 'portainer/portainer-ce', tag: '2.19.0' });
    });

    it('parses custom registry image', () => {
      const result = parseImageRef('ghcr.io/myorg/myapp:v1.0');
      expect(result).toEqual({ registry: 'ghcr.io', name: 'myorg/myapp', tag: 'v1.0' });
    });

    it('parses image with no tag defaults to latest', () => {
      const result = parseImageRef('ubuntu');
      expect(result.tag).toBe('latest');
    });
  });

  describe('getStalenessSummary', () => {
    it('returns zero counts when no data exists', async () => {
      const summary = await getStalenessSummary();
      expect(summary).toEqual({ total: 0, stale: 0, upToDate: 0, unchecked: 0 });
    });

    it('returns correct counts from database', async () => {
      await upsertStalenessRecord({
        imageName: 'nginx', tag: 'latest', registry: 'docker.io',
        isStale: true, daysSinceUpdate: 30,
        localDigest: 'sha256:old', remoteDigest: 'sha256:new',
      });
      await upsertStalenessRecord({
        imageName: 'redis', tag: 'latest', registry: 'docker.io',
        isStale: false, daysSinceUpdate: 5,
        localDigest: 'sha256:same', remoteDigest: 'sha256:same',
      });
      await upsertStalenessRecord({
        imageName: 'postgres', tag: '16', registry: 'docker.io',
        isStale: false, daysSinceUpdate: null,
        localDigest: 'sha256:local', remoteDigest: null,
      });

      const summary = await getStalenessSummary();
      expect(summary.total).toBe(3);
      expect(summary.stale).toBe(1);
      expect(summary.upToDate).toBe(1);
      expect(summary.unchecked).toBe(1);
    });
  });
});
