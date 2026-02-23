import { createChildLogger } from '../core/utils/logger.js';
import type { Container } from '../core/models/portainer.js';

const log = createChildLogger('security-scanner');

export interface SecurityFinding {
  severity: 'critical' | 'warning' | 'info';
  category: string;
  title: string;
  description: string;
}

export type CapabilityFinding = SecurityFinding;

export interface CapabilityPosture {
  capAdd: string[];
  privileged: boolean;
  networkMode: string | null;
  pidMode: string | null;
}

const DANGEROUS_CAPABILITIES = [
  'SYS_ADMIN',
  'NET_ADMIN',
  'SYS_PTRACE',
  'NET_RAW',
  'SYS_MODULE',
] as const;

export function scanCapabilityPosture(container: Container): CapabilityFinding[] {
  const findings: CapabilityFinding[] = [];
  const name = container.Names?.[0]?.replace(/^\//, '') || container.Id.slice(0, 12);
  const capAdd = container.HostConfig?.CapAdd || [];
  const isPrivileged = !!container.HostConfig?.Privileged;

  if (isPrivileged) {
    findings.push({
      severity: 'critical',
      category: 'privileged-mode',
      title: `Container "${name}" running in privileged mode`,
      description:
        'Privileged containers have full access to the host system, bypassing all security boundaries. ' +
        'This grants access to all host devices and removes all Linux capability restrictions.',
    });
  }

  // Portainer list responses do not expose CapDrop directly; infer missing cap_drop: ALL
  // when a container adds capabilities or runs privileged.
  if (isPrivileged || capAdd.length > 0) {
    findings.push({
      severity: isPrivileged ? 'critical' : 'warning',
      category: 'cap-drop-missing',
      title: `Container "${name}" may be missing cap_drop: ALL hardening`,
      description:
        'This container runs privileged or adds Linux capabilities. In Portainer list responses, ' +
        'CapDrop is not exposed, so treat this as a hardening signal and verify cap_drop: ALL is set.',
    });
  }

  if (container.HostConfig?.NetworkMode === 'host') {
    findings.push({
      severity: 'warning',
      category: 'host-network',
      title: `Container "${name}" using host network mode`,
      description:
        'Host network mode removes network isolation between the container and the host. ' +
        'The container shares the host network namespace, which may expose internal services.',
    });
  }

  if (container.HostConfig?.PidMode === 'host') {
    findings.push({
      severity: 'warning',
      category: 'host-pid',
      title: `Container "${name}" using host PID namespace`,
      description:
        'Sharing the host PID namespace allows the container to see and potentially interact with ' +
        'all processes on the host system, which is a security risk.',
    });
  }

  for (const cap of capAdd) {
    if (DANGEROUS_CAPABILITIES.includes(cap as typeof DANGEROUS_CAPABILITIES[number])) {
      findings.push({
        severity: cap === 'SYS_ADMIN' ? 'critical' : 'warning',
        category: 'dangerous-capability',
        title: `Container "${name}" has dangerous capability: ${cap}`,
        description:
          `The ${cap} capability grants elevated privileges that could be exploited. ` +
          'Consider removing this capability unless absolutely required by the application.',
      });
    }
  }

  return findings;
}

export function scanContainer(container: Container): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const name = container.Names?.[0]?.replace(/^\//, '') || container.Id.slice(0, 12);
  findings.push(...scanCapabilityPosture(container));

  // Check for running as root (via labels)
  const userLabel = container.Labels?.['com.docker.compose.container-number'];
  const runAsRoot =
    container.Labels?.['org.opencontainers.image.run-as-root'] === 'true' ||
    container.Labels?.['run-as-root'] === 'true';
  if (runAsRoot) {
    findings.push({
      severity: 'warning',
      category: 'root-user',
      title: `Container "${name}" is configured to run as root`,
      description:
        'Running containers as root increases the attack surface. ' +
        'If the container is compromised, the attacker gains root-level access. ' +
        'Consider using a non-root user in the Dockerfile.',
    });
  }

  // Check for missing health checks
  const hasHealthCheck =
    container.Labels?.['com.docker.compose.healthcheck'] !== undefined ||
    container.State === 'running';
  // Docker reports health status in the Status field when a health check is configured
  const statusStr = container.Status || '';
  const hasHealthStatus =
    statusStr.includes('(healthy)') ||
    statusStr.includes('(unhealthy)') ||
    statusStr.includes('(health:');
  if (container.State === 'running' && !hasHealthStatus) {
    findings.push({
      severity: 'info',
      category: 'missing-healthcheck',
      title: `Container "${name}" has no health check configured`,
      description:
        'Without a health check, Docker cannot automatically detect if the application inside ' +
        'the container is functioning correctly. Add a HEALTHCHECK instruction to the Dockerfile ' +
        'or configure it in the compose file.',
    });
  }

  // Check for PID mode host
  if (container.HostConfig?.PidMode === 'host') {
    findings.push({
      severity: 'warning',
      category: 'host-pid',
      title: `Container "${name}" using host PID namespace`,
      description:
        'Sharing the host PID namespace allows the container to see and potentially interact with ' +
        'all processes on the host system, which is a security risk.',
    });
  }

  if (findings.length > 0) {
    log.debug({ container: name, findingCount: findings.length }, 'Security scan completed');
  }

  return findings;
}
