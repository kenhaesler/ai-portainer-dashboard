import type { NormalizedContainer } from '../schemas/container.js';
import type { SecurityFinding } from '../schemas/security-finding.js';

/**
 * Abstract interface for container security scanning.
 * Implemented by security-scanner in @dashboard/security.
 * Injected into monitoring-service to break the ai-intelligence → security import cycle.
 */
export interface SecurityScannerInterface {
  scanContainer(container: NormalizedContainer): SecurityFinding[];
}
