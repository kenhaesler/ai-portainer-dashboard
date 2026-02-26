// Core kernel barrel export — public API for all domain modules
// core/ MUST NOT import from: routes/, services/ (non-core), sockets/, scheduler/

// Config
export { getConfig, resetConfig, setConfigForTest, shannonEntropy } from './config/index.js';
export type { EnvConfig } from './config/index.js';

// Utils
export { logger, createChildLogger } from './utils/logger.js';
export { hashPassword, comparePassword, signJwt, verifyJwt } from './utils/crypto.js';
export { sanitize } from './utils/log-sanitizer.js';
export { validateOutboundWebhookUrl } from './utils/network-security.js';

// DB
export { getAppDb, closeAppDb, isAppDbReady, isAppDbHealthy } from './db/postgres.js';
export { getMetricsDb, getReportsDb, closeMetricsDb, closeReportsDb, isMetricsDbReady, isMetricsDbHealthy } from './db/timescale.js';
export { getDbForDomain } from './db/app-db-router.js';
export { PostgresAdapter } from './db/postgres-adapter.js';
export type { AppDb, QueryResult } from './db/app-db.js';

// Tracing
export { getCurrentTraceContext, runWithTraceContext, withSpan } from './tracing/trace-context.js';
export { insertSpan, insertSpans, getTrace, getTraces, getServiceMap } from './tracing/trace-store.js';
export { queueSpanForExport, initOtelExporter, shutdownOtelExporter } from './tracing/otel-exporter.js';

// Portainer
export { getEndpoints, getContainers, getContainer, getContainerLogs, getContainerStats } from './portainer/portainer-client.js';
export { cachedFetch, cachedFetchSWR } from './portainer/portainer-cache.js';
export { normalizeEndpoint, normalizeContainer, normalizeStack, normalizeNetwork } from './portainer/portainer-normalizers.js';
export { CircuitBreaker } from './portainer/circuit-breaker.js';

// Core Services
export { getSetting, setSetting, getSettings, getEffectiveLlmConfig } from './services/settings-store.js';
export { createSession, getSession, invalidateSession, refreshSession } from './services/session-store.js';
export { getUserById, getUserByUsername, authenticateUser, hasMinRole } from './services/user-store.js';
export { writeAuditLog, getAuditLogs } from './services/audit-logger.js';
export { eventBus } from './services/typed-event-bus.js';
