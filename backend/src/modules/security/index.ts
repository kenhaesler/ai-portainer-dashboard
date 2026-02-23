// modules/security — Public API barrel export
// Only these exports may be used by other modules.

// Security scanning
export { scanContainer, scanCapabilityPosture } from './services/security-scanner.js';
export type { SecurityFinding, CapabilityFinding, CapabilityPosture } from './services/security-scanner.js';

// Security audit
export {
  getSecurityAudit,
  buildSecurityAuditSummary,
  getSecurityAuditIgnoreList,
  setSecurityAuditIgnoreList,
  resolveAuditSeverity,
  isIgnoredContainer,
  SECURITY_AUDIT_IGNORE_KEY,
  DEFAULT_SECURITY_AUDIT_IGNORE_PATTERNS,
} from './services/security-audit.js';
export type { SecurityAuditEntry } from './services/security-audit.js';

// Harbor
export { runFullSync as runHarborSync } from './services/harbor-sync.js';
export { isHarborConfigured, isHarborConfiguredAsync } from './services/harbor-client.js';
export { cleanupOldVulnerabilities } from './services/harbor-vulnerability-store.js';

// PCAP
export { cleanupOldCaptures, cleanupOrphanedSidecars } from './services/pcap-service.js';

// Image staleness
export { runStalenessChecks, getStalenessRecords, getStalenessSummary, parseImageRef } from './services/image-staleness.js';

// Route registration
export { securityRoutes } from './routes/index.js';
