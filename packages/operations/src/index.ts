// Routes are NOT re-exported from this barrel (core/src/CLAUDE.md rule).
// Register them via `@dashboard/operations/routes/index.js` in the composition
// root (#1533).

// Services
export { suggestAction, approveAction, rejectAction, initRemediationDeps } from './services/remediation-service.js';
export { notifyInsight, cleanOldNotificationLog } from './services/notification-service.js';
export {
  startWebhookListener,
  stopWebhookListener,
  processRetries,
  cleanOldWebhookDeliveries,
} from './services/webhook-service.js';
export {
  createPortainerBackup,
  cleanupOldPortainerBackups,
} from './services/portainer-backup.js';

// Sockets
export { setupRemediationNamespace, remediationThrottle } from './sockets/remediation.js';
