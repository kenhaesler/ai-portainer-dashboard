import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import {
  buildSecurityAuditSummary,
  getSecurityAudit,
  getSecurityAuditIgnoreList,
  isIgnoredContainer,
  resolveAuditSeverity,
  setSecurityAuditIgnoreList,
} from './security-audit.js';
import { CircuitBreakerOpenError } from '../core/portainer/circuit-breaker.js';

const mockGetSetting = vi.fn();
const mockSetSetting = vi.fn();

// Kept: settings-store mock — tests control settings responses
vi.mock('./settings-store.js', () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
  setSetting: (...args: unknown[]) => mockSetSetting(...args),
}));

import * as portainerClient from '../core/portainer/portainer-client.js';
import * as portainerCache from '../core/portainer/portainer-cache.js';
import { cache } from '../core/portainer/portainer-cache.js';
import { closeTestRedis } from '../test-utils/test-redis-helper.js';

let mockGetEndpoints: any;
let mockGetContainers: any;
let mockGetContainerHostConfig: any;
let mockCachedFetch: any;

beforeAll(async () => {
  await cache.clear();
});

afterAll(async () => {
  await closeTestRedis();
});

describe('security-audit service', () => {
  beforeEach(async () => {
    await cache.clear();
    vi.restoreAllMocks();
    mockGetSetting.mockResolvedValue(undefined);
    mockSetSetting.mockResolvedValue(undefined);
    // Spy on cachedFetch — delegates to fetcher function (3rd arg)
    mockCachedFetch = vi.spyOn(portainerCache, 'cachedFetch').mockImplementation(
      (_key: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher(),
    );

    mockGetEndpoints = vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([{ Id: 1, Name: 'prod' }] as any);
    // List endpoint returns sparse HostConfig (only NetworkMode in practice)
    mockGetContainers = vi.spyOn(portainerClient, 'getContainers').mockResolvedValue([
      {
        Id: 'c1',
        Names: ['/api'],
        Image: 'api:latest',
        Created: 1,
        State: 'running',
        Status: 'Up',
        Labels: {},
        HostConfig: { NetworkMode: 'bridge' },
      },
      {
        Id: 'c2',
        Names: ['/portainer'],
        Image: 'portainer:latest',
        Created: 1,
        State: 'running',
        Status: 'Up',
        Labels: {},
        HostConfig: { NetworkMode: 'bridge' },
      },
    ] as any);
    // Inspect endpoint returns full HostConfig
    mockGetContainerHostConfig = vi.spyOn(portainerClient, 'getContainerHostConfig').mockImplementation((endpointId: number, containerId: string) => {
      if (containerId === 'c1') {
        return Promise.resolve({ Privileged: false, CapAdd: ['NET_ADMIN'], NetworkMode: 'bridge', PidMode: 'private' });
      }
      return Promise.resolve({ Privileged: false, CapAdd: [], NetworkMode: 'bridge', PidMode: 'private' });
    });
  });

  it('uses defaults when no ignore list setting exists', async () => {
    const patterns = await getSecurityAuditIgnoreList();
    expect(patterns).toContain('portainer');
    expect(patterns).toContain('traefik');
  });

  it('normalizes and persists ignore list updates', async () => {
    const saved = await setSecurityAuditIgnoreList([' Portainer ', 'infra-*', '']);

    expect(saved).toEqual(['portainer', 'infra-*']);
    expect(mockSetSetting).toHaveBeenCalledWith(
      'security_audit_ignore_list',
      JSON.stringify(['portainer', 'infra-*']),
      'security',
    );
  });

  it('supports wildcard ignore patterns', () => {
    expect(isIgnoredContainer('nginx-ingress', ['nginx*'])).toBe(true);
    expect(isIgnoredContainer('api', ['nginx*'])).toBe(false);
  });

  it('returns audit entries with ignored visibility preserved', async () => {
    mockGetSetting.mockResolvedValue({ value: JSON.stringify(['portainer']) });

    const entries = await getSecurityAudit();

    expect(entries).toHaveLength(2);
    const api = entries.find((entry) => entry.containerName === 'api');
    const portainer = entries.find((entry) => entry.containerName === 'portainer');

    expect(api?.ignored).toBe(false);
    expect(api?.findings.length).toBeGreaterThan(0);
    expect(portainer?.ignored).toBe(true);
    expect(portainer?.findings).toHaveLength(0);
  });

  it('falls back to list HostConfig when inspect fails', async () => {
    mockGetContainerHostConfig.mockRejectedValue(new Error('inspect timeout'));

    const entries = await getSecurityAudit();
    expect(entries).toHaveLength(2);
    // Should still have entries — just with sparse HostConfig from list
    const api = entries.find((entry) => entry.containerName === 'api');
    expect(api?.posture.networkMode).toBe('bridge');
    expect(api?.posture.capAdd).toEqual([]);
  });

  it('populates capabilities from inspect data', async () => {
    mockGetSetting.mockResolvedValue({ value: JSON.stringify([]) });

    const entries = await getSecurityAudit();
    const api = entries.find((entry) => entry.containerName === 'api');
    expect(api?.posture.capAdd).toEqual(['NET_ADMIN']);
    expect(api?.posture.privileged).toBe(false);
  });

  it('uses cachedFetch for the full audit result and inner calls', async () => {
    await getSecurityAudit();

    const calls = mockCachedFetch.mock.calls;
    // 1 outer audit cache + 1 endpoints + 1 containers + 2 inspect calls = 5
    expect(calls).toHaveLength(5);

    // Outer audit cache: key='security-audit:all', TTL=300 (5 min)
    expect(calls[0][0]).toBe('security-audit:all');
    expect(calls[0][1]).toBe(300);

    // Endpoints: key='endpoints', TTL=900
    expect(calls[1][0]).toBe('endpoints');
    expect(calls[1][1]).toBe(900);

    // Containers: key='containers:1', TTL=300
    expect(calls[2][0]).toBe('containers:1');
    expect(calls[2][1]).toBe(300);

    // Inspect: key='inspect:1:c1', TTL=300
    expect(calls[3][0]).toBe('inspect:1:c1');
    expect(calls[3][1]).toBe(300);

    // Inspect: key='inspect:1:c2', TTL=300
    expect(calls[4][0]).toBe('inspect:1:c2');
    expect(calls[4][1]).toBe(300);
  });

  it('caches scoped audit results separately by endpointId', async () => {
    await getSecurityAudit(42);

    const calls = mockCachedFetch.mock.calls;
    // Outer audit cache should include the endpointId in the key
    expect(calls[0][0]).toBe('security-audit:42');
    expect(calls[0][1]).toBe(300);
  });

  it('skips endpoint and continues when circuit breaker is open', async () => {
    // Two endpoints: endpoint 1 has open circuit breaker, endpoint 2 works fine
    mockGetEndpoints.mockResolvedValue([
      { Id: 1, Name: 'prod' },
      { Id: 2, Name: 'staging' },
    ]);

    // mockCachedFetch: endpoint 1 containers fetch throws CircuitBreakerOpenError,
    // endpoint 2 returns containers normally
    mockCachedFetch.mockImplementation((key: string, _ttl: number, fetcher: () => Promise<unknown>) => {
      if (key === 'containers:1') {
        return Promise.reject(new CircuitBreakerOpenError('endpoint-1', 5000));
      }
      return fetcher();
    });

    mockGetContainers.mockResolvedValue([
      {
        Id: 'c2',
        Names: ['/web'],
        Image: 'nginx:latest',
        Created: 1,
        State: 'running',
        Status: 'Up',
        Labels: {},
        HostConfig: { NetworkMode: 'bridge' },
      },
    ]);

    const entries = await getSecurityAudit();

    // Only containers from endpoint 2 should appear — endpoint 1 was skipped
    expect(entries.every((e) => e.endpointId === 2)).toBe(true);
    expect(entries.some((e) => e.endpointId === 1)).toBe(false);
  });

  it('skips endpoint and continues when containers fetch fails with non-CB error', async () => {
    mockGetEndpoints.mockResolvedValue([
      { Id: 1, Name: 'prod' },
      { Id: 2, Name: 'staging' },
    ]);

    mockCachedFetch.mockImplementation((key: string, _ttl: number, fetcher: () => Promise<unknown>) => {
      if (key === 'containers:1') {
        return Promise.reject(new Error('network timeout'));
      }
      return fetcher();
    });

    mockGetContainers.mockResolvedValue([
      {
        Id: 'c2',
        Names: ['/web'],
        Image: 'nginx:latest',
        Created: 1,
        State: 'running',
        Status: 'Up',
        Labels: {},
        HostConfig: { NetworkMode: 'bridge' },
      },
    ]);

    const entries = await getSecurityAudit();

    // endpoint 1 skipped due to network error; endpoint 2 succeeds
    expect(entries.every((e) => e.endpointId === 2)).toBe(true);
  });

  it('computes audit summary counts', () => {
    const summary = buildSecurityAuditSummary([
      {
        containerId: '1', containerName: 'api', stackName: null,
        endpointId: 1, endpointName: 'prod', state: 'running', status: 'Up', image: 'api',
        posture: { capAdd: ['NET_ADMIN'], privileged: false, networkMode: 'bridge', pidMode: 'private' },
        findings: [{ severity: 'warning', category: 'x', title: 'x', description: 'x' }], severity: 'warning', ignored: false,
      },
      {
        containerId: '2', containerName: 'portainer', stackName: null,
        endpointId: 1, endpointName: 'prod', state: 'running', status: 'Up', image: 'portainer',
        posture: { capAdd: ['SYS_ADMIN'], privileged: false, networkMode: 'bridge', pidMode: 'private' },
        findings: [{ severity: 'critical', category: 'x', title: 'x', description: 'x' }], severity: 'critical', ignored: true,
      },
    ]);

    expect(summary).toEqual({ totalAudited: 2, flagged: 1, ignored: 1 });
    expect(resolveAuditSeverity([{ severity: 'critical', category: 'x', title: 'x', description: 'x' }])).toBe('critical');
  });
});
