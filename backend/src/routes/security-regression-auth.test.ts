/**
 * Security Regression — Auth Enforcement / Rate Limiting / OIDC / Proxy Trust
 *
 * Centralised auth-related regression tests:
 *   1. Auth Enforcement Sweep — every /api/* route rejects unauthenticated requests
 *   2. Rate Limiting — login + LLM endpoints
 *   3. Trust Proxy — Fastify trustProxy honours X-Forwarded-For so that rate-limit
 *      buckets and audit-log IPs are the real client IP, not the proxy IP (#1099)
 *   4. OIDC Group-to-Role Mapping — invalid roles rejected, deterministic
 *      highest-privilege-wins, type confusion guards
 *
 * @see https://github.com/kenhaesler/ai-portainer-dashboard/issues/430
 * @see https://github.com/kenhaesler/ai-portainer-dashboard/issues/1188 (split)
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { setConfigForTest, resetConfig } from '@dashboard/core/config/index.js';
import Fastify, { type FastifyInstance, type RouteOptions } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';

// ─── Service Mocks ─────────────────────────────────────────────────────
// Every service imported transitively by any route module must be mocked
// so that route registration succeeds without real DB/network connections.
vi.mock('@dashboard/core/db/app-db-router.js', () => ({
  getDbForDomain: vi.fn(() => ({
    queryOne: vi.fn(async (sql: string) => {
      if (sql.includes('SELECT COUNT(*)')) {
        return { count: 0 };
      }
      return null;
    }),
    query: vi.fn(async () => []),
    execute: vi.fn(async () => ({ changes: 0 })),
    transaction: vi.fn(async (fn: (db: Record<string, unknown>) => Promise<unknown>) => fn({
      execute: vi.fn(async () => ({ changes: 0 })),
      queryOne: vi.fn(async () => null),
      query: vi.fn(async () => []),
    })),
    healthCheck: vi.fn(async () => true),
  })),
}));

vi.mock('@dashboard/core/db/timescale.js', () => ({
  getMetricsDb: vi.fn(() => ({
    query: vi.fn().mockResolvedValue({ rows: [] }),
  })),
  isMetricsDbHealthy: vi.fn().mockResolvedValue(true),
}));

vi.mock('@dashboard/core/utils/crypto.js', async (importOriginal) => await importOriginal());

vi.mock('@dashboard/core/services/session-store.js', () => ({
  createSession: vi.fn(() => ({ id: 'sess-1', user_id: 'u1', username: 'admin' })),
  getSession: vi.fn(() => null),
  invalidateSession: vi.fn(),
  refreshSession: vi.fn(() => null),
}));

vi.mock('@dashboard/core/services/stream-tickets.js', () => ({
  STREAM_TICKET_TTL_MS: 30_000,
  createStreamTicket: vi.fn(),
  consumeStreamTicket: vi.fn(),
  cleanExpiredStreamTickets: vi.fn(),
}));

vi.mock('@dashboard/core/services/audit-logger.js', () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock('@dashboard/core/services/user-store.js', () => ({
  authenticateUser: vi.fn().mockResolvedValue(null),
  ensureDefaultAdmin: vi.fn().mockResolvedValue(undefined),
  getUserDefaultLandingPage: vi.fn(() => '/'),
  setUserDefaultLandingPage: vi.fn(),
  listUsers: vi.fn(() => []),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
  hasMinRole: vi.fn(() => false),
}));

vi.mock('@dashboard/core/services/oidc.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dashboard/core/services/oidc.js')>();
  return {
    ...actual,
    getOIDCConfig: vi.fn(() => null),
    generateAuthorizationUrl: vi.fn().mockResolvedValue(''),
    exchangeCode: vi.fn().mockResolvedValue(null),
  };
});

vi.mock('@dashboard/core/portainer/portainer-client.js', async (importOriginal) => await importOriginal());
vi.mock('@dashboard/core/portainer/portainer-cache.js', async (importOriginal) => await importOriginal());

vi.mock('@dashboard/core/services/settings-store.js', () => ({
  getEffectiveLlmConfig: vi.fn(() => ({
    model: 'llama3.2',
    ollamaUrl: 'http://localhost:11434',
    customEnabled: false,
    customEndpointUrl: '',
    customEndpointToken: '',
  })),
}));

vi.mock('@dashboard/ai', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  const { createLlmTraceStoreMock } = await import('../test-utils/mock-llm.js');
  return {
    ...orig,
    getEffectivePrompt: vi.fn(() => 'You are a dashboard query interpreter.'),
    PROMPT_FEATURES: ['command_palette', 'monitoring_analysis', 'anomaly_explanation', 'incident_summary', 'forecast_narrative', 'correlation_insight'],
    DEFAULT_PROMPTS: {},
    estimateTokens: vi.fn(() => 100),
    ...createLlmTraceStoreMock(),
    PROMPT_TEST_FIXTURES: [],
    connectServer: vi.fn().mockResolvedValue(undefined),
    disconnectServer: vi.fn().mockResolvedValue(undefined),
    getConnectedServers: vi.fn(() => []),
    getServerTools: vi.fn(() => []),
    isConnected: vi.fn(() => false),
    getAllProfiles: vi.fn(() => []),
    getProfileById: vi.fn(() => null),
    createProfile: vi.fn(() => ({ id: '1' })),
    updateProfile: vi.fn(() => null),
    deleteProfile: vi.fn(),
    duplicateProfile: vi.fn(() => ({ id: '2' })),
    getActiveProfileId: vi.fn(() => null),
    switchProfile: vi.fn(),
    getInvestigations: vi.fn(() => []),
    getInvestigation: vi.fn(() => null),
    getInvestigationByInsightId: vi.fn(() => null),
    getIncidents: vi.fn(() => []),
    getIncident: vi.fn(() => null),
    resolveIncident: vi.fn(),
    getIncidentCount: vi.fn(() => 0),
  };
});

vi.mock('@dashboard/security', () => ({
  getSecurityAudit: vi.fn().mockResolvedValue({ findings: [], summary: {} }),
  buildSecurityAuditSummary: vi.fn(() => ({})),
  getSecurityAuditIgnoreList: vi.fn(() => []),
  setSecurityAuditIgnoreList: vi.fn(),
  DEFAULT_SECURITY_AUDIT_IGNORE_PATTERNS: [],
  SECURITY_AUDIT_IGNORE_KEY: 'security_audit_ignore',
  getEndpointCoverage: vi.fn().mockResolvedValue([]),
  updateCoverageStatus: vi.fn().mockResolvedValue(undefined),
  deleteCoverageRecord: vi.fn().mockResolvedValue(true),
  syncEndpointCoverage: vi.fn().mockResolvedValue(undefined),
  verifyCoverage: vi.fn().mockResolvedValue(undefined),
  getCoverageSummary: vi.fn().mockResolvedValue({ total: 0, deployed: 0 }),
  deployBeyla: vi.fn().mockResolvedValue(undefined),
  disableBeyla: vi.fn().mockResolvedValue(undefined),
  enableBeyla: vi.fn().mockResolvedValue(undefined),
  removeBeylaFromEndpoint: vi.fn().mockResolvedValue(undefined),
  deployBeylaBulk: vi.fn().mockResolvedValue([]),
  removeBeylaBulk: vi.fn().mockResolvedValue([]),
  getEndpointOtlpOverride: vi.fn().mockResolvedValue(null),
  setEndpointOtlpOverride: vi.fn().mockResolvedValue(undefined),
  getStalenessRecords: vi.fn().mockResolvedValue([]),
  getStalenessSummary: vi.fn().mockResolvedValue({ total: 0, stale: 0 }),
  runStalenessChecks: vi.fn().mockResolvedValue(undefined),
  startCapture: vi.fn().mockResolvedValue({ id: 'cap-1' }),
  stopCapture: vi.fn().mockResolvedValue(undefined),
  getCaptureById: vi.fn(() => null),
  listCaptures: vi.fn(() => []),
  deleteCaptureById: vi.fn(),
  getCaptureFilePath: vi.fn(() => null),
  analyzeCapture: vi.fn().mockResolvedValue('analysis'),
}));

vi.mock('@dashboard/core/tracing/otlp-protobuf.js', () => ({
  decodeOtlpProtobuf: vi.fn(() => ({ resourceSpans: [] })),
}));

vi.mock('@dashboard/core/tracing/trace-store.js', () => ({
  insertSpans: vi.fn(async () => 0),
}));

vi.mock('@dashboard/operations', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    createWebhook: vi.fn(),
    listWebhooks: vi.fn(() => []),
    getWebhookById: vi.fn(),
    updateWebhook: vi.fn(),
    deleteWebhook: vi.fn(),
    getDeliveriesForWebhook: vi.fn(() => []),
    signPayload: vi.fn(() => 'sig'),
    createPortainerBackup: vi.fn().mockResolvedValue('backup.tar.gz'),
    listPortainerBackups: vi.fn().mockResolvedValue([]),
    getPortainerBackupPath: vi.fn(() => null),
    deletePortainerBackup: vi.fn(),
    sendTestNotification: vi.fn().mockResolvedValue(undefined),
    createBackup: vi.fn().mockResolvedValue('backup.db'),
    listBackups: vi.fn().mockResolvedValue([]),
    deleteBackup: vi.fn(),
    getBackupPath: vi.fn(() => null),
    broadcastActionUpdate: vi.fn(),
    initRemediationDeps: vi.fn(),
  };
});

vi.mock('@dashboard/core/services/typed-event-bus.js', () => ({
  eventBus: { emit: vi.fn(), on: vi.fn(() => vi.fn()), onAny: vi.fn(() => vi.fn()), emitAsync: vi.fn() },
}));

vi.mock('@dashboard/observability', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    getStatusPageConfig: vi.fn(async () => ({ enabled: false })),
    getOverallUptime: vi.fn(async () => 100),
    getEndpointUptime: vi.fn(async () => []),
    getLatestSnapshot: vi.fn(async () => null),
    getDailyUptimeBuckets: vi.fn(async () => []),
    getRecentIncidentsPublic: vi.fn(async () => []),
    getCapacityForecasts: vi.fn().mockResolvedValue([]),
    generateForecast: vi.fn().mockResolvedValue(null),
    lookupContainerName: vi.fn(() => 'test-container'),
    detectCorrelatedAnomalies: vi.fn().mockResolvedValue([]),
    findCorrelatedContainers: vi.fn().mockResolvedValue([]),
    getKpiHistory: vi.fn().mockResolvedValue([]),
    getNetworkRates: vi.fn().mockResolvedValue([]),
    getAllNetworkRates: vi.fn().mockResolvedValue({}),
    selectRollupTable: vi.fn(() => ({ table: 'metrics', timestampCol: 'timestamp', valueCol: 'value', isRollup: false })),
    isUndefinedTableError: vi.fn(() => false),
    getLatestMetrics: vi.fn().mockResolvedValue([]),
    getLatestMetricsBatch: vi.fn().mockResolvedValue({}),
  };
});

vi.mock('@dashboard/infrastructure/services/elasticsearch-config.js', () => ({
  getElasticsearchConfig: vi.fn(() => null),
}));

vi.mock('ollama', async () =>
  (await import('../test-utils/mock-llm.js')).createOllamaMock()
);

// ─── Route Imports ──────────────────────────────────────────────────────
import authPlugin from '@dashboard/core/plugins/auth.js';
import rateLimitPlugin from '@dashboard/core/plugins/rate-limit.js';
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
  userRoutes,
} from '@dashboard/foundation';
import {
  monitoringRoutes,
  investigationRoutes,
  incidentsRoutes,
  llmRoutes,
  llmObservabilityRoutes,
  correlationRoutes,
  mcpRoutes,
  promptProfileRoutes,
  type MonitoringRoutesOpts,
  type CorrelationRoutesOpts,
} from '@dashboard/ai';
import {
  remediationRoutes,
  backupRoutes,
  portainerBackupRoutes,
  logsRoutes,
  notificationRoutes,
  webhookRoutes,
} from '@dashboard/operations';
import { securityRoutes } from '@dashboard/security/routes/index.js';
import type { LLMInterface } from '@dashboard/contracts';
import { edgeJobsRoutes } from '@dashboard/infrastructure/routes/index.js';
import { observabilityRoutes } from '@dashboard/observability/routes/index.js';

import { cache, waitForInFlight } from '@dashboard/core/portainer/portainer-cache.js';
import { flushTestCache, closeTestRedis } from '../test-utils/test-redis-helper.js';
import * as portainerClient from '@dashboard/core/portainer/portainer-client.js';

// ─── Known Public Routes ────────────────────────────────────────────────
// Routes that are intentionally accessible without a Bearer token.
// Fastify auto-adds HEAD for every GET, so include HEAD variants too.
const PUBLIC_ROUTES = new Set([
  'GET /health',
  'HEAD /health',
  'GET /health/ready',
  'HEAD /health/ready',
  'POST /api/auth/login',
  'GET /api/auth/oidc/status',
  'HEAD /api/auth/oidc/status',
  'POST /api/auth/oidc/callback',
  'GET /api/status',
  'HEAD /api/status',
  // /metrics has its own PROMETHEUS_BEARER_TOKEN auth
  'GET /metrics',
  'HEAD /metrics',
  // Trace ingestion has its own TRACES_INGESTION_API_KEY auth
  'POST /api/traces/otlp',
  'POST /api/traces/otlp/v1/traces',
  'POST /api/traces/otlp/v1/metrics',
]);

// ─── Helper: build a Fastify app with all routes ────────────────────────
async function buildFullApp(): Promise<{ app: FastifyInstance; registeredRoutes: string[] }> {
  const registeredRoutes: string[] = [];

  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook('onRoute', (routeOptions: RouteOptions) => {
    const method = Array.isArray(routeOptions.method)
      ? routeOptions.method
      : [routeOptions.method];
    for (const m of method) {
      registeredRoutes.push(`${m} ${routeOptions.url}`);
    }
  });

  // Register auth plugin (real implementation)
  await app.register(authPlugin);

  // Register ALL route modules (same order as app.ts)
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(oidcRoutes);
  await app.register(dashboardRoutes);
  await app.register(endpointsRoutes);
  await app.register(containersRoutes);
  await app.register(containerLogsRoutes);
  await app.register(stacksRoutes);
  const monitoringOpts: MonitoringRoutesOpts = {
    getSecurityAudit: vi.fn().mockResolvedValue([]),
    getSecurityAuditIgnoreList: vi.fn().mockResolvedValue([]),
    setSecurityAuditIgnoreList: vi.fn().mockResolvedValue([]),
    defaultSecurityAuditIgnorePatterns: [],
    securityAuditIgnoreKey: 'security_audit_ignore',
  };
  await app.register(monitoringRoutes, monitoringOpts);
  await app.register(observabilityRoutes);
  await app.register(remediationRoutes);
  await app.register(backupRoutes);
  await app.register(portainerBackupRoutes);
  await app.register(settingsRoutes);
  await app.register(logsRoutes);
  await app.register(imagesRoutes);
  await app.register(networksRoutes);
  await app.register(investigationRoutes);
  await app.register(searchRoutes);
  await app.register(notificationRoutes);
  await app.register(cacheAdminRoutes);
  const mockLlm: LLMInterface = { isAvailable: vi.fn(), chatStream: vi.fn(), getEffectivePrompt: vi.fn(), buildInfrastructureContext: vi.fn() };
  await app.register(securityRoutes, { llm: mockLlm });
  await app.register(webhookRoutes);
  await app.register(userRoutes);
  await app.register(incidentsRoutes);
  await app.register(llmRoutes);
  await app.register(llmObservabilityRoutes);
  const correlationOpts: CorrelationRoutesOpts = {
    detectCorrelatedAnomalies: vi.fn().mockResolvedValue([]),
    findCorrelatedContainers: vi.fn().mockResolvedValue([]),
    isUndefinedTableError: vi.fn(() => false),
  };
  await app.register(correlationRoutes, correlationOpts);
  await app.register(mcpRoutes);
  await app.register(promptProfileRoutes);
  await app.register(edgeJobsRoutes);

  await app.ready();
  return { app, registeredRoutes };
}

// ─── Suite-wide setup ────────────────────────────────────────────────────
beforeAll(async () => {
  // Default spies on portainer-client to prevent real HTTP calls
  vi.spyOn(portainerClient, 'getEndpoints').mockResolvedValue([]);
  vi.spyOn(portainerClient, 'getContainers').mockResolvedValue([]);
  vi.spyOn(portainerClient, 'getImages').mockResolvedValue([]);
  vi.spyOn(portainerClient, 'getStacks').mockResolvedValue([]);
  vi.spyOn(portainerClient, 'restartContainer').mockResolvedValue(undefined);
  vi.spyOn(portainerClient, 'stopContainer').mockResolvedValue(undefined);
  vi.spyOn(portainerClient, 'startContainer').mockResolvedValue(undefined);
  vi.spyOn(portainerClient, 'checkPortainerReachable').mockResolvedValue({ reachable: true, ok: true });
  await cache.clear();
  await flushTestCache();
  setConfigForTest({
    PORTAINER_API_URL: 'http://localhost:9000',
    PORTAINER_VERIFY_SSL: true,
    PORTAINER_CONCURRENCY: 10,
    PORTAINER_MAX_CONNECTIONS: 20,
    OLLAMA_BASE_URL: 'http://localhost:11434',
    OLLAMA_MODEL: 'llama3.2',
    LLM_OPENAI_ENDPOINT: undefined,
    LLM_BEARER_TOKEN: undefined,
    JWT_ALGORITHM: 'HS256',
    MONITORING_ENABLED: false,
    MONITORING_INTERVAL_MINUTES: 5,
    METRICS_COLLECTION_ENABLED: false,
    PROMETHEUS_METRICS_ENABLED: false,
    PROMETHEUS_BEARER_TOKEN: '',
    ANOMALY_ZSCORE_THRESHOLD: 3.0,
    ANOMALY_MOVING_AVERAGE_WINDOW: 30,
    ANOMALY_MIN_SAMPLES: 30,
    ANOMALY_DETECTION_METHOD: 'adaptive',
    ANOMALY_COOLDOWN_MINUTES: 15,
    ANOMALY_THRESHOLD_PCT: 80,
    PREDICTIVE_ALERTING_ENABLED: false,
    ANOMALY_EXPLANATION_ENABLED: false,
    ANOMALY_EXPLANATION_MAX_PER_CYCLE: 20,
    ISOLATION_FOREST_ENABLED: false,
    NLP_LOG_ANALYSIS_ENABLED: false,
    SMART_GROUPING_ENABLED: false,
    INCIDENT_SUMMARY_ENABLED: false,
    INVESTIGATION_ENABLED: false,
    INVESTIGATION_COOLDOWN_MINUTES: 30,
    INVESTIGATION_MAX_CONCURRENT: 2,
    PCAP_ENABLED: false,
    PCAP_MAX_CONCURRENT: 2,
    PCAP_MAX_DURATION_SECONDS: 300,
    PCAP_MAX_FILE_SIZE_MB: 50,
    PCAP_RETENTION_DAYS: 7,
    PCAP_STORAGE_DIR: './data/pcap',
    CACHE_ENABLED: false,
    CACHE_TTL_SECONDS: 900,
    REDIS_URL: undefined,
    REDIS_KEY_PREFIX: 'aidash:cache:',
    TIMESCALE_URL: 'postgresql://localhost/test',
    PORT: 3051,
    LOG_LEVEL: 'fatal' as const,
    POSTGRES_APP_URL: 'postgresql://test:test@localhost:5432/test',
    TEAMS_WEBHOOK_URL: undefined,
    TEAMS_NOTIFICATIONS_ENABLED: false,
    EMAIL_NOTIFICATIONS_ENABLED: false,
    WEBHOOKS_ENABLED: false,
    WEBHOOKS_MAX_RETRIES: 5,
    WEBHOOKS_RETRY_INTERVAL_SECONDS: 60,
    IMAGE_STALENESS_CHECK_ENABLED: false,
    MCP_TOOL_TIMEOUT: 60,
    LLM_MAX_TOOL_ITERATIONS: 10,
    TRACES_INGESTION_ENABLED: false,
    TRACES_INGESTION_API_KEY: '',
    API_RATE_LIMIT: 1200,
    LOGIN_RATE_LIMIT: 5,
    LLM_RATE_LIMIT_PER_MINUTE: 20,
    HTTP2_ENABLED: false,
  });
});

afterAll(async () => {
  resetConfig();
  await closeTestRedis();
});

afterEach(async () => {
  await waitForInFlight();
});

// =====================================================================
//  AUTH ENFORCEMENT SWEEP
// =====================================================================
describe('Auth Enforcement Sweep', () => {
  let app: FastifyInstance;
  let registeredRoutes: string[];

  beforeAll(async () => {
    const result = await buildFullApp();
    app = result.app;
    registeredRoutes = result.registeredRoutes;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should discover a meaningful number of routes', () => {
    // Sanity check: we expect at least 30 route registrations
    expect(registeredRoutes.length).toBeGreaterThanOrEqual(30);
  });

  it('should not return 2xx for any /api/* route without auth', async () => {
    // Collect all unique /api/* routes (excluding known public ones)
    const apiRoutes = registeredRoutes
      .filter(r => r.includes('/api/'))
      .filter(r => !PUBLIC_ROUTES.has(r))
      .filter((r, i, arr) => arr.indexOf(r) === i);

    expect(apiRoutes.length).toBeGreaterThan(0);

    const failures: string[] = [];

    for (const route of apiRoutes) {
      const [method, url] = route.split(' ', 2);

      const resolvedUrl = url
        .replace(':endpointId', '1')
        .replace(':containerId', 'abc123')
        .replace(':id', '1')
        .replace(':stackId', '1')
        .replace(':insightId', '1')
        .replace(':filename', 'test.db')
        .replace(':captureId', 'cap-1')
        .replace(':webhookId', '1')
        .replace(':traceId', 'trace-1');

      const response = await app.inject({
        method: method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD',
        url: resolvedUrl,
        ...(method !== 'GET' && method !== 'DELETE' && method !== 'HEAD'
          ? { payload: {}, headers: { 'content-type': 'application/json' } }
          : {}),
      });

      if (response.statusCode >= 200 && response.statusCode < 300) {
        failures.push(`${route} => ${response.statusCode} (UNPROTECTED)`);
      }
    }

    expect(failures).toEqual([]);
  });

  it('should return non-2xx for GET /api/* routes without auth', async () => {
    const getApiRoutes = registeredRoutes
      .filter(r => r.startsWith('GET /api/'))
      .filter(r => !PUBLIC_ROUTES.has(r))
      .filter((r, i, arr) => arr.indexOf(r) === i);

    expect(getApiRoutes.length).toBeGreaterThan(0);

    const failures: string[] = [];

    for (const route of getApiRoutes) {
      const url = route.split(' ', 2)[1]
        .replace(':endpointId', '1')
        .replace(':containerId', 'abc123')
        .replace(':id', '1')
        .replace(':stackId', '1')
        .replace(':insightId', '1')
        .replace(':filename', 'test.db')
        .replace(':captureId', 'cap-1')
        .replace(':webhookId', '1')
        .replace(':traceId', 'trace-1');

      const response = await app.inject({ method: 'GET', url });
      if (response.statusCode >= 200 && response.statusCode < 300) {
        failures.push(`GET ${url} => ${response.statusCode} (UNPROTECTED)`);
      }
    }

    expect(failures).toEqual([]);
  });

  it('should allow known public routes without auth', async () => {
    const publicChecks = [
      { method: 'GET' as const, url: '/health' },
      { method: 'GET' as const, url: '/health/ready' },
      { method: 'GET' as const, url: '/api/status' },
      { method: 'GET' as const, url: '/api/auth/oidc/status' },
    ];

    for (const { method, url } of publicChecks) {
      const response = await app.inject({ method, url });
      expect(
        response.statusCode,
        `${method} ${url} should be publicly accessible`,
      ).not.toBe(401);
    }
  });
});

// =====================================================================
//  RATE LIMITING VERIFICATION
// =====================================================================
describe('Rate Limiting Verification', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    await app.register(rateLimitPlugin);
    await app.register(authPlugin);
    await app.register(authRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('should enforce LOGIN_RATE_LIMIT on /api/auth/login', async () => {
    const loginRateLimit = 5; // From mock config

    let rateLimitedResponse = null;
    for (let i = 0; i <= loginRateLimit; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'admin', password: 'wrong-password' },
        headers: { 'content-type': 'application/json' },
      });
      if (res.statusCode === 429) {
        rateLimitedResponse = res;
        break;
      }
    }

    expect(rateLimitedResponse).not.toBeNull();
    expect(rateLimitedResponse!.statusCode).toBe(429);
  });

  it('should include retry-after header when rate limited', async () => {
    const loginRateLimit = 5;

    let rateLimitedResponse = null;
    for (let i = 0; i <= loginRateLimit; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'admin', password: 'wrong-password' },
        headers: { 'content-type': 'application/json' },
      });
      if (res.statusCode === 429) {
        rateLimitedResponse = res;
        break;
      }
    }

    expect(rateLimitedResponse).not.toBeNull();
    expect(rateLimitedResponse!.headers['retry-after']).toBeDefined();
  });

  it('should return 429 on LLM /api/llm/query when per-user rate limit exceeded', async () => {
    const llmApp = Fastify({ logger: false });
    llmApp.setValidatorCompiler(validatorCompiler);
    llmApp.setSerializerCompiler(serializerCompiler);

    await llmApp.register(rateLimitPlugin);

    llmApp.decorate('authenticate', async () => undefined);
    llmApp.decorate('requireRole', () => async () => undefined);
    llmApp.decorateRequest('user', undefined);
    llmApp.addHook('preHandler', async (request) => {
      request.user = { sub: 'rate-limit-test-user', username: 'tester', sessionId: 's1', role: 'admin' as const };
    });

    await llmApp.register(llmRoutes);
    await llmApp.ready();

    try {
      const llmRateLimit = 20;
      let rateLimitedResponse = null;

      for (let i = 0; i <= llmRateLimit; i++) {
        const res = await llmApp.inject({
          method: 'POST',
          url: '/api/llm/query',
          payload: { query: 'show running containers' },
          headers: { 'content-type': 'application/json' },
        });
        if (res.statusCode === 429) {
          rateLimitedResponse = res;
          break;
        }
      }

      expect(rateLimitedResponse).not.toBeNull();
      expect(rateLimitedResponse!.statusCode).toBe(429);
      expect(rateLimitedResponse!.headers['retry-after']).toBeDefined();
    } finally {
      await llmApp.close();
    }
  });
});

// ─── Trust Proxy & Client IP Identification (#1099) ───────────────────
// Validates that Fastify is constructed with `trustProxy` enabled so that
// `request.ip` reflects the real client IP from `X-Forwarded-For`, not the
// docker-bridge IP of the upstream nginx proxy. Without trustProxy, both
// rate-limit buckets and audit-log IP fields collapse to the proxy IP.
describe('Trust Proxy & Client IP Identification', () => {
  it('request.ip reflects X-Forwarded-For when trustProxy is enabled', async () => {
    const app = Fastify({ logger: false, trustProxy: true });
    app.get('/test/echo-ip', async (request) => ({ ip: request.ip }));
    await app.ready();

    try {
      const res = await app.inject({
        method: 'GET',
        url: '/test/echo-ip',
        headers: { 'x-forwarded-for': '203.0.113.42' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { ip: string };
      expect(body.ip).toBe('203.0.113.42');
      expect(body.ip).not.toBe('127.0.0.1');
    } finally {
      await app.close();
    }
  });

  it('request.ip falls back to remote address when trustProxy is disabled (regression baseline)', async () => {
    const app = Fastify({ logger: false /* trustProxy intentionally omitted */ });
    app.get('/test/echo-ip', async (request) => ({ ip: request.ip }));
    await app.ready();

    try {
      const res = await app.inject({
        method: 'GET',
        url: '/test/echo-ip',
        headers: { 'x-forwarded-for': '203.0.113.42' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { ip: string };
      expect(body.ip).toBe('127.0.0.1');
    } finally {
      await app.close();
    }
  });

  it('rate limiter buckets correctly by client IP, not proxy IP', async () => {
    const TEST_LIMIT = 3;
    setConfigForTest({ API_RATE_LIMIT: TEST_LIMIT });

    try {
      const app = Fastify({ logger: false, trustProxy: true });
      await app.register(rateLimitPlugin);
      app.get('/throttled', async () => ({ ok: true }));
      await app.ready();

      try {
        const send = (xff: string) =>
          app.inject({ method: 'GET', url: '/throttled', headers: { 'x-forwarded-for': xff } });

        for (let i = 0; i < TEST_LIMIT; i++) {
          const ok = await send('198.51.100.1');
          expect(ok.statusCode).toBe(200);
        }
        const aBlocked = await send('198.51.100.1');
        expect(aBlocked.statusCode).toBe(429);

        const bFirst = await send('198.51.100.2');
        expect(bFirst.statusCode).toBe(200);

        for (let i = 1; i < TEST_LIMIT; i++) {
          const ok = await send('198.51.100.2');
          expect(ok.statusCode).toBe(200);
        }
        const bBlocked = await send('198.51.100.2');
        expect(bBlocked.statusCode).toBe(429);

        const aStillBlocked = await send('198.51.100.1');
        expect(aStillBlocked.statusCode).toBe(429);
      } finally {
        await app.close();
      }
    } finally {
      // Restore the API_RATE_LIMIT the suite-level beforeAll set.
      setConfigForTest({ API_RATE_LIMIT: 1200 });
    }
  });

  it('handler-observed request.ip matches X-Forwarded-For (audit-logger input contract)', async () => {
    const observed: { ip: string | undefined } = { ip: undefined };
    const app = Fastify({ logger: false, trustProxy: true });
    app.post('/audited-action', async (request) => {
      observed.ip = request.ip;
      return { ok: true };
    });
    await app.ready();

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/audited-action',
        headers: { 'x-forwarded-for': '203.0.113.99', 'content-type': 'application/json' },
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      expect(observed.ip).toBe('203.0.113.99');
      expect(observed.ip).not.toBe('127.0.0.1');
    } finally {
      await app.close();
    }
  });
});

// ─── OIDC Group Mapping Security ──────────────────────────────────────
// Validates that OIDC group-to-role mapping is secure:
//   - Invalid role values are rejected
//   - Group claim values are validated as string arrays
//   - Highest-privilege-wins prevents accidental privilege escalation from ordering
describe('OIDC Group-to-Role Mapping Security', () => {
  let resolveRoleFromGroups: typeof import('@dashboard/core/services/oidc.js').resolveRoleFromGroups;
  let extractGroups: typeof import('@dashboard/core/services/oidc.js').extractGroups;

  beforeAll(async () => {
    const oidc = await import('@dashboard/core/services/oidc.js');
    resolveRoleFromGroups = oidc.resolveRoleFromGroups;
    extractGroups = oidc.extractGroups;
  });

  it('should reject invalid role values in mappings and not assign them', () => {
    const result = resolveRoleFromGroups(
      ['HackerGroup'],
      { 'HackerGroup': 'superadmin' as never },
    );
    expect(result).toBeUndefined();
  });

  it('should not allow script injection via group names to affect role resolution', () => {
    const result = resolveRoleFromGroups(
      ['<script>alert(1)</script>'],
      { '<script>alert(1)</script>': 'admin' },
    );
    // Group names are treated as opaque strings — the mapping works but the
    // role must still be a valid enum value. This test ensures we don't crash.
    expect(result).toBe('admin');
  });

  it('should filter non-string values from groups claim to prevent type confusion', () => {
    const claims = {
      groups: ['Admins', { role: 'admin' }, ['nested'], 42, true, null],
    };
    const groups = extractGroups(claims as unknown as Record<string, unknown>, 'groups');
    expect(groups).toEqual(['Admins']);
  });

  it('should not resolve role when groups claim is a string instead of array', () => {
    const claims = { groups: 'admin' };
    const groups = extractGroups(claims as unknown as Record<string, unknown>, 'groups');
    expect(groups).toEqual([]);
  });

  it('should ensure highest-privilege-wins is deterministic regardless of input order', () => {
    const mappings = {
      'Viewers': 'viewer' as const,
      'Operators': 'operator' as const,
      'Admins': 'admin' as const,
    };

    expect(resolveRoleFromGroups(['Viewers', 'Operators', 'Admins'], mappings)).toBe('admin');
    expect(resolveRoleFromGroups(['Admins', 'Viewers', 'Operators'], mappings)).toBe('admin');
    expect(resolveRoleFromGroups(['Operators', 'Admins', 'Viewers'], mappings)).toBe('admin');
  });

  it('should not allow wildcard to escalate above explicit matches', () => {
    const result = resolveRoleFromGroups(
      ['ViewersOnly'],
      { 'ViewersOnly': 'viewer', '*': 'admin' },
    );
    // Explicit match 'viewer' should be used; wildcard is only for unmatched groups
    expect(result).toBe('viewer');
  });

  // ─── Nested Group Claim Security (Regression for issue: groups always empty) ──
  // Ensures extractGroups handles nested claim paths and the realm_access.roles
  // fallback without crashing or silently dropping groups.
  describe('OIDC Nested Group Claim Extraction', () => {
    it('should extract groups from realm_access.roles when groups_claim is realm_access.roles', () => {
      const claims = { realm_access: { roles: ['G-Konzern-Docker-Portainer-Admin'] } };
      const groups = extractGroups(claims as Record<string, unknown>, 'realm_access.roles');
      expect(groups).toEqual(['G-Konzern-Docker-Portainer-Admin']);
    });

    it('should fall back to realm_access.roles when groups_claim is groups and flat claim is missing', () => {
      const claims = { realm_access: { roles: ['G-Konzern-Docker-Portainer-Admin'] } };
      const groups = extractGroups(claims, 'groups');
      expect(groups).toEqual(['G-Konzern-Docker-Portainer-Admin']);
    });

    it('should not use realm_access.roles fallback when flat groups claim is an empty array', () => {
      const claims = { groups: [], realm_access: { roles: ['SomeGroup'] } };
      const groups = extractGroups(claims, 'groups');
      expect(groups).toEqual([]);
    });

    it('should support arbitrary dot-notation nested paths', () => {
      const claims = { deep: { nested: { path: ['Group-A', 'Group-B'] } } };
      const groups = extractGroups(claims as Record<string, unknown>, 'deep.nested.path');
      expect(groups).toEqual(['Group-A', 'Group-B']);
    });

    it('should safely handle nested path where intermediate value is not an object', () => {
      const claims = { realm_access: 'not-an-object' };
      const groups = extractGroups(claims as Record<string, unknown>, 'realm_access.roles');
      expect(groups).toEqual([]);
    });

    it('should not allow nested group extraction to bypass role validation', () => {
      const claims = { realm_access: { roles: ['G-Admin'] } };
      const groups = extractGroups(claims, 'realm_access.roles');
      const role = resolveRoleFromGroups(groups, { 'G-Admin': 'superadmin' as never });
      expect(role).toBeUndefined();
    });
  });
});
