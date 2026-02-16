import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('./trace-context.js', () => ({
  withSpan: (_name: string, _service: string, _kind: string, fn: () => unknown) => fn(),
}));

vi.mock('./harbor-client.js', () => ({
  isHarborConfiguredAsync: vi.fn(() => Promise.resolve(true)),
  listVulnerabilities: vi.fn(),
}));

vi.mock('./harbor-vulnerability-store.js', () => ({
  createSyncStatus: vi.fn(() => Promise.resolve(1)),
  completeSyncStatus: vi.fn(() => Promise.resolve()),
  failSyncStatus: vi.fn(() => Promise.resolve()),
  replaceAllVulnerabilities: vi.fn((vulns: unknown[]) => Promise.resolve(vulns.length)),
}));

vi.mock('./portainer-client.js', () => ({
  getEndpoints: vi.fn(() => Promise.resolve([
    { Id: 1, Name: 'local', Type: 1, URL: 'tcp://localhost:2375', Status: 1, Snapshots: [] },
  ])),
  getContainers: vi.fn(() => Promise.resolve([
    {
      Id: 'abc123def456',
      Names: ['/my-nginx'],
      Image: 'harbor.example.com/myproject/nginx:latest',
      State: 'running',
      Status: 'Up 2 hours',
      Created: 0,
      Labels: {},
    },
  ])),
}));

vi.mock('./portainer-cache.js', () => ({
  cachedFetchSWR: (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn(),
  getCacheKey: (...args: string[]) => args.join(':'),
  TTL: { ENDPOINTS: 60, CONTAINERS: 30 },
}));

vi.mock('./image-staleness.js', () => ({
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

import { runFullSync } from './harbor-sync.js';
import * as harborClient from './harbor-client.js';
import * as store from './harbor-vulnerability-store.js';

describe('harbor-sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(store.completeSyncStatus).toHaveBeenCalledWith(1, 2, 1);
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
});
