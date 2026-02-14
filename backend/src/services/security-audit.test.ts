import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildSecurityAuditSummary,
  getSecurityAudit,
  getSecurityAuditIgnoreList,
  isIgnoredContainer,
  resolveAuditSeverity,
  setSecurityAuditIgnoreList,
} from './security-audit.js';

const mockGetEndpoints = vi.fn();
const mockGetContainers = vi.fn();
const mockGetContainerHostConfig = vi.fn();
const mockGetSetting = vi.fn();
const mockSetSetting = vi.fn();
const mockCachedFetch = vi.fn();

vi.mock('../utils/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

vi.mock('./portainer-client.js', () => ({
  getEndpoints: (...args: unknown[]) => mockGetEndpoints(...args),
  getContainers: (...args: unknown[]) => mockGetContainers(...args),
  getContainerHostConfig: (...args: unknown[]) => mockGetContainerHostConfig(...args),
}));

vi.mock('./portainer-cache.js', () => ({
  cachedFetch: (...args: unknown[]) => mockCachedFetch(...args),
  getCacheKey: (...args: (string | number)[]) => args.join(':'),
  TTL: { ENDPOINTS: 900, CONTAINERS: 300, CONTAINER_INSPECT: 300 },
}));

vi.mock('./settings-store.js', () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
  setSetting: (...args: unknown[]) => mockSetSetting(...args),
}));

describe('security-audit service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSetting.mockResolvedValue(undefined);
    mockSetSetting.mockResolvedValue(undefined);
    // cachedFetch delegates to the fetcher function (3rd arg)
    mockCachedFetch.mockImplementation((_key: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher());

    mockGetEndpoints.mockResolvedValue([{ Id: 1, Name: 'prod' }]);
    // List endpoint returns sparse HostConfig (only NetworkMode in practice)
    mockGetContainers.mockResolvedValue([
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
    ]);
    // Inspect endpoint returns full HostConfig
    mockGetContainerHostConfig.mockImplementation((endpointId: number, containerId: string) => {
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

  it('uses cachedFetch for endpoints, containers, and inspect calls', async () => {
    await getSecurityAudit();

    const calls = mockCachedFetch.mock.calls;
    // 1 endpoints call + 1 containers call + 2 inspect calls (c1, c2) = 4
    expect(calls).toHaveLength(4);

    // Endpoints: key='endpoints', TTL=900
    expect(calls[0][0]).toBe('endpoints');
    expect(calls[0][1]).toBe(900);

    // Containers: key='containers:1', TTL=300
    expect(calls[1][0]).toBe('containers:1');
    expect(calls[1][1]).toBe(300);

    // Inspect: key='inspect:1:c1', TTL=300
    expect(calls[2][0]).toBe('inspect:1:c1');
    expect(calls[2][1]).toBe(300);

    // Inspect: key='inspect:1:c2', TTL=300
    expect(calls[3][0]).toBe('inspect:1:c2');
    expect(calls[3][1]).toBe(300);
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
