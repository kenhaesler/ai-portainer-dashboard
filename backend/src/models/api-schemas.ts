import { z } from 'zod';

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

export const ReadinessResponseSchema = z.object({
  status: z.string(),
  checks: z.object({
    database: DependencyCheckSchema,
    portainer: DependencyCheckSchema,
    ollama: DependencyCheckSchema,
  }),
  timestamp: z.string(),
});

// ─── Container schemas ──────────────────────────────────────────────
export const NormalizedContainerSchema = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string(),
  state: z.string(),
  status: z.string(),
  endpointId: z.number(),
  endpointName: z.string(),
  ports: z.array(z.object({
    private: z.number().optional(),
    public: z.number().optional(),
    type: z.string().optional(),
  })),
  created: z.number(),
  labels: z.record(z.string()),
  networks: z.array(z.string()),
  healthStatus: z.string().optional(),
});

export const ContainerParamsSchema = z.object({
  endpointId: z.coerce.number(),
  containerId: z.string(),
});

export const EndpointIdQuerySchema = z.object({
  endpointId: z.coerce.number().optional(),
});

// ─── Endpoint schemas ───────────────────────────────────────────────
export const NormalizedEndpointSchema = z.object({
  id: z.number(),
  name: z.string(),
  type: z.string(),
  url: z.string(),
  status: z.string(),
  containersRunning: z.number(),
  containersStopped: z.number(),
  containersHealthy: z.number(),
  containersUnhealthy: z.number(),
  totalContainers: z.number(),
  stackCount: z.number(),
  agentVersion: z.string().optional(),
});

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
  limit: z.coerce.number().default(50),
});

// ─── Monitoring schemas ─────────────────────────────────────────────
export const InsightsQuerySchema = z.object({
  severity: z.enum(['critical', 'warning', 'info']).optional(),
  acknowledged: z.coerce.boolean().optional(),
  limit: z.coerce.number().default(50),
  offset: z.coerce.number().default(0),
  cursor: z.string().optional(),
});

export const InsightIdParamsSchema = z.object({
  id: z.string(),
});

// ─── Remediation schemas ────────────────────────────────────────────
export const RemediationQuerySchema = z.object({
  status: z.string().optional(),
  limit: z.coerce.number().default(50),
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
  minDuration: z.coerce.number().optional(),
  limit: z.coerce.number().default(50),
});

export const TraceIdParamsSchema = z.object({
  traceId: z.string(),
});

// ─── Backup schemas ─────────────────────────────────────────────────
export const FilenameParamsSchema = z.object({
  filename: z
    .string()
    .regex(/^[A-Za-z0-9._-]+\.db$/, 'filename must be a .db file without path separators'),
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
  category: z.string().default('general'),
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
  limit: z.coerce.number().default(100),
  offset: z.coerce.number().default(0),
  cursor: z.string().optional(),
});

// ─── Logs schemas ───────────────────────────────────────────────────
export const LogsSearchQuerySchema = z.object({
  query: z.string().optional(),
  hostname: z.string().optional(),
  level: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().default(100),
});

export const LogsTestBodySchema = z.object({
  endpoint: z.string(),
  apiKey: z.string().optional(),
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
  tail: z.coerce.number().default(100),
  since: z.coerce.number().optional(),
  until: z.coerce.number().optional(),
  timestamps: z.coerce.boolean().default(true),
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
  limit: z.coerce.number().default(50),
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
  limit: z.coerce.number().default(8),
  logLimit: z.coerce.number().default(8),
});

// ─── Notification schemas ───────────────────────────────────────────
export const NotificationHistoryQuerySchema = z.object({
  channel: z.enum(['teams', 'email']).optional(),
  limit: z.coerce.number().default(50),
  offset: z.coerce.number().default(0),
});

export const NotificationTestBodySchema = z.object({
  channel: z.enum(['teams', 'email']),
});

// ─── Cache Admin schemas ────────────────────────────────────────────
export const CacheInvalidateQuerySchema = z.object({
  resource: z.enum(['endpoints', 'containers', 'images', 'networks', 'stacks']),
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
  ollamaUrl: z.string().optional(),
});

export const LlmTracesQuerySchema = z.object({
  limit: z.coerce.number().optional().default(50),
});

export const LlmStatsQuerySchema = z.object({
  hours: z.coerce.number().optional().default(24),
});

// ─── Reports schemas ───────────────────────────────────────────────
export const ReportsQuerySchema = z.object({
  timeRange: z.enum(['24h', '7d', '30d']).optional(),
  endpointId: z.coerce.number().optional(),
  containerId: z.string().optional(),
});
