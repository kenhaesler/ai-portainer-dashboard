import { getEndpoints, getContainers, getContainerHostConfig } from '@dashboard/core/portainer/portainer-client.js';
import { cachedFetch, getCacheKey, TTL } from '@dashboard/core/portainer/portainer-cache.js';
import { type Container, isDockerEndpoint } from '@dashboard/core/models/portainer.js';
import { getSetting, setSetting } from '@dashboard/core/services/settings-store.js';
import { createChildLogger } from '@dashboard/core/utils/logger.js';
import { CircuitBreakerOpenError } from '@dashboard/core/portainer/circuit-breaker.js';
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

/**
 * Pure-string wildcard match — supports only `*` as a multi-character glob.
 * Splits the pattern on `*` and verifies each literal segment appears in the
 * correct order inside `value` without constructing a dynamic RegExp
 * (avoids CWE-1333 ReDoS).
 *
 * Examples:
 *   matchesPattern('nginx-ingress', 'nginx*')  → true
 *   matchesPattern('api',           'nginx*')  → false
 *   matchesPattern('prometheus-1',  '*metheus*') → true
 */
function matchesPattern(value: string, pattern: string): boolean {
  if (!pattern) return false;

  const v = value.toLowerCase();
  const p = pattern.toLowerCase();

  // Fast path: no wildcard → exact match.
  if (!p.includes('*')) return v === p;

  const segments = p.split('*');
  const startsFixed = !p.startsWith('*');
  const endsFixed   = !p.endsWith('*');

  let cursor = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg === '') continue;   // consecutive or leading/trailing `*`

    if (i === 0 && startsFixed) {
      // First segment must match at position 0
      if (!v.startsWith(seg)) return false;
      cursor = seg.length;
    } else if (i === segments.length - 1 && endsFixed) {
      // Last segment must match at the very end AND must start at or after the
      // cursor advanced by the fixed prefix — otherwise the prefix and suffix
      // could consume overlapping characters, over-matching where the old
      // `^prefix.*suffix$` regex would not (e.g. `a*a` vs `a`). Anchor the
      // suffix by index so it cannot reach back into already-consumed input.
      const start = v.length - seg.length;
      if (start < cursor || !v.startsWith(seg, start)) return false;
      cursor = v.length;  // consumed
    } else {
      const idx = v.indexOf(seg, cursor);
      if (idx === -1) return false;
      cursor = idx + seg.length;
    }
  }
  return true;
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

/** TTL for the full audit result cache (5 minutes). */
const SECURITY_AUDIT_TTL = 300;

/**
 * Run the full security audit computation — fetches endpoints, containers,
 * and inspects each container for host config. This is the expensive inner
 * function; callers should prefer the cached `getSecurityAudit()` wrapper.
 */
async function computeSecurityAudit(endpointId?: number): Promise<SecurityAuditEntry[]> {
  const ignorePatterns = await getSecurityAuditIgnoreList();
  // Guard once at the source: if a cache layer or upstream resolves undefined
  // (e.g. HTTP 204 / empty body), default to [] so neither branch below — and
  // critically the "audit all endpoints" (endpointId undefined) path that
  // assigns `endpoints` straight through — can throw on .filter()/iteration.
  const endpoints = (await cachedFetch(
    getCacheKey('endpoints'),
    TTL.ENDPOINTS,
    () => getEndpoints(),
  )) ?? [];
  const scopedEndpoints = endpointId
    ? endpoints.filter((endpoint) => endpoint.Id === endpointId)
    : endpoints;

  const entries: SecurityAuditEntry[] = [];

  for (const endpoint of scopedEndpoints.filter((ep) => isDockerEndpoint(ep.Type))) {
    let containers: Awaited<ReturnType<typeof getContainers>>;
    try {
      containers = (await cachedFetch(
        getCacheKey('containers', endpoint.Id),
        TTL.CONTAINERS,
        () => getContainers(endpoint.Id, true),
      )) ?? [];
    } catch (err) {
      if (err instanceof CircuitBreakerOpenError) {
        log.debug({ endpointId: endpoint.Id }, 'Skipping security audit for endpoint with open circuit breaker');
      } else {
        log.warn({ endpointId: endpoint.Id, err }, 'Failed to fetch containers for security audit — skipping endpoint');
      }
      continue;
    }

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

/**
 * Get the security audit results, cached with a 5-minute TTL.
 * The dashboard summary calls this on every request — caching prevents
 * N+1 container inspect calls from thundering on every page load.
 */
export async function getSecurityAudit(endpointId?: number): Promise<SecurityAuditEntry[]> {
  const cacheKey = getCacheKey('security-audit', endpointId ?? 'all');
  return cachedFetch(
    cacheKey,
    SECURITY_AUDIT_TTL,
    () => computeSecurityAudit(endpointId),
  );
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
