import type { SecurityFinding } from '../schemas/security-finding.js';

/**
 * Minimal structural type for raw Docker container objects passed to security scanner.
 * Matches the shape of the Docker API response (Container from @dashboard/core),
 * but defined here to avoid a contracts → core dependency.
 */
export interface RawContainerLike {
  Id: string;
  Names?: string[];
  Image?: string;
  Labels?: Record<string, string> | null;
  HostConfig?: {
    Privileged?: boolean | null;
    CapAdd?: string[] | null;
    NetworkMode?: string | null;
    PidMode?: string | null;
    ReadonlyRootfs?: boolean | null;
    UsernsMode?: string | null;
    SecurityOpt?: string[] | null;
    Binds?: string[] | null;
  } | null;
  Mounts?: Array<{
    Type?: string;
    Source?: string;
    Mode?: string;
    Name?: string;
  }> | null;
  NetworkSettings?: {
    Networks?: Record<string, unknown> | null;
  } | null;
  // Passthrough for extra fields from Docker API
  [key: string]: unknown;
}

/**
 * Abstract interface for container security scanning.
 * Implemented by security-scanner in @dashboard/security.
 * Injected into monitoring-service to break the ai-intelligence → security import cycle.
 */
export interface SecurityScannerInterface {
  scanContainer(container: RawContainerLike): SecurityFinding[];
}
