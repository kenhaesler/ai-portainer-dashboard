import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/sqlite.js', () => {
  const mockDb = {
    prepare: vi.fn().mockReturnValue({
      run: vi.fn(),
      get: vi.fn().mockReturnValue({ total: 3, stale: 1, up_to_date: 1, unchecked: 1 }),
      all: vi.fn().mockReturnValue([]),
    }),
  };
  return { getDb: vi.fn(() => mockDb) };
});

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { parseImageRef, getStalenessSummary } from './image-staleness.js';

describe('image-staleness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
    it('returns summary from database', () => {
      const summary = getStalenessSummary();
      expect(summary).toEqual({
        total: 3,
        stale: 1,
        upToDate: 1,
        unchecked: 1,
      });
    });
  });
});
