import Fastify from 'fastify';
import { readFileSync } from 'node:fs';
import { getConfig } from '@dashboard/core/config/index.js';
import requestTracing from '@dashboard/core/plugins/request-tracing.js';
import corsPlugin from '@dashboard/core/plugins/cors.js';
import rateLimitPlugin from '@dashboard/core/plugins/rate-limit.js';
import swaggerPlugin from '@dashboard/core/plugins/swagger.js';
import authPlugin from '@dashboard/core/plugins/auth.js';
import socketIoPlugin from '@dashboard/core/plugins/socket-io.js';
import compressPlugin from '@dashboard/core/plugins/compress.js';
import securityHeadersPlugin from '@dashboard/core/plugins/security-headers.js';
import cacheControlPlugin from '@dashboard/core/plugins/cache-control.js';
import errorHandlerPlugin from '@dashboard/core/plugins/error-handler.js';
import staticPlugin from '@dashboard/core/plugins/static.js';

// Foundational routes (cross-domain, Portainer API glue)
import {
  healthRoutes,
  authRoutes,
  oidcRoutes,
  dashboardRoutes,
  endpointsRoutes,
  containersRoutes,
  containerLogsRoutes,
  stacksRoutes,
  settingsRoutes,
  imagesRoutes,
  networksRoutes,
  searchRoutes,
  cacheAdminRoutes,
  systemInfoRoutes,
  userRoutes,
  kubernetesRoutes,
} from '@dashboard/foundation';

// Routes from domain packages
import {
  remediationRoutes,
  backupRoutes,
  portainerBackupRoutes,
  logsRoutes,
  notificationRoutes,
  webhookRoutes,
  initRemediationDeps,
} from '@dashboard/operations';
import {
  monitoringRoutes,
  investigationRoutes,
  incidentsRoutes,
  correlationRoutes,
  dedupTelemetryRoutes,
  llmRoutes,
  llmObservabilityRoutes,
  llmFeedbackRoutes,
  mcpRoutes,
  promptProfileRoutes,
  getPromptGuardNearMissTotal,
  initInvestigationDeps,
} from '@dashboard/ai';
import { infrastructureRoutes } from '@dashboard/infrastructure/routes/index.js';
import { securityRoutes } from '@dashboard/security/routes/index.js';
import { observabilityRoutes } from '@dashboard/observability/routes/index.js';

import {
  detectCorrelatedAnomalies,
  findCorrelatedContainers,
  isUndefinedTableError,
  getMetrics,
  getMovingAverage,
  generateForecast,
} from '@dashboard/observability';
import {
  getSecurityAudit,
  getSecurityAuditIgnoreList,
  setSecurityAuditIgnoreList,
  DEFAULT_SECURITY_AUDIT_IGNORE_PATTERNS,
  SECURITY_AUDIT_IGNORE_KEY,
} from '@dashboard/security';

import { buildLlmAdapter, buildMetricsAdapter } from './wiring.js';

function getHttp2Options(): { http2: true; https: { key: Buffer; cert: Buffer; allowHTTP1: true } } | Record<string, never> {
  const enabled = process.env.HTTP2_ENABLED === 'true';
  const certPath = process.env.TLS_CERT_PATH;
  const keyPath = process.env.TLS_KEY_PATH;

  if (enabled && certPath && keyPath) {
    return {
      http2: true,
      https: {
        key: readFileSync(keyPath),
        cert: readFileSync(certPath),
        allowHTTP1: true,
      },
    };
  }
  return {};
}

/**
 * Resolve the `trustProxy` value passed to the Fastify constructor (#1099).
 *
 * Without `trustProxy`, `request.ip` resolves to the docker-bridge IP of the nginx
 * proxy container, collapsing every client into one rate-limit bucket and audit-log
 * entry. The production stack always runs behind nginx (see `docker/docker-compose.yml`)
 * so the safe default is `trustProxy: true`. Operators on hostile/multi-tenant networks
 * can tighten this by setting `TRUSTED_PROXY_IPS` to a comma-separated list of IPs or
 * CIDRs (e.g. `127.0.0.1,10.0.0.0/8`); Fastify forwards the list to `proxy-addr`.
 *
 * Invalid entries are dropped with a warning rather than failing boot — Fastify would
 * silently ignore them anyway, so visibility-with-best-effort is the conservative path.
 */
export function resolveTrustProxy(value: string | undefined): boolean | string[] {
  if (value === undefined) return true;
  const trimmed = value.trim();
  if (trimmed === '') return true;

  // Accept IPv4 with optional CIDR mask, plain IPv4, plain IPv6, or IPv6 with mask.
  // Keep the regex deliberately loose: proxy-addr does the authoritative parsing.
  const cidrPattern = /^(?:[0-9a-fA-F:.]+)(?:\/[0-9]+)?$/;
  const entries = trimmed.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
  const valid: string[] = [];
  for (const entry of entries) {
    if (cidrPattern.test(entry)) {
      valid.push(entry);
    } else {
      // eslint-disable-next-line no-console -- emitted before logger is configured
      console.warn(`[trust-proxy] Ignoring invalid TRUSTED_PROXY_IPS entry: ${JSON.stringify(entry)}`);
    }
  }

  if (valid.length === 0) {
    // eslint-disable-next-line no-console -- emitted before logger is configured
    console.warn('[trust-proxy] TRUSTED_PROXY_IPS contained no valid entries; falling back to trustProxy=true');
    return true;
  }
  return valid;
}

/**
 * Pure resolution cascade for the product version. Kept separate from the IO so
 * every branch is unit-testable. First non-blank source wins:
 *   1. `env`  — explicit `APP_VERSION` override (set at build/deploy time).
 *   2. `bakedFile` — contents of the version file baked into the server dist by
 *      the Docker build (the runtime image ships @dashboard/server's
 *      package.json as /app/package.json, so the product version isn't in cwd).
 *   3. `cwdPackageVersion` — version field of the working-dir package.json,
 *      which is the product root in dev (the process runs from the repo root).
 * Falls back to `'unknown'` so a missing source never blocks startup.
 */
export function resolveProductVersion(sources: {
  env?: string;
  bakedFile?: string;
  cwdPackageVersion?: string;
}): string {
  const candidates = [sources.env, sources.bakedFile, sources.cwdPackageVersion];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed;
  }
  return 'unknown';
}

/**
 * Read the product version from its build/runtime sources (see
 * {@link resolveProductVersion}). Each read is guarded so a missing file never
 * throws during startup.
 */
export function readProductVersion(): string {
  let bakedFile: string | undefined;
  try {
    // Baked next to this module by the Docker build (see backend/Dockerfile).
    bakedFile = readFileSync(new URL('./product-version', import.meta.url), 'utf8');
  } catch {
    /* not baked (e.g. local dev) — fall through to the cwd package.json */
  }

  let cwdPackageVersion: string | undefined;
  try {
    const parsed = JSON.parse(readFileSync(`${process.cwd()}/package.json`, 'utf8')) as {
      version?: unknown;
    };
    if (typeof parsed.version === 'string') cwdPackageVersion = parsed.version;
  } catch {
    /* ignore */
  }

  return resolveProductVersion({ env: process.env.APP_VERSION, bakedFile, cwdPackageVersion });
}

export async function buildApp() {
  const isDev = process.env.NODE_ENV !== 'production';
  const app = Fastify({
    ...getHttp2Options(),
    // #1099: Trust X-Forwarded-* headers from upstream proxies so `request.ip`,
    // `request.ips`, and `request.protocol` reflect the real client. Critical for
    // per-client rate limiting (`packages/core/src/plugins/rate-limit.ts`) and audit
    // logging (`packages/core/src/services/audit-logger.ts` callers). Default `true`
    // because the production stack always runs behind nginx; operators can tighten
    // via `TRUSTED_PROXY_IPS` (CIDR allowlist).
    trustProxy: resolveTrustProxy(getConfig().TRUSTED_PROXY_IPS),
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      ...(isDev && {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
      }),
    },
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
  });

  // Core plugins
  await app.register(requestTracing);
  await app.register(compressPlugin);
  await app.register(securityHeadersPlugin);
  await app.register(cacheControlPlugin);
  await app.register(corsPlugin);
  await app.register(rateLimitPlugin);
  await app.register(swaggerPlugin);
  await app.register(authPlugin);
  await app.register(socketIoPlugin);
  // Global error handler — generic 5xx bodies in production (no raw error
  // reflection), validation/4xx errors preserved. See plugin for rationale.
  await app.register(errorHandlerPlugin);

  // Build shared adapters for DI
  const llmAdapter = buildLlmAdapter();
  const metricsAdapter = buildMetricsAdapter();

  initRemediationDeps(llmAdapter, metricsAdapter);

  // Initialize investigation service deps (breaks ai → observability import)
  // Note: InvestigationMetricsDeps.getMetrics uses 4-param string signature (no endpointId, ISO strings)
  initInvestigationDeps({
    getMetrics: (containerId, metricType, from, to) => getMetrics(containerId, metricType, from, to),
    getMovingAverage,
    generateForecast,
  });

  // Routes — foundational (cross-domain, @dashboard/foundation)
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(oidcRoutes);
  await app.register(dashboardRoutes);
  await app.register(endpointsRoutes);
  await app.register(containersRoutes);
  await app.register(containerLogsRoutes);
  await app.register(stacksRoutes);
  await app.register(settingsRoutes);
  await app.register(imagesRoutes);
  await app.register(networksRoutes);
  await app.register(searchRoutes);
  await app.register(cacheAdminRoutes);
  await app.register(systemInfoRoutes, { appVersion: readProductVersion() });
  await app.register(userRoutes);
  await app.register(kubernetesRoutes);

  // Routes — domain packages
  await app.register(monitoringRoutes, {
    getSecurityAudit,
    getSecurityAuditIgnoreList,
    setSecurityAuditIgnoreList,
    defaultSecurityAuditIgnorePatterns: DEFAULT_SECURITY_AUDIT_IGNORE_PATTERNS,
    securityAuditIgnoreKey: SECURITY_AUDIT_IGNORE_KEY,
  });
  await app.register(remediationRoutes);
  await app.register(backupRoutes);
  await app.register(portainerBackupRoutes);
  await app.register(logsRoutes);
  await app.register(investigationRoutes);
  await app.register(notificationRoutes);
  await app.register(webhookRoutes);
  await app.register(incidentsRoutes);
  await app.register(llmRoutes);
  await app.register(llmObservabilityRoutes);
  await app.register(correlationRoutes, {
    detectCorrelatedAnomalies,
    findCorrelatedContainers,
    isUndefinedTableError,
  });
  await app.register(dedupTelemetryRoutes);
  await app.register(mcpRoutes);
  await app.register(promptProfileRoutes);
  await app.register(llmFeedbackRoutes);
  await app.register(infrastructureRoutes);
  await app.register(securityRoutes, { llm: llmAdapter });
  await app.register(observabilityRoutes, { llm: llmAdapter, getPromptGuardNearMissTotal });

  // Static files (production only)
  await app.register(staticPlugin);

  return { app, metricsAdapter };
}
