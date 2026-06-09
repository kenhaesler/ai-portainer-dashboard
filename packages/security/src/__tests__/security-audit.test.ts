import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import {
  buildSecurityAuditSummary,
  getSecurityAudit,
  getSecurityAuditIgnoreList,
  isIgnoredContainer,
  resolveAuditSeverity,
  setSecurityAuditIgnoreList,
} from '../services/security-audit.js';
import { CircuitBreakerOpenError } from '@dashboard/core/portainer/circuit-breaker.js';

const mockGetSetting = vi.fn();
const mockSetSetting = vi.fn();

// Kept: settings-store mock — tests control settings responses
vi.mock('@dashboard/core/services/settings-store.js', () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
  setSetting: (...args: unknown[]) => mockSetSetting(...args),
}));

import * as portainerClient from '@dashboard/core/portainer/portainer-client.js';
import * as portainerCache from '@dashboard/core/portainer/portainer-cache.js';
import { cache } from '@dashboard/core/portainer/portainer-cache.js';
import { closeTestRedis } from '@dashboard/core/test-utils/test-redis-helper.js';

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

    mockGetEndpoints = vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([{ Id: 1, Name: 'prod', Type: 1 }] as any);
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

  describe('wildcard matcher prefix*suffix overlap (#1388)', () => {
    // The pure-string matcher must stay semantically equivalent to the old
    // `^prefix.*suffix$` regex. For a `prefix*suffix` shape matched against a
    // SHORT value, the fixed prefix and fixed suffix must NOT consume
    // overlapping characters — otherwise an over-matching ignore pattern
    // silently suppresses a flagged container (security false-negative).

    it('rejects a single char when prefix and suffix would overlap (a*a vs a)', () => {
      // old `^a.*a$` against 'a' → false (needs >= 2 chars)
      expect(isIgnoredContainer('a', ['a*a'])).toBe(false);
      // sanity: a value long enough for both anchors still matches
      expect(isIgnoredContainer('aba', ['a*a'])).toBe(true);
      expect(isIgnoredContainer('aa', ['a*a'])).toBe(true);
    });

    it('rejects an overlapping realistic prefix*suffix (app*pp vs app)', () => {
      // old `^app.*pp$` against 'app' → false (suffix `pp` overlaps prefix `app`)
      expect(isIgnoredContainer('app', ['app*pp'])).toBe(false);
      // non-overlapping value where both anchors fit → matches
      expect(isIgnoredContainer('app-pp', ['app*pp'])).toBe(true);
      expect(isIgnoredContainer('appxpp', ['app*pp'])).toBe(true);
    });

    it('rejects overlap for a hyphenated prefix*suffix (app*-prod vs approd)', () => {
      // old `^app.*-prod$` against 'approd' → false; against 'app-prod' → true
      expect(isIgnoredContainer('approd', ['app*-prod'])).toBe(false);
      expect(isIgnoredContainer('app-prod', ['app*-prod'])).toBe(true);
      expect(isIgnoredContainer('app-svc-prod', ['app*-prod'])).toBe(true);
    });

    it('handles multiple wildcards via the middle segment branch (a*b*c)', () => {
      // Multi-`*` patterns exercise the interior indexOf branch of matchesPattern
      // (a fixed segment that is neither the anchored prefix nor suffix). Each
      // case mirrors the old `^a.*b.*c$` regex semantics.
      expect(isIgnoredContainer('axbxc', ['a*b*c'])).toBe(true);   // a … b … c, in order
      expect(isIgnoredContainer('abc', ['a*b*c'])).toBe(true);     // empty `.*` between segments
      expect(isIgnoredContainer('ac', ['a*b*c'])).toBe(false);     // middle `b` absent
      expect(isIgnoredContainer('acb', ['a*b*c'])).toBe(false);    // segments out of order
      expect(isIgnoredContainer('xabc', ['a*b*c'])).toBe(false);   // must start at the prefix
      expect(isIgnoredContainer('abcd', ['a*b*c'])).toBe(false);   // must end at the suffix
      // Realistic shape: env-tagged service with two wildcards.
      expect(isIgnoredContainer('svc-api-prod-1', ['svc*api*prod*'])).toBe(true);
      expect(isIgnoredContainer('svc-web-prod-1', ['svc*api*prod*'])).toBe(false);
    });

    it('preserves single-anchor wildcard shapes', () => {
      // prefix-anchored: foo*
      expect(isIgnoredContainer('nginx-proxy', ['nginx*'])).toBe(true);
      expect(isIgnoredContainer('mynginx', ['nginx*'])).toBe(false);
      // suffix-anchored: *foo
      expect(isIgnoredContainer('my-sidecar', ['*sidecar'])).toBe(true);
      expect(isIgnoredContainer('sidecar-proxy', ['*sidecar'])).toBe(false);
      // contains: *foo*
      expect(isIgnoredContainer('prometheus-node', ['*metheus*'])).toBe(true);
      expect(isIgnoredContainer('grafana', ['*metheus*'])).toBe(false);
      // exact, no wildcard
      expect(isIgnoredContainer('traefik', ['traefik'])).toBe(true);
      expect(isIgnoredContainer('traefik-2', ['traefik'])).toBe(false);
    });

    it('preserves default ignore-pattern behavior', () => {
      const defaults = ['portainer', 'traefik', 'nginx*', 'caddy*', 'prometheus*', 'grafana*'];
      expect(isIgnoredContainer('portainer', defaults)).toBe(true);
      expect(isIgnoredContainer('traefik', defaults)).toBe(true);
      expect(isIgnoredContainer('nginx-proxy', defaults)).toBe(true);
      expect(isIgnoredContainer('caddy-1', defaults)).toBe(true);
      expect(isIgnoredContainer('prometheus-node', defaults)).toBe(true);
      expect(isIgnoredContainer('grafana', defaults)).toBe(true);
      // an actual app must NOT be ignored by the defaults
      expect(isIgnoredContainer('my-api', defaults)).toBe(false);
      expect(isIgnoredContainer('mynginx', defaults)).toBe(false);
    });
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
      { Id: 1, Name: 'prod', Type: 1 },
      { Id: 2, Name: 'staging', Type: 1 },
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
      { Id: 1, Name: 'prod', Type: 1 },
      { Id: 2, Name: 'staging', Type: 1 },
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

  it('does not throw on the audit-all path when endpoints resolve undefined (#1270)', async () => {
    // Regression: when endpointId is undefined ("audit all"), scopedEndpoints
    // is assigned `endpoints` straight through. If the cache/upstream resolves
    // undefined (e.g. HTTP 204 / empty body) the subsequent .filter()/iteration
    // would throw TypeError. The source-level `?? []` guard must prevent this.
    mockCachedFetch.mockImplementation((key: string, _ttl: number, fetcher: () => Promise<unknown>) => {
      if (key === 'endpoints') {
        return Promise.resolve(undefined);
      }
      return fetcher();
    });

    const entries = await getSecurityAudit();
    expect(entries).toEqual([]);
  });

  it('does not throw on a scoped audit when endpoints resolve undefined (#1270)', async () => {
    mockCachedFetch.mockImplementation((key: string, _ttl: number, fetcher: () => Promise<unknown>) => {
      if (key === 'endpoints') {
        return Promise.resolve(undefined);
      }
      return fetcher();
    });

    const entries = await getSecurityAudit(1);
    expect(entries).toEqual([]);
  });

  it('does not throw when containers resolve undefined (#1388)', async () => {
    // Regression: cachedFetch resolving containers as undefined previously made
    // computeSecurityAudit call undefined.map() and throw a TypeError.
    // The fix is to guard the containers assignment with `?? []`, mirroring
    // the existing `?? []` guard on the endpoints assignment (#1270).
    mockCachedFetch.mockImplementation((key: string, _ttl: number, fetcher: () => Promise<unknown>) => {
      if (key.startsWith('containers:')) return Promise.resolve(undefined);
      return fetcher();
    });

    await expect(getSecurityAudit()).resolves.toBeDefined();  // no throw; returns an array
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

// Separate block: uses the REAL cache (the suite above mocks cachedFetch away).
describe('setSecurityAuditIgnoreList — cache invalidation (Home "Security Findings" KPI staleness)', () => {
  beforeEach(async () => {
    await cache.clear();
    vi.restoreAllMocks();
    mockGetSetting.mockResolvedValue(undefined);
    mockSetSetting.mockResolvedValue(undefined);
  });

  it('busts every cached security-audit entry so the next read recomputes ignored flags', async () => {
    // A prior audit run cached its entries with each `ignored` flag baked in,
    // under the fleet-wide ('all') key and a per-endpoint key. The Home
    // "Security Findings" KPI (/api/dashboard/summary) reads from these.
    const allKey = portainerCache.getCacheKey('security-audit', 'all');
    const endpointKey = portainerCache.getCacheKey('security-audit', 1);
    await cache.set(allKey, [{ containerName: 'foo', ignored: false }], 300);
    await cache.set(endpointKey, [{ containerName: 'foo', ignored: false }], 300);
    expect(await cache.get(allKey)).toBeDefined();
    expect(await cache.get(endpointKey)).toBeDefined();

    // Admin adds 'foo' to the ignore list.
    await setSecurityAuditIgnoreList(['foo']);

    // Both cached audits must be cleared — otherwise the KPI keeps counting
    // 'foo' for up to SECURITY_AUDIT_TTL (5 min) after it was ignored.
    expect(await cache.get(allKey)).toBeUndefined();
    expect(await cache.get(endpointKey)).toBeUndefined();
  });
});
