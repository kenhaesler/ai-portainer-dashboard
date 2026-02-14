import { getEndpoints, getContainers, getContainerHostConfig } from './portainer-client.js';
import { cachedFetch, getCacheKey, TTL } from './portainer-cache.js';
import type { Container } from '../models/portainer.js';
import { getSetting, setSetting } from './settings-store.js';
import { createChildLogger } from '../utils/logger.js';
import {
  scanCapabilityPosture,
  type CapabilityPosture,
  type CapabilityFinding,
  type SecurityFinding,
} from './security-scanner.js';

const log = createChildLogger('security-audit');

export const SECURITY_AUDIT_IGNORE_KEY = 'security_audit_ignore_list';

export const DEFAULT_SECURITY_AUDIT_IGNORE_PATTERNS = [
  'portainer',
  'portainer_edge_agent',
  'traefik',
  'nginx*',
  'caddy*',
  'prometheus*',
  'grafana*',
] as const;

export interface SecurityAuditEntry {
  containerId: string;
  containerName: string;
  stackName: string | null;
  endpointId: number;
  endpointName: string;
  state: string;
  status: string;
  image: string;
  posture: CapabilityPosture;
  findings: CapabilityFinding[];
  severity: 'critical' | 'warning' | 'info' | 'none';
  ignored: boolean;
}

function toContainerName(container: Container): string {
  return container.Names?.[0]?.replace(/^\//, '') || container.Id.slice(0, 12);
}

function normalizePattern(pattern: string): string {
  return pattern.trim().toLowerCase();
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = escapeRegExp(pattern).replace(/\\\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function matchesPattern(value: string, pattern: string): boolean {
  if (!pattern) return false;
  if (!pattern.includes('*')) {
    return value.toLowerCase() === pattern.toLowerCase();
  }
  return wildcardToRegExp(pattern).test(value);
}

export function resolveAuditSeverity(findings: SecurityFinding[]): SecurityAuditEntry['severity'] {
  if (findings.some((f) => f.severity === 'critical')) return 'critical';
  if (findings.some((f) => f.severity === 'warning')) return 'warning';
  if (findings.some((f) => f.severity === 'info')) return 'info';
  return 'none';
}

export async function getSecurityAuditIgnoreList(): Promise<string[]> {
  const stored = (await getSetting(SECURITY_AUDIT_IGNORE_KEY))?.value;
  if (!stored) {
    return [...DEFAULT_SECURITY_AUDIT_IGNORE_PATTERNS];
  }

  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [...DEFAULT_SECURITY_AUDIT_IGNORE_PATTERNS];

    const cleaned = parsed
      .filter((value): value is string => typeof value === 'string')
      .map(normalizePattern)
      .filter((value) => value.length > 0);

    return cleaned.length > 0 ? cleaned : [...DEFAULT_SECURITY_AUDIT_IGNORE_PATTERNS];
  } catch {
    return [...DEFAULT_SECURITY_AUDIT_IGNORE_PATTERNS];
  }
}

export async function setSecurityAuditIgnoreList(patterns: string[]): Promise<string[]> {
  const cleaned = patterns
    .map(normalizePattern)
    .filter((value) => value.length > 0);

  await setSetting(SECURITY_AUDIT_IGNORE_KEY, JSON.stringify(cleaned), 'security');
  return cleaned;
}

export function isIgnoredContainer(containerName: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesPattern(containerName, pattern));
}

export async function getSecurityAudit(endpointId?: number): Promise<SecurityAuditEntry[]> {
  const ignorePatterns = await getSecurityAuditIgnoreList();
  const endpoints = await cachedFetch(
    getCacheKey('endpoints'),
    TTL.ENDPOINTS,
    () => getEndpoints(),
  );
  const scopedEndpoints = endpointId
    ? endpoints.filter((endpoint) => endpoint.Id === endpointId)
    : endpoints;

  const entries: SecurityAuditEntry[] = [];

  for (const endpoint of scopedEndpoints) {
    const containers = await cachedFetch(
      getCacheKey('containers', endpoint.Id),
      TTL.CONTAINERS,
      () => getContainers(endpoint.Id, true),
    );

    // Inspect containers in parallel to get full HostConfig (CapAdd, Privileged, PidMode)
    // — the list endpoint only returns NetworkMode.
    const inspectResults = await Promise.allSettled(
      containers.map((c) =>
        cachedFetch(
          getCacheKey('inspect', endpoint.Id, c.Id),
          TTL.CONTAINER_INSPECT,
          () => getContainerHostConfig(endpoint.Id, c.Id),
        ),
      ),
    );

    for (let i = 0; i < containers.length; i++) {
      const container = containers[i];
      const containerName = toContainerName(container);

      // Merge inspect HostConfig over the sparse list HostConfig
      const inspectResult = inspectResults[i];
      let hostConfig = container.HostConfig;
      if (inspectResult.status === 'fulfilled') {
        const { CapDrop: _drop, ...inspect } = inspectResult.value;
        // Docker inspect returns CapAdd as null when empty — normalize to undefined
        hostConfig = { ...hostConfig, ...inspect, CapAdd: inspect.CapAdd ?? undefined };
      } else {
        log.warn({ containerId: container.Id, err: inspectResult.reason }, 'Failed to inspect container for HostConfig');
      }

      // Build a container-like object with the enriched HostConfig for the scanner
      const enriched: Container = { ...container, HostConfig: hostConfig };

      const findings = scanCapabilityPosture(enriched);
      const posture: CapabilityPosture = {
        capAdd: hostConfig?.CapAdd || [],
        privileged: !!hostConfig?.Privileged,
        networkMode: hostConfig?.NetworkMode || null,
        pidMode: hostConfig?.PidMode || null,
      };

      entries.push({
        containerId: container.Id,
        containerName,
        stackName: container.Labels?.['com.docker.compose.project'] || null,
        endpointId: endpoint.Id,
        endpointName: endpoint.Name,
        state: container.State || 'unknown',
        status: container.Status || '',
        image: container.Image || '',
        posture,
        findings,
        severity: resolveAuditSeverity(findings),
        ignored: isIgnoredContainer(containerName, ignorePatterns),
      });
    }
  }

  return entries;
}

export function buildSecurityAuditSummary(entries: SecurityAuditEntry[]): {
  totalAudited: number;
  flagged: number;
  ignored: number;
} {
  const flaggedEntries = entries.filter((entry) => entry.findings.length > 0);
  return {
    totalAudited: entries.length,
    flagged: flaggedEntries.filter((entry) => !entry.ignored).length,
    ignored: flaggedEntries.filter((entry) => entry.ignored).length,
  };
}
