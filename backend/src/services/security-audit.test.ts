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
const mockGetSetting = vi.fn();
const mockSetSetting = vi.fn();

vi.mock('./portainer-client.js', () => ({
  getEndpoints: (...args: unknown[]) => mockGetEndpoints(...args),
  getContainers: (...args: unknown[]) => mockGetContainers(...args),
}));

vi.mock('./settings-store.js', () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
  setSetting: (...args: unknown[]) => mockSetSetting(...args),
}));

describe('security-audit service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSetting.mockReturnValue(undefined);

    mockGetEndpoints.mockResolvedValue([{ Id: 1, Name: 'prod' }]);
    mockGetContainers.mockResolvedValue([
      {
        Id: 'c1',
        Names: ['/api'],
        Image: 'api:latest',
        Created: 1,
        State: 'running',
        Status: 'Up',
        Labels: {},
        HostConfig: {
          Privileged: false,
          CapAdd: ['NET_ADMIN'],
          NetworkMode: 'bridge',
          PidMode: 'private',
        },
      },
      {
        Id: 'c2',
        Names: ['/portainer'],
        Image: 'portainer:latest',
        Created: 1,
        State: 'running',
        Status: 'Up',
        Labels: {},
        HostConfig: {
          Privileged: false,
          CapAdd: [],
          NetworkMode: 'bridge',
          PidMode: 'private',
        },
      },
    ]);
  });

  it('uses defaults when no ignore list setting exists', () => {
    const patterns = getSecurityAuditIgnoreList();
    expect(patterns).toContain('portainer');
    expect(patterns).toContain('traefik');
  });

  it('normalizes and persists ignore list updates', () => {
    const saved = setSecurityAuditIgnoreList([' Portainer ', 'infra-*', '']);

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
    mockGetSetting.mockReturnValue({ value: JSON.stringify(['portainer']) });

    const entries = await getSecurityAudit();

    expect(entries).toHaveLength(2);
    const api = entries.find((entry) => entry.containerName === 'api');
    const portainer = entries.find((entry) => entry.containerName === 'portainer');

    expect(api?.ignored).toBe(false);
    expect(api?.findings.length).toBeGreaterThan(0);
    expect(portainer?.ignored).toBe(true);
    expect(portainer?.findings).toHaveLength(0);
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
