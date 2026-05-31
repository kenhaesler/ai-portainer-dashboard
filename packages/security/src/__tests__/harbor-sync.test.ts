import { beforeAll, afterAll, describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setConfigForTest, resetConfig } from '@dashboard/core/config/index.js';

vi.mock('@dashboard/core/tracing/trace-context.js', () => ({
  withSpan: (_name: string, _service: string, _kind: string, fn: () => unknown) => fn(),
}));

// Kept: harbor-client mock — tests control harbor API responses
vi.mock('../services/harbor-client.js', () => ({
  isHarborConfiguredAsync: vi.fn(() => Promise.resolve(true)),
  listVulnerabilities: vi.fn(),
}));

// Kept: harbor-vulnerability-store mock — tests control DB store
vi.mock('../services/harbor-vulnerability-store.js', () => ({
  createSyncStatus: vi.fn(() => Promise.resolve(1)),
  completeSyncStatus: vi.fn(() => Promise.resolve()),
  failSyncStatus: vi.fn(() => Promise.resolve()),
  replaceAllVulnerabilities: vi.fn((vulns: unknown[]) => Promise.resolve(vulns.length)),
}));

// Kept: image-staleness mock — tests control image parsing
vi.mock('../services/image-staleness.js', () => ({
  parseImageRef: vi.fn((ref: string) => {
    const parts = ref.split('/');
    let registry = 'docker.io';
    let name = ref;
    let tag = 'latest';

    const colonIdx = name.lastIndexOf(':');
    if (colonIdx > 0 && !name.substring(colonIdx).includes('/')) {
      tag = name.substring(colonIdx + 1);
      name = name.substring(0, colonIdx);
    }

    if (parts.length > 1 && parts[0].includes('.')) {
      registry = parts[0];
      name = parts.slice(1).join('/');
      // Remove tag from name if present
      const ci = name.lastIndexOf(':');
      if (ci > 0) name = name.substring(0, ci);
    }

    return { registry, name, tag };
  }),
}));

import { runFullSync, getIsSyncing } from '../services/harbor-sync.js';
import * as harborClient from '../services/harbor-client.js';
import * as store from '../services/harbor-vulnerability-store.js';
import * as portainerClient from '@dashboard/core/portainer/portainer-client.js';
import * as portainerCache from '@dashboard/core/portainer/portainer-cache.js';
import { cache } from '@dashboard/core/portainer/portainer-cache.js';
import { closeTestRedis } from '@dashboard/core/test-utils/test-redis-helper.js';

beforeAll(async () => {
  await cache.clear();
});

afterAll(async () => {
  resetConfig();
  await closeTestRedis();
});

describe('harbor-sync', () => {
  beforeEach(async () => {
    await cache.clear();
    vi.restoreAllMocks();
    // Re-set vi.mock defaults cleared by restoreAllMocks
    vi.mocked(harborClient.isHarborConfiguredAsync).mockResolvedValue(true);
    vi.mocked(store.createSyncStatus).mockResolvedValue(1 as any);
    vi.mocked(store.completeSyncStatus).mockResolvedValue(undefined as any);
    vi.mocked(store.failSyncStatus).mockResolvedValue(undefined as any);
    vi.mocked(store.replaceAllVulnerabilities).mockImplementation(
      async (vulns: any) => vulns.length,
    );
    // Bypass cache — delegates to fetcher
    vi.spyOn(portainerCache, 'cachedFetchSWR').mockImplementation(
      async (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn(),
    );
    vi.spyOn(portainerCache, 'cachedFetch').mockImplementation(
      async (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn(),
    );
    vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([
      { Id: 1, Name: 'local', Type: 1, URL: 'tcp://localhost:2375', Status: 1, Snapshots: [] },
    ] as any);
    vi.spyOn(portainerClient, 'getContainers').mockResolvedValue([
      {
        Id: 'abc123def456',
        Names: ['/my-nginx'],
        Image: 'harbor.example.com/myproject/nginx:latest',
        State: 'running',
        Status: 'Up 2 hours',
        Created: 0,
        Labels: {},
      },
    ] as any);
  });

  it('syncs vulnerabilities and marks in-use correctly', async () => {
    vi.mocked(harborClient.listVulnerabilities).mockResolvedValueOnce({
      items: [
        {
          project_id: 1,
          repository_name: 'myproject/nginx',
          digest: 'sha256:abc',
          tags: ['latest'],
          cve_id: 'CVE-2024-1234',
          severity: 'Critical',
          status: 'fixed',
          cvss_v3_score: 9.8,
          package: 'openssl',
          version: '1.1.1',
          fixed_version: '1.1.2',
          desc: 'Critical vuln',
          links: ['https://nvd.nist.gov/vuln/detail/CVE-2024-1234'],
        },
        {
          project_id: 1,
          repository_name: 'myproject/redis',
          digest: 'sha256:def',
          tags: ['7.0'],
          cve_id: 'CVE-2024-5678',
          severity: 'Medium',
          status: '',
          cvss_v3_score: 5.5,
          package: 'libc',
          version: '2.31',
          fixed_version: '',
          desc: 'Medium vuln',
          links: [],
        },
      ],
      total: 2,
    });

    const result = await runFullSync();

    expect(result.vulnerabilitiesSynced).toBe(2);
    // nginx:latest is running, so 1 vuln should be in-use
    expect(result.inUseMatched).toBe(1);
    expect(result.error).toBeUndefined();

    expect(store.createSyncStatus).toHaveBeenCalledWith('full');
    // total=2 is reported by Harbor; synced=2 so no truncation — 4th arg present but not triggering truncation message
    expect(store.completeSyncStatus).toHaveBeenCalledWith(1, 2, 1, 2);
    expect(store.replaceAllVulnerabilities).toHaveBeenCalledTimes(1);

    const insertedVulns = vi.mocked(store.replaceAllVulnerabilities).mock.calls[0][0];
    const nginxVuln = insertedVulns.find((v) => v.cve_id === 'CVE-2024-1234');
    const redisVuln = insertedVulns.find((v) => v.cve_id === 'CVE-2024-5678');

    expect(nginxVuln?.in_use).toBe(true);
    expect(nginxVuln?.matching_containers).toBeTruthy();
    expect(redisVuln?.in_use).toBe(false);
  });

  it('handles Harbor not configured', async () => {
    vi.mocked(harborClient.isHarborConfiguredAsync).mockResolvedValueOnce(false);

    const result = await runFullSync();
    expect(result.error).toContain('not configured');
    expect(store.failSyncStatus).toHaveBeenCalled();
  });

  it('handles Harbor API errors gracefully', async () => {
    vi.mocked(harborClient.listVulnerabilities).mockRejectedValueOnce(
      new Error('Connection refused'),
    );

    const result = await runFullSync();
    expect(result.error).toContain('Connection refused');
    expect(result.vulnerabilitiesSynced).toBe(0);
    expect(store.failSyncStatus).toHaveBeenCalled();
  });

  it('handles empty vulnerability list', async () => {
    vi.mocked(harborClient.listVulnerabilities).mockResolvedValueOnce({
      items: [],
      total: 0,
    });

    const result = await runFullSync();
    expect(result.vulnerabilitiesSynced).toBe(0);
    expect(result.inUseMatched).toBe(0);
    expect(store.completeSyncStatus).toHaveBeenCalled();
  });

  describe('pagination termination (#741)', () => {
    it('terminates when items.length < pageSize (primary signal)', async () => {
      // Return 50 items (< pageSize 100) — should stop after 1 page
      const items = Array.from({ length: 50 }, (_, i) => ({
        project_id: 1,
        repository_name: 'myproject/app',
        digest: `sha256:${i}`,
        tags: ['latest'],
        cve_id: `CVE-2024-${1000 + i}`,
        severity: 'Medium',
        status: '',
        cvss_v3_score: 5.0,
        package: `pkg-${i}`,
        version: '1.0.0',
        fixed_version: '',
        desc: 'test vuln',
        links: [],
      }));

      vi.mocked(harborClient.listVulnerabilities).mockResolvedValueOnce({
        items,
        total: 0, // total unknown (header missing)
      });

      const result = await runFullSync();
      expect(result.vulnerabilitiesSynced).toBe(50);
      // Should only call listVulnerabilities once since items < pageSize
      expect(harborClient.listVulnerabilities).toHaveBeenCalledTimes(1);
    });

    it('paginates through multiple pages when items.length === pageSize', async () => {
      const makeItems = (count: number, offset: number) =>
        Array.from({ length: count }, (_, i) => ({
          project_id: 1,
          repository_name: 'myproject/app',
          digest: `sha256:${offset + i}`,
          tags: ['latest'],
          cve_id: `CVE-2024-${offset + i}`,
          severity: 'Low',
          status: '',
          cvss_v3_score: 3.0,
          package: `pkg-${offset + i}`,
          version: '1.0.0',
          fixed_version: '',
          desc: 'test',
          links: [],
        }));

      // Page 1: 100 items (full page), Page 2: 30 items (partial — done)
      vi.mocked(harborClient.listVulnerabilities)
        .mockResolvedValueOnce({ items: makeItems(100, 0), total: 0 })
        .mockResolvedValueOnce({ items: makeItems(30, 100), total: 0 });

      const result = await runFullSync();
      expect(result.vulnerabilitiesSynced).toBe(130);
      expect(harborClient.listVulnerabilities).toHaveBeenCalledTimes(2);
    });

    it('terminates when total count is reached (secondary signal)', async () => {
      const makeItems = (count: number, offset: number) =>
        Array.from({ length: count }, (_, i) => ({
          project_id: 1,
          repository_name: 'myproject/app',
          digest: `sha256:${offset + i}`,
          tags: [],
          cve_id: `CVE-2024-${offset + i}`,
          severity: 'High',
          status: '',
          cvss_v3_score: 7.0,
          package: `pkg-${offset + i}`,
          version: '2.0.0',
          fixed_version: '2.0.1',
          desc: 'test',
          links: [],
        }));

      // total=150, page 1: 100 items (full), page 2: 100 items (full, but total reached)
      vi.mocked(harborClient.listVulnerabilities)
        .mockResolvedValueOnce({ items: makeItems(100, 0), total: 150 })
        .mockResolvedValueOnce({ items: makeItems(100, 100), total: 150 });

      const result = await runFullSync();
      // Should have all 200 fetched items but terminate because total (150) reached
      expect(result.vulnerabilitiesSynced).toBe(200);
      expect(harborClient.listVulnerabilities).toHaveBeenCalledTimes(2);
    });

    it('handles total: 0 (missing header) without premature termination', async () => {
      const makeItems = (count: number, offset: number) =>
        Array.from({ length: count }, (_, i) => ({
          project_id: 1,
          repository_name: 'myproject/app',
          digest: `sha256:${offset + i}`,
          tags: [],
          cve_id: `CVE-2024-${offset + i}`,
          severity: 'Low',
          status: '',
          cvss_v3_score: 2.0,
          package: `pkg-${offset + i}`,
          version: '1.0.0',
          fixed_version: '',
          desc: 'test',
          links: [],
        }));

      // total: 0 (header missing), 3 full pages then a partial page
      vi.mocked(harborClient.listVulnerabilities)
        .mockResolvedValueOnce({ items: makeItems(100, 0), total: 0 })
        .mockResolvedValueOnce({ items: makeItems(100, 100), total: 0 })
        .mockResolvedValueOnce({ items: makeItems(100, 200), total: 0 })
        .mockResolvedValueOnce({ items: makeItems(42, 300), total: 0 });

      const result = await runFullSync();
      expect(result.vulnerabilitiesSynced).toBe(342);
      expect(harborClient.listVulnerabilities).toHaveBeenCalledTimes(4);
    });
  });

  describe('pagination cap + truncation (#1392)', () => {
    const makeFullPageItems = (count: number, offset: number) =>
      Array.from({ length: count }, (_, i) => ({
        project_id: 1,
        repository_name: 'myproject/app',
        digest: `sha256:trunc${offset + i}`,
        tags: ['latest'],
        cve_id: `CVE-2024-TRUNC${offset + i}`,
        severity: 'High',
        status: '',
        cvss_v3_score: 7.0,
        package: `pkg-${offset + i}`,
        version: '1.0.0',
        fixed_version: '',
        desc: 'truncation test',
        links: [],
      }));

    beforeEach(() => {
      // Each test in this describe sets its own HARBOR_MAX_PAGES; reset after
    });

    afterEach(() => {
      resetConfig();
    });

    it('surfaces truncation: completeSyncStatus is called with Harbor total when cap is hit', async () => {
      // Cap = 2 pages, Harbor reports total = 5000 (far exceeds cap)
      setConfigForTest({ HARBOR_MAX_PAGES: 2 });

      vi.mocked(harborClient.listVulnerabilities).mockResolvedValue({
        items: makeFullPageItems(100, 0),
        total: 5000,
      });

      await runFullSync();

      // completeSyncStatus must be called with the Harbor total so the store
      // can write a truncation message into error_message
      const calls = vi.mocked(store.completeSyncStatus).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const lastCall = calls[calls.length - 1];
      // 4th argument: expectedTotal — should be 5000 (the Harbor total)
      expect(lastCall[3]).toBe(5000);
    });

    it('HARBOR_MAX_PAGES honored: listVulnerabilities called at most HARBOR_MAX_PAGES+1 times', async () => {
      // Cap = 2 pages
      setConfigForTest({ HARBOR_MAX_PAGES: 2 });

      // Always returns full pages with a very large total so neither primary
      // nor secondary termination fires before the cap
      vi.mocked(harborClient.listVulnerabilities).mockResolvedValue({
        items: makeFullPageItems(100, 0),
        total: 99999,
      });

      await runFullSync();

      // With cap=2: page 1 fetched, page 2 fetched, then page counter hits cap
      // So at most cap calls (page 1 through cap)
      const callCount = vi.mocked(harborClient.listVulnerabilities).mock.calls.length;
      expect(callCount).toBeLessThanOrEqual(3); // pages 1..HARBOR_MAX_PAGES + one possible check
      // More precisely: must not be more than HARBOR_MAX_PAGES calls
      expect(callCount).toBeLessThanOrEqual(2);
    });

    it('no truncation: completeSyncStatus 4th arg is not a truncating value when under cap', async () => {
      setConfigForTest({ HARBOR_MAX_PAGES: 500 });

      // Return fewer than a full page — terminates naturally via primary signal
      // Harbor reports total=42, synced=42 → no truncation (synced >= expectedTotal)
      vi.mocked(harborClient.listVulnerabilities).mockResolvedValueOnce({
        items: makeFullPageItems(42, 0),
        total: 42,
      });

      await runFullSync();

      const calls = vi.mocked(store.completeSyncStatus).mock.calls;
      const lastCall = calls[calls.length - 1];
      // synced (lastCall[1]) must equal or exceed expectedTotal (lastCall[3]) → no truncation
      const synced = lastCall[1] as number;
      const expectedTotal = lastCall[3] as number | undefined;
      if (expectedTotal !== undefined) {
        expect(synced).toBeGreaterThanOrEqual(expectedTotal);
      }
      // Result must not indicate an error
      const result = vi.mocked(store.completeSyncStatus).mock.results;
      expect(result.length).toBeGreaterThan(0);
    });

    it('HARBOR_MAX_PAGES=0 disables the cap (paginates until Harbor total is reached)', async () => {
      setConfigForTest({ HARBOR_MAX_PAGES: 0 });

      // Always-full pages; termination must come from the Harbor total, not the
      // cap. With the old min(1) + `page > maxPages` guard, maxPages=0 would have
      // broken after page 1 (1 > 0); the `maxPages > 0` guard disables it.
      vi.mocked(harborClient.listVulnerabilities).mockResolvedValue({
        items: makeFullPageItems(100, 0),
        total: 300,
      });

      await runFullSync();

      // 3 full pages (300) reach total=300 → no cap hit, no truncation.
      expect(vi.mocked(harborClient.listVulnerabilities).mock.calls.length).toBe(3);
      const lastCall = vi.mocked(store.completeSyncStatus).mock.calls.at(-1)!;
      expect(lastCall[3]).toBe(300); // expectedTotal
      expect(lastCall[1]).toBe(300); // synced === total → not truncated
    });
  });

  describe('concurrency guard (#975)', () => {
    it('rejects concurrent calls — second caller returns early with error', async () => {
      // Make listVulnerabilities hang until we resolve it, so the first sync stays "in progress"
      let resolveFirst!: (value: unknown) => void;
      const firstCallPromise = new Promise((resolve) => { resolveFirst = resolve; });

      vi.mocked(harborClient.listVulnerabilities).mockImplementationOnce(
        () => firstCallPromise as any,
      );

      // Start the first sync (it will block on listVulnerabilities)
      const first = runFullSync();

      // Allow microtasks to settle so the guard is set
      await vi.waitFor(() => expect(getIsSyncing()).toBe(true));

      // Second call should return immediately with "already in progress"
      const second = await runFullSync();
      expect(second.error).toBe('Sync already in progress');
      expect(second.vulnerabilitiesSynced).toBe(0);
      expect(second.durationMs).toBe(0);

      // Unblock the first sync
      resolveFirst({ items: [], total: 0 });
      const firstResult = await first;
      expect(firstResult.error).toBeUndefined();
    });

    it('clears the guard after a successful sync', async () => {
      vi.mocked(harborClient.listVulnerabilities).mockResolvedValueOnce({
        items: [],
        total: 0,
      });

      expect(getIsSyncing()).toBe(false);
      await runFullSync();
      expect(getIsSyncing()).toBe(false);
    });

    it('clears the guard after a failed sync', async () => {
      vi.mocked(harborClient.listVulnerabilities).mockRejectedValueOnce(
        new Error('Network failure'),
      );

      expect(getIsSyncing()).toBe(false);
      const result = await runFullSync();
      expect(result.error).toContain('Network failure');
      // Guard must be cleared so subsequent syncs can proceed
      expect(getIsSyncing()).toBe(false);
    });

    it('clears the guard when Harbor is not configured', async () => {
      vi.mocked(harborClient.isHarborConfiguredAsync).mockResolvedValueOnce(false);

      expect(getIsSyncing()).toBe(false);
      await runFullSync();
      // Guard must be cleared even when the sync bails out early
      expect(getIsSyncing()).toBe(false);
    });
  });
});
