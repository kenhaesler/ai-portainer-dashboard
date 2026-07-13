import { z } from 'zod/v4';

const QueryBooleanSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  return value;
}, z.boolean());

// ─── Standard error response ────────────────────────────────────────
export const ErrorResponseSchema = z.object({
  error: z.string(),
});

export const ErrorWithDetailsSchema = ErrorResponseSchema.extend({
  details: z.unknown().optional(),
  message: z.string().optional(),
});

// ─── Success response ───────────────────────────────────────────────
export const SuccessResponseSchema = z.object({
  success: z.boolean(),
});

// ─── Auth schemas ───────────────────────────────────────────────────
export const LoginResponseSchema = z.object({
  token: z.string(),
  username: z.string(),
  expiresAt: z.string(),
  defaultLandingPage: z.string(),
});

export const SessionResponseSchema = z.object({
  username: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
});

export const RefreshResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
});

// Issued by POST /api/auth/stream-ticket. Single-use, short-lived (30s) token
// that EventSource clients pass via ?ticket=… instead of a JWT (#1112).
export const StreamTicketResponseSchema = z.object({
  ticket: z.string(),
  expiresAt: z.string(),
});

// ─── OIDC schemas ───────────────────────────────────────────────────
export const OidcStatusResponseSchema = z.object({
  enabled: z.boolean(),
  authUrl: z.string().optional(),
  state: z.string().optional(),
});

export const OidcCallbackBodySchema = z.object({
  callbackUrl: z.string(),
  state: z.string(),
});

// Returned by GET /api/auth/oidc/effective-redirect-uri (admin-only).
// `source` lets the Settings UI explain to the operator where the value comes
// from: 'env' means DASHBOARD_EXTERNAL_URL is taking precedence and the
// per-setting field is being ignored; 'setting' means only the manual value
// applies; 'none' means neither is configured.
export const OidcEffectiveRedirectUriResponseSchema = z.object({
  redirectUri: z.string(),
  source: z.enum(['env', 'setting', 'none']),
});

// Returned by GET /api/auth/oidc/discovered-groups (admin-only).
// Powers the searchable dropdown in the group-to-role mapping editor.
// user_count is COUNT(DISTINCT user_sub) for the group; last_seen_at is the
// max last_seen_at across all rows for that group.
export const DiscoveredOidcGroupsResponseSchema = z.object({
  groups: z.array(
    z.object({
      group_name: z.string(),
      user_count: z.number().int().nonnegative(),
      last_seen_at: z.string(),
    }),
  ),
});

// ─── Health schemas ─────────────────────────────────────────────────
export const HealthResponseSchema = z.object({
  status: z.string(),
  timestamp: z.string(),
});

export const DependencyCheckSchema = z.object({
  status: z.string(),
  url: z.string().optional(),
  error: z.string().optional(),
});

export const RedactedDependencyCheckSchema = z.object({
  status: z.string(),
});

export const ReadinessResponseSchema = z.object({
  status: z.string(),
  checks: z.object({
    appDb: RedactedDependencyCheckSchema,
    metricsDb: RedactedDependencyCheckSchema,
    portainer: RedactedDependencyCheckSchema,
    llm: RedactedDependencyCheckSchema.optional(),
    redis: RedactedDependencyCheckSchema.optional(),
  }),
  timestamp: z.string(),
});

export const ReadinessDetailResponseSchema = z.object({
  status: z.string(),
  checks: z.object({
    appDb: DependencyCheckSchema,
    metricsDb: DependencyCheckSchema,
    portainer: DependencyCheckSchema,
    llm: DependencyCheckSchema.optional(),
    redis: DependencyCheckSchema.optional(),
  }),
  timestamp: z.string(),
});

// ─── Version schema ──────────────────────────────────────────────────

// ─── Container schemas ──────────────────────────────────────────────
// NOTE: the container/endpoint *shape* schemas (NormalizedContainer/
// NormalizedEndpoint) live in @dashboard/contracts and the live runtime
// interfaces in @dashboard/core/portainer/portainer-normalizers.ts. The dead
// hand-maintained copies that used to live here were removed in #1509; this
// file keeps only the request param/query schemas actually attached to routes.
export const ContainerParamsSchema = z.object({
  endpointId: z.coerce.number(),
  containerId: z.string(),
});

export const EndpointIdQuerySchema = z.object({
  endpointId: z.coerce.number().optional(),
});

// ─── Endpoint schemas ───────────────────────────────────────────────
// NormalizedEndpoint shape schema removed in #1509 (see the container note
// above) — it was a dead copy that had drifted from the live normalizer.
export const EndpointIdParamsSchema = z.object({
  id: z.coerce.number(),
});

// ─── Stack schemas ──────────────────────────────────────────────────
export const NormalizedStackSchema = z.object({
  id: z.number(),
  name: z.string(),
  status: z.string(),
  endpointId: z.number(),
  type: z.string(),
  creationDate: z.number().optional(),
  env: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
});

export const StackIdParamsSchema = z.object({
  id: z.coerce.number(),
});

// ─── Metrics schemas ────────────────────────────────────────────────
export const MetricsQuerySchema = z.object({
  metricType: z.enum(['cpu', 'memory', 'memory_bytes']).optional(),
  timeRange: z.string().optional(),
  metric_type: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const MetricsResponseSchema = z.object({
  containerId: z.string(),
  endpointId: z.number(),
  metricType: z.string(),
  timeRange: z.string(),
  data: z.array(z.object({
    timestamp: z.string(),
    value: z.number(),
  })),
});

export const AnomaliesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(50),
});

// Response envelope for GET /api/metrics/anomalies. Declaring it locks the
// contract (the frontend consumes `{ anomalies: [...] }`) and lets
// fast-json-stringify prune to exactly these projected columns instead of
// serialising whole raw metric rows.
export const AnomaliesResponseSchema = z.object({
  anomalies: z.array(z.object({
    endpoint_id: z.number(),
    container_id: z.string(),
    container_name: z.string(),
    metric_type: z.string(),
    value: z.number(),
    timestamp: z.string(),
  })),
});

// ─── Monitoring schemas ─────────────────────────────────────────────
export const InsightsQuerySchema = z.object({
  severity: z.enum(['critical', 'warning', 'info']).optional(),
  acknowledged: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(50),
  offset: z.coerce.number().default(0),
  cursor: z.string().optional(),
});

export const InsightIdParamsSchema = z.object({
  id: z.string(),
});

// ─── Remediation schemas ────────────────────────────────────────────
export const RemediationQuerySchema = z.object({
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(50),
  offset: z.coerce.number().default(0),
});

export const ActionIdParamsSchema = z.object({
  id: z.string(),
});

export const RejectBodySchema = z.object({
  reason: z.string().optional(),
});

// ─── Traces schemas ─────────────────────────────────────────────────
export const TracesQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  serviceName: z.string().optional(),
  status: z.string().optional(),
  source: z.string().optional(),
  minDuration: z.coerce.number().optional(),
  httpMethod: z.string().optional(),
  httpRoute: z.string().optional(),
  httpRouteMatch: z.enum(['exact', 'contains']).optional(),
  httpStatusCode: z.coerce.number().optional(),
  serviceNamespace: z.string().optional(),
  serviceNamespaceMatch: z.enum(['exact', 'contains']).optional(),
  serviceInstanceId: z.string().optional(),
  serviceVersion: z.string().optional(),
  deploymentEnvironment: z.string().optional(),
  containerId: z.string().optional(),
  containerName: z.string().optional(),
  containerNameMatch: z.enum(['exact', 'contains']).optional(),
  k8sNamespace: z.string().optional(),
  k8sNamespaceMatch: z.enum(['exact', 'contains']).optional(),
  k8sPodName: z.string().optional(),
  k8sContainerName: z.string().optional(),
  serverAddress: z.string().optional(),
  serverPort: z.coerce.number().optional(),
  clientAddress: z.string().optional(),
  urlFull: z.string().optional(),
  urlFullMatch: z.enum(['exact', 'contains']).optional(),
  urlScheme: z.string().optional(),
  networkTransport: z.string().optional(),
  networkProtocolName: z.string().optional(),
  networkProtocolVersion: z.string().optional(),
  netPeerName: z.string().optional(),
  netPeerNameMatch: z.enum(['exact', 'contains']).optional(),
  netPeerPort: z.coerce.number().optional(),
  hostName: z.string().optional(),
  hostNameMatch: z.enum(['exact', 'contains']).optional(),
  osType: z.string().optional(),
  processPid: z.coerce.number().optional(),
  processExecutableName: z.string().optional(),
  processExecutableNameMatch: z.enum(['exact', 'contains']).optional(),
  processCommand: z.string().optional(),
  processCommandMatch: z.enum(['exact', 'contains']).optional(),
  telemetrySdkName: z.string().optional(),
  telemetrySdkLanguage: z.string().optional(),
  telemetrySdkVersion: z.string().optional(),
  otelScopeName: z.string().optional(),
  otelScopeVersion: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(50),
});

export const TraceIdParamsSchema = z.object({
  traceId: z.string(),
});

// ─── Backup schemas ─────────────────────────────────────────────────
export const FilenameParamsSchema = z.object({
  filename: z
    .string()
    .regex(/^[A-Za-z0-9._-]+\.(db|dump)$/, 'filename must be a .db or .dump file without path separators'),
});

export const PortainerBackupFilenameParamsSchema = z.object({
  filename: z
    .string()
    .regex(/^[A-Za-z0-9._-]+\.tar\.gz$/, 'filename must be a .tar.gz file without path separators'),
});

// ─── Settings schemas ───────────────────────────────────────────────
export const SettingsQuerySchema = z.object({
  category: z.string().optional(),
});

export const SettingKeyParamsSchema = z.object({
  key: z.string(),
});

export const SettingUpdateBodySchema = z.object({
  value: z.string(),
  category: z.string().optional(),
});

export const PreferencesResponseSchema = z.object({
  defaultLandingPage: z.string(),
});

export const PreferencesUpdateBodySchema = z.object({
  defaultLandingPage: z.string(),
});

export const AuditLogQuerySchema = z.object({
  action: z.string().optional(),
  userId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().default(0),
  cursor: z.string().optional(),
});

// ─── Logs schemas ───────────────────────────────────────────────────
export const LogsSearchQuerySchema = z.object({
  query: z.string().max(500).optional(),
  hostname: z.string().optional(),
  level: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

export const LogsTestBodySchema = z.object({
  endpoint: z.string().url(),
  apiKey: z.string().optional(),
  verifySsl: z.coerce.boolean().optional().default(true),
});

// ─── Images schemas ─────────────────────────────────────────────────
export const NormalizedImageSchema = z.object({
  id: z.string(),
  name: z.string(),
  tags: z.array(z.string()),
  size: z.number(),
  created: z.number(),
  endpointId: z.number(),
  endpointName: z.string().optional(),
  registry: z.string(),
});

// ─── Container Logs schemas ─────────────────────────────────────────
export const ContainerLogsQuerySchema = z.object({
  tail: z.coerce.number().int().min(1).max(10000).default(100),
  since: z.coerce.number().optional(),
  until: z.coerce.number().optional(),
  timestamps: QueryBooleanSchema.default(true),
});

export const ContainerLogStreamQuerySchema = z.object({
  since: z.coerce.number().optional(),
  timestamps: QueryBooleanSchema.default(true),
  // Short-lived single-use ticket from POST /api/auth/stream-ticket (#1112).
  // EventSource has no Authorization header; this opaque token replaces the
  // JWT-in-URL pattern and is also scrubbed from nginx access logs by a
  // dedicated log_format on this location (frontend/nginx.conf).
  ticket: z.string().optional(),
});

// ─── Dashboard schemas ──────────────────────────────────────────────
export const DashboardKpisSchema = z.object({
  endpoints: z.number(),
  endpointsUp: z.number(),
  endpointsDown: z.number(),
  running: z.number(),
  stopped: z.number(),
  healthy: z.number(),
  unhealthy: z.number(),
  total: z.number(),
  stacks: z.number(),
});

// ─── Investigation schemas ──────────────────────────────────────────
export const InvestigationsQuerySchema = z.object({
  status: z.enum(['pending', 'gathering', 'analyzing', 'complete', 'failed']).optional(),
  container_id: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(50),
  offset: z.coerce.number().default(0),
});

export const InvestigationIdParamsSchema = z.object({
  id: z.string(),
});

export const InsightIdParamsForInvestigationSchema = z.object({
  insightId: z.string(),
});

// ─── Search schemas ─────────────────────────────────────────────────
export const SearchQuerySchema = z.object({
  query: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(8),
  logLimit: z.coerce.number().int().min(1).max(100).default(8),
  includeLogs: QueryBooleanSchema.optional().default(false),
});

// ─── Notification schemas ───────────────────────────────────────────
export const NotificationHistoryQuerySchema = z.object({
  channel: z.enum(['teams', 'email', 'discord', 'telegram']).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(50),
  offset: z.coerce.number().default(0),
});

export const NotificationTestBodySchema = z.object({
  channel: z.enum(['teams', 'email', 'discord', 'telegram']),
});

// ─── Cache Admin schemas ────────────────────────────────────────────
export const CacheInvalidateQuerySchema = z.object({
  resource: z.enum(['endpoints', 'containers', 'images', 'networks', 'stacks']),
});

// ─── User schemas ─────────────────────────────────────────────────
export const UserIdParamsSchema = z.object({
  id: z.string(),
});

export const UserCreateBodySchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(8).max(128),
  role: z.enum(['viewer', 'operator', 'admin']),
});

export const UserUpdateBodySchema = z.object({
  username: z.string().min(1).max(50).optional(),
  password: z.string().min(8).max(128).optional(),
  role: z.enum(['viewer', 'operator', 'admin']).optional(),
});

// ─── Webhook schemas ──────────────────────────────────────────────
export const WebhookIdParamsSchema = z.object({
  id: z.string(),
});

export const WebhookCreateBodySchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url(),
  secret: z.string().optional(),
  events: z.array(z.string()).min(1),
  enabled: z.boolean().optional(),
  description: z.string().max(500).optional(),
});

export const WebhookUpdateBodySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  url: z.string().url().optional(),
  secret: z.string().optional(),
  events: z.array(z.string()).min(1).optional(),
  enabled: z.boolean().optional(),
  description: z.string().max(500).optional(),
});

export const WebhookDeliveriesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(50),
  offset: z.coerce.number().default(0),
});

// ─── LLM schemas ───────────────────────────────────────────────────
export const LlmQueryBodySchema = z.object({
  query: z.string().min(2),
});

export const LlmModelsQuerySchema = z.object({
  host: z.string().optional(),
});

export const LlmTestConnectionBodySchema = z.object({
  url: z.string().optional(),
  token: z.string().optional(),
  authType: z.enum(['bearer', 'basic']).optional(),
});

export const LlmTestPromptBodySchema = z.object({
  feature: z.string().min(1),
  systemPrompt: z.string().min(1),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
});

export const LlmTracesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional().default(50),
});

export const LlmStatsQuerySchema = z.object({
  hours: z.coerce.number().optional().default(24),
});

// ─── Reports schemas ───────────────────────────────────────────────
export const ReportsQuerySchema = z.object({
  timeRange: z.enum(['24h', '7d', '30d']).optional(),
  endpointId: z.coerce.number().optional(),
  containerId: z.string().max(128).optional(),
  includeInfrastructure: QueryBooleanSchema.optional(),
  excludeInfrastructure: QueryBooleanSchema.optional(),
});

// ─── Response schemas for fleet/dashboard/traces read routes (#1545) ──
//
// These lock the wire envelope for the hottest read endpoints so that
// fastify-type-provider-zod's serializerCompiler (a full Zod parse) prunes
// unknown fields — defence against accidental sensitive-field leaks — and
// catches backend/frontend contract drift at dev time.
//
// IMPORTANT: the serializer runs `safeParse` and STRIPS any key not listed
// here, so each schema enumerates every field the frontend actually reads.
// Enum-like string fields (status/state/source) are modelled as `z.string()`
// (matching the existing MetricsResponseSchema/HealthResponseSchema
// convention) so an unexpected value serialises instead of throwing 500.
// Timestamps come back from pg as ISO strings (global type parser in
// db/postgres.ts + db/timescale.ts), so `z.string()` is correct for them.

/** Edge feature-capability flags (mirrors EdgeCapabilities in portainer-normalizers.ts). */
export const EdgeCapabilitiesSchema = z.object({
  exec: z.boolean(),
  realtimeLogs: z.boolean(),
  liveStats: z.boolean(),
  immediateActions: z.boolean(),
});

/**
 * The live-enriched normalized endpoint — the exact runtime shape produced by
 * `normalizeEndpoint` + `applyLiveDockerInfo` and consumed by the frontend
 * `Endpoint` type (frontend/src/features/containers/hooks/use-endpoints.ts).
 * Distinct from the legacy `NormalizedEndpointSchema` above (which is unused
 * and predates live-fleet enrichment — `type` is a number here, not a string).
 */
export const LiveEndpointSchema = z.object({
  id: z.number(),
  name: z.string(),
  type: z.number(),
  url: z.string(),
  status: z.string(),
  containersRunning: z.number(),
  containersStopped: z.number(),
  totalContainers: z.number(),
  stackCount: z.number(),
  totalCpu: z.number(),
  totalMemory: z.number(),
  isEdge: z.boolean(),
  edgeMode: z.string().nullable(),
  snapshotAge: z.number().nullable(),
  checkInInterval: z.number().nullable(),
  capabilities: EdgeCapabilitiesSchema,
  agentVersion: z.string().optional(),
  lastCheckIn: z.number().optional(),
  snapshotSource: z.string(),
  snapshotFetchedAt: z.number().optional(),
});

export const EndpointsListResponseSchema = z.array(LiveEndpointSchema);

/**
 * Normalized stack wire shape — `normalizeStack` output plus the compose-label
 * fallback rows built in routes/stacks.ts. Matches the frontend `Stack` type
 * (frontend/src/features/containers/hooks/use-stacks.ts).
 */
export const StackResponseSchema = z.object({
  id: z.number(),
  name: z.string(),
  type: z.number(),
  endpointId: z.number(),
  status: z.string(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
  envCount: z.number(),
  source: z.string(),
  containerCount: z.number().optional(),
});

export const StacksListResponseSchema = z.array(StackResponseSchema);

/**
 * Normalized network wire shape — `normalizeNetwork` output. Matches the
 * frontend `Network` type (frontend/src/features/containers/hooks/use-networks.ts).
 */
export const NetworkResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  driver: z.string().optional(),
  scope: z.string().optional(),
  subnet: z.string().optional(),
  gateway: z.string().optional(),
  endpointId: z.number(),
  endpointName: z.string(),
  containers: z.array(z.string()),
});

export const NetworksListResponseSchema = z.array(NetworkResponseSchema);

/** Security-audit rollup surfaced on the dashboard (buildSecurityAuditSummary). */
export const SecurityAuditSummarySchema = z.object({
  totalAudited: z.number(),
  flagged: z.number(),
  ignored: z.number(),
});

/** Per-stack resource aggregate (buildFleetResources → topStacks). */
export const StackResourceUsageSchema = z.object({
  name: z.string(),
  containerCount: z.number(),
  runningCount: z.number(),
  stoppedCount: z.number(),
  cpuPercent: z.number(),
  memoryPercent: z.number(),
  memoryBytes: z.number(),
});

/** One row of KPI history (kpi_snapshots) — snake_case, timestamp is an ISO string. */
export const KpiSnapshotSchema = z.object({
  endpoints: z.number(),
  endpoints_up: z.number(),
  endpoints_down: z.number(),
  running: z.number(),
  stopped: z.number(),
  healthy: z.number(),
  unhealthy: z.number(),
  total: z.number(),
  stacks: z.number(),
  timestamp: z.string(),
});

export const KpiHistoryResponseSchema = z.object({
  snapshots: z.array(KpiSnapshotSchema),
});

// GET /api/dashboard/summary
export const DashboardSummaryResponseSchema = z.object({
  kpis: DashboardKpisSchema,
  security: SecurityAuditSummarySchema,
  timestamp: z.string(),
});

// GET /api/dashboard/resources — partial/failedEndpoints appear only on
// per-endpoint container-fetch failures.
export const DashboardResourcesResponseSchema = z.object({
  fleetCpuPercent: z.number(),
  fleetMemoryPercent: z.number(),
  topStacks: z.array(StackResourceUsageSchema),
  partial: z.boolean().optional(),
  failedEndpoints: z.array(z.string()).optional(),
});

// GET /api/dashboard/full — summary + resources + endpoints in one round-trip.
export const DashboardFullResponseSchema = z.object({
  summary: DashboardSummaryResponseSchema,
  resources: z.object({
    fleetCpuPercent: z.number(),
    fleetMemoryPercent: z.number(),
    topStacks: z.array(StackResourceUsageSchema),
  }),
  endpoints: z.array(LiveEndpointSchema),
  kpiHistory: z.array(KpiSnapshotSchema).optional(),
  partial: z.boolean().optional(),
  failedEndpoints: z.array(z.string()).optional(),
});

// GET /api/traces — root-span list rows. Enumerates exactly the columns the
// SELECT in routes/traces.ts projects; nullable columns are `.nullable()` so
// absent OTLP attributes serialise as null instead of throwing.
export const TraceListItemSchema = z.object({
  trace_id: z.string(),
  root_span: z.string(),
  duration_ms: z.number().nullable(),
  status: z.string(),
  service_name: z.string(),
  start_time: z.string(),
  trace_source: z.string().nullable(),
  http_method: z.string().nullable(),
  http_route: z.string().nullable(),
  http_status_code: z.number().nullable(),
  service_namespace: z.string().nullable(),
  service_instance_id: z.string().nullable(),
  service_version: z.string().nullable(),
  deployment_environment: z.string().nullable(),
  container_id: z.string().nullable(),
  container_name: z.string().nullable(),
  k8s_namespace: z.string().nullable(),
  k8s_pod_name: z.string().nullable(),
  k8s_container_name: z.string().nullable(),
  server_address: z.string().nullable(),
  server_port: z.number().nullable(),
  client_address: z.string().nullable(),
  url_full: z.string().nullable(),
  url_scheme: z.string().nullable(),
  network_transport: z.string().nullable(),
  network_protocol_name: z.string().nullable(),
  network_protocol_version: z.string().nullable(),
  net_peer_name: z.string().nullable(),
  net_peer_port: z.number().nullable(),
  host_name: z.string().nullable(),
  os_type: z.string().nullable(),
  process_pid: z.number().nullable(),
  process_executable_name: z.string().nullable(),
  process_command: z.string().nullable(),
  telemetry_sdk_name: z.string().nullable(),
  telemetry_sdk_language: z.string().nullable(),
  telemetry_sdk_version: z.string().nullable(),
  otel_scope_name: z.string().nullable(),
  otel_scope_version: z.string().nullable(),
  span_count: z.number(),
});

export const TracesListResponseSchema = z.object({
  traces: z.array(TraceListItemSchema),
});

// GET /api/traces/service-map — aggregated service nodes + edges. avgDuration
// is AVG(duration_ms) which is null when a group has no timed spans.
export const ServiceMapResponseSchema = z.object({
  nodes: z.array(z.object({
    id: z.string(),
    name: z.string(),
    callCount: z.number(),
    avgDuration: z.number().nullable(),
    errorRate: z.number(),
  })),
  edges: z.array(z.object({
    source: z.string(),
    target: z.string(),
    callCount: z.number(),
    avgDuration: z.number().nullable(),
  })),
});

// GET /api/traces/summary — KPI aggregates (all defaulted to 0 in the handler).
export const TraceSummaryResponseSchema = z.object({
  totalTraces: z.number(),
  avgDuration: z.number(),
  errorRate: z.number(),
  services: z.number(),
  sourceCounts: z.object({
    http: z.number(),
    ebpf: z.number(),
    scheduler: z.number(),
    unknown: z.number(),
  }),
});
