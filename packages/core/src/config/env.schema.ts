import { z } from 'zod/v4';

/** Optional URL that treats empty strings as undefined (common in Docker Compose env defaults). */
const optionalUrl = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().url().optional(),
);

/**
 * Boolean env flag. Accepts 'true'/'1' and 'false'/'0' (case-insensitive,
 * trimmed); unset or empty values take the default; any other value logs a
 * warning and falls back to the default (#1492).
 *
 * NEVER use z.coerce.boolean() for env flags: it is Boolean(input), so the
 * strings 'false' and '0' coerce to TRUE and documented kill-switches
 * silently invert (e.g. CACHE_ENABLED=false would keep the cache on).
 */
const boolStr = (defaultValue: boolean) =>
  z.preprocess((v) => {
    if (v === undefined || v === null) return defaultValue;
    if (typeof v === 'boolean') return v;
    const normalized = String(v).trim().toLowerCase();
    if (normalized === '') return defaultValue;
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
    console.warn(
      `[env] Unrecognized boolean value ${JSON.stringify(v)} (expected 'true'/'1'/'false'/'0'); falling back to default ${defaultValue}`,
    );
    return defaultValue;
  }, z.boolean());

export const envSchema = z.object({
  // Auth
  DASHBOARD_USERNAME: z.string().min(1),
  DASHBOARD_PASSWORD: z.string().min(12),
  JWT_SECRET: z.string().min(32),
  // JWT signing algorithm: HS256 (symmetric, default), RS256 or ES256 (asymmetric).
  // HS256 is appropriate for single-service architectures. Switch to RS256/ES256 if:
  //   - Multiple backend services need to verify tokens independently
  //   - Token verification moves to edge/proxy layers
  //   - Compliance mandates asymmetric signing
  // When using RS256/ES256, JWT_SECRET is ignored and JWT_PRIVATE_KEY_PATH +
  // JWT_PUBLIC_KEY_PATH must be set to PEM key files.
  JWT_ALGORITHM: z.enum(['HS256', 'RS256', 'ES256']).default('HS256'),
  JWT_PRIVATE_KEY_PATH: z.string().optional(),
  JWT_PUBLIC_KEY_PATH: z.string().optional(),
  // Lifetime (minutes) applied to BOTH the signed JWT `exp` claim AND the
  // PostgreSQL session row's `expires_at`. Single source of truth — keeping
  // them in sync ensures a token never outlives its session and vice versa.
  // Bounds: 5 min (auditable lower bound) → 1440 min (24 h sanity ceiling).
  JWT_TOKEN_EXPIRY_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
  // Max concurrent sessions per user. When exceeded on login, the oldest sessions are
  // atomically evicted to make room for the new one. Eviction runs inside a
  // transaction guarded by a per-user `pg_advisory_xact_lock(hashtext(user_id))` so
  // concurrent logins from the same user serialise and cannot leave more than
  // `MAX_CONCURRENT_SESSIONS_PER_USER` valid sessions; different users do not block
  // each other. See packages/core/src/services/session-store.ts (#1107).
  MAX_CONCURRENT_SESSIONS_PER_USER: z.coerce.number().int().min(1).max(100).default(5),

  // Portainer
  PORTAINER_API_URL: z.string().url().default('http://localhost:9000'),
  PORTAINER_API_KEY: z.string().default(''),
  PORTAINER_VERIFY_SSL: boolStr(true),
  PORTAINER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(30),
  PORTAINER_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(100).default(20),
  PORTAINER_CB_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(50).default(5),
  PORTAINER_CB_RESET_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(30000),

  // Live /docker/info — PRIMARY source for container counts + host CPU/memory on
  // all up Docker endpoints (Portainer's per-endpoint Snapshots[] is no longer
  // written back by edge agents). Env names kept for backward compatibility.
  // ENABLED=false is a hard kill-switch: with no snapshot fallback, endpoints
  // then render as "unavailable" (0 counts).
  EDGE_LIVE_QUERY_ENABLED: boolStr(true),
  EDGE_LIVE_QUERY_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(2),
  EDGE_LIVE_QUERY_INTERVAL_SECONDS: z.coerce.number().int().min(15).max(3600).default(60),
  EDGE_LIVE_QUERY_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(5000),
  // Public/external dashboard URL used by remote agents/endpoints to call back into the API.
  DASHBOARD_EXTERNAL_URL: optionalUrl,

  // LLM (OpenAI-compatible API: OpenAI, LM Studio, vLLM, LiteLLM, OpenWebUI, Anthropic, etc.)
  // Bare base URL is fine — /v1/chat/completions is appended automatically.
  LLM_API_URL: optionalUrl,
  LLM_API_TOKEN: z.string().optional(), // Bearer token or username:password for Basic auth
  LLM_MODEL: z.string().default('gpt-4o-mini'),
  LLM_AUTH_TYPE: z.enum(['bearer', 'basic']).default('bearer'),
  LLM_VERIFY_SSL: boolStr(true),
  LLM_REQUEST_TIMEOUT: z.coerce.number().int().min(5000).max(600000).default(120000),

  // Kibana (optional)
  KIBANA_ENDPOINT: z.string().url().optional(),
  KIBANA_API_KEY: z.string().optional(),

  // Monitoring
  MONITORING_ENABLED: boolStr(true),
  MONITORING_INTERVAL_MINUTES: z.coerce.number().int().min(1).default(5),
  MAX_INSIGHTS_PER_CYCLE: z.coerce.number().int().min(1).max(10000).default(500),
  AI_ANALYSIS_ENABLED: boolStr(true),

  // Metrics Collection
  METRICS_COLLECTION_ENABLED: boolStr(true),
  METRICS_COLLECTION_INTERVAL_SECONDS: z.coerce.number().int().min(10).default(60),
  METRICS_RETENTION_DAYS: z.coerce.number().int().min(1).default(7),
  METRICS_ENDPOINT_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(10),
  METRICS_CONTAINER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(20),
  PROMETHEUS_METRICS_ENABLED: boolStr(false),
  PROMETHEUS_BEARER_TOKEN: z.string().optional(),

  // Anomaly Detection
  ANOMALY_ZSCORE_THRESHOLD: z.coerce.number().min(0.5).default(3.5),
  // Raised 20 → 60 in #1294 (epic #1291). The previous 20-sample window
  // (~20 min at 1-min cadence) reacted too strongly to short-lived spikes
  // such as morning traffic ramps, producing false-positive anomalies for
  // services with daily cycles. 60 samples (~1h) smooths short bursts while
  // preserving sensitivity to sustained shifts.
  ANOMALY_MOVING_AVERAGE_WINDOW: z.coerce.number().int().min(5).default(60),
  ANOMALY_MIN_SAMPLES: z.coerce.number().int().min(3).default(10),
  // Default is robust median+MAD (#1362) — outlier-resistant, so a spike no
  // longer inflates the baseline that should catch it. 'adaptive'/'zscore'/
  // 'bollinger' (mean/std based) remain available for rollback.
  ANOMALY_DETECTION_METHOD: z.enum(['zscore', 'bollinger', 'adaptive', 'robust-mad']).default('robust-mad'),
  // #1361 fix 3 — one-sided detection. Resource/latency metrics flag spikes
  // only by default; a drop below baseline is rarely an incident and flagging
  // it (two-sided) roughly doubled the false-positive rate. 'both' restores
  // the legacy two-sided behaviour.
  ANOMALY_DETECTION_DIRECTION: z.enum(['spike', 'drop', 'both']).default('spike'),
  ANOMALY_COOLDOWN_MINUTES: z.coerce.number().int().min(0).default(30),
  ANOMALY_THRESHOLD_PCT: z.coerce.number().min(50).max(100).default(85),
  ANOMALY_HARD_THRESHOLD_ENABLED: boolStr(true),
  // Alerting discipline (#1363) — M-of-N persistence + multi-window. An anomaly
  // must persist (>= M of the last N cycles) before it is surfaced, suppressing
  // isolated benign blips. A severe single sample (severity >= multiplier ×
  // threshold) takes a short high-burn-rate path and is surfaced immediately so
  // brief hard failures still page (Google SRE multi-window). Set M > N to make
  // only the fast path fire; disable to surface every raw anomaly (legacy).
  ANOMALY_PERSISTENCE_ENABLED: boolStr(true),
  ANOMALY_PERSISTENCE_M: z.coerce.number().int().min(1).default(3),
  ANOMALY_PERSISTENCE_N: z.coerce.number().int().min(1).default(5),
  ANOMALY_FAST_BURN_MULTIPLIER: z.coerce.number().min(1).default(2),
  // Severity × confidence routing (#1363). A confirmed anomaly whose confidence
  // (max of persistence ratio and burn magnitude) is below this surfaces as
  // 'info' — a quieter log tier that does not page — instead of warning/critical.
  // Default 0.7 sits above the 3-of-5 (0.6) confirmation floor, so a barely-
  // persisted low-magnitude anomaly is logged, not paged. 0 surfaces everything.
  ANOMALY_CONFIDENCE_MIN_SURFACE: z.coerce.number().min(0).max(1).default(0.7),
  // System-wide detection-time suppression floor (#1363). A confirmed anomaly
  // whose confidence is below this is DROPPED entirely (never inserted), so the
  // shared insights table, incident correlator, and notifications stay clean for
  // everyone — not just per-user view filtering. Complements the per-user
  // Sensitivity preset (#1297), which remains a read-time filter. Default 0
  // suppresses nothing (the info-tier routing already quiets low confidence);
  // raise it in noisy environments. Severe fast-burn anomalies (confidence 1.0)
  // are never dropped here.
  ANOMALY_SUPPRESS_BELOW_CONFIDENCE: z.coerce.number().min(0).max(1).default(0),
  // Feedback → threshold auto-tune (#1364). A scheduled job measures the real
  // per-detector false-positive rate from operator feedback (#1298) and nudges
  // ANOMALY_ZSCORE_THRESHOLD toward the target rate, one bounded step at a time.
  // OFF by default — auto-mutating a detection threshold is opt-in (observer-
  // first); with the flag off the job still logs what it WOULD change. Every
  // applied change is written to the audit log.
  ANOMALY_AUTOTUNE_ENABLED: boolStr(false),
  ANOMALY_AUTOTUNE_INTERVAL_MINUTES: z.coerce.number().int().min(5).default(360),
  ANOMALY_AUTOTUNE_TARGET_FP_RATE: z.coerce.number().min(0).max(1).default(0.05),
  ANOMALY_AUTOTUNE_MIN_SAMPLES: z.coerce.number().int().min(1).default(20),
  ANOMALY_AUTOTUNE_LOOKBACK_DAYS: z.coerce.number().int().min(1).default(30),
  BOLLINGER_BANDS_ENABLED: boolStr(true),
  // Hour-of-day baseline (issue #1295): compare the recent sample against the
  // baseline for the same hour-of-day across the last N days, rather than a
  // flat 24h baseline. Eliminates false positives during diurnal ramps
  // (morning traffic, nightly batch). Default 14 days mirrors the production
  // observability literature; lower windows are more reactive but noisier.
  ANOMALY_HOUROFDAY_LOOKBACK_DAYS: z.coerce.number().int().min(1).max(60).default(14),
  // Minimum number of samples required in a given hour-of-day bucket before
  // the per-hour baseline kicks in. Below this, the detector falls back to
  // the legacy flat-baseline behavior. Prevents erratic alerts during the
  // warm-up window.
  ANOMALY_HOUROFDAY_MIN_SAMPLES: z.coerce.number().int().min(1).max(100).default(3),
  // Day-of-week × hour-of-day seasonality (#1307, carried over from #1364).
  // Refines the hour-of-day baseline so e.g. Monday 09:00 is compared against
  // previous Mondays 09:00, not every day's 09:00 — catching weekly patterns
  // (weekday vs weekend traffic). The detector tries day-of-week × hour first,
  // falls back to hour-of-day, then to the flat window, so cold-start and sparse
  // weekday buckets degrade gracefully. A wider lookback (default 28d ≈ 4 same-
  // weekday occurrences) is needed for the weekly bucket to be stable. The
  // mean/std path reads this from the metrics_1hour aggregate; the robust path
  // narrows its raw query (median+MAD needs raw samples). On the robust path
  // the lookback is clamped to METRICS_RAW_RETENTION_DAYS (#1527) — the raw
  // hypertable holds nothing older — with a one-time warning when it exceeds
  // retention. MIN_SAMPLES counts DISTINCT same-weekday days (#1527), not raw
  // samples, so one day's samples cannot masquerade as a weekly baseline; at
  // the default 7-day raw retention the weekly bucket therefore stays in
  // warm-up and detection uses the hour-of-day baseline.
  ANOMALY_DAYOFWEEK_ENABLED: boolStr(true),
  ANOMALY_DAYOFWEEK_LOOKBACK_DAYS: z.coerce.number().int().min(7).max(120).default(28),
  ANOMALY_DAYOFWEEK_MIN_SAMPLES: z.coerce.number().int().min(1).max(1000).default(3),
  // Concurrency cap for per-(container × metric) anomaly detection (#1498).
  // Each detection issues 1-3 TimescaleDB window queries; an unbounded fan-out
  // (2 × running containers at once) saturates the shared pool
  // (TIMESCALE_MAX_CONNECTIONS) on large fleets and starves interactive
  // dashboard queries. Mirrors the p-limit pattern used for Portainer fan-outs.
  // Also caps the Isolation Forest per-container pass (#1502).
  ANOMALY_DETECT_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(8),

  // Predictive Alerting
  PREDICTIVE_ALERTING_ENABLED: boolStr(true),
  PREDICTIVE_ALERT_THRESHOLD_HOURS: z.coerce.number().int().min(1).default(24),

  // Anomaly Explanations (LLM)
  ANOMALY_EXPLANATION_ENABLED: boolStr(true),
  ANOMALY_EXPLANATION_MAX_PER_CYCLE: z.coerce.number().int().min(1).max(50).default(5),

  // Isolation Forest Anomaly Detection
  // ISOLATION_FOREST_ENABLED and ISOLATION_FOREST_RETRAIN_HOURS are configurable
  // via Settings UI (ai_tuning.*) and are deprecated as env vars.
  // ISOLATION_FOREST_TREES, ISOLATION_FOREST_SAMPLE_SIZE, and
  // ISOLATION_FOREST_CONTAMINATION are intentionally env-only: they control model
  // structure and changing them at runtime would invalidate cached models without
  // retraining. A restart ensures models are retrained with the new parameters.
  ISOLATION_FOREST_ENABLED: boolStr(true),
  ISOLATION_FOREST_TREES: z.coerce.number().int().min(10).max(500).default(100),
  ISOLATION_FOREST_SAMPLE_SIZE: z.coerce.number().int().min(32).max(512).default(256),
  // Lowered 0.15 → 0.05 in #1294 (epic #1291). The Isolation Forest threshold
  // is calibrated so the top `contamination` fraction of training points are
  // labelled "anomalous"; 0.15 meant ~15% of every stable workload's readings
  // would be flagged by design, double-counting with the z-score detectors.
  // 0.05 aligns with the broader 2.5–3σ z-score regime used elsewhere
  // (~1–2.5% true tail on Gaussian noise).
  ISOLATION_FOREST_CONTAMINATION: z.coerce.number().min(0.01).max(0.5).default(0.05),
  ISOLATION_FOREST_RETRAIN_HOURS: z.coerce.number().int().min(1).default(6),

  // NLP Log Analysis (LLM)
  NLP_LOG_ANALYSIS_ENABLED: boolStr(true),
  NLP_LOG_ANALYSIS_MAX_PER_CYCLE: z.coerce.number().int().min(1).max(20).default(3),
  NLP_LOG_ANALYSIS_TAIL_LINES: z.coerce.number().int().min(10).max(500).default(100),

  // Smart Alert Grouping
  SMART_GROUPING_ENABLED: boolStr(true),
  SMART_GROUPING_SIMILARITY_THRESHOLD: z.coerce.number().min(0.1).max(1.0).default(0.3),
  INCIDENT_SUMMARY_ENABLED: boolStr(true),

  // Investigation (Root Cause Analysis)
  INVESTIGATION_ENABLED: boolStr(true),
  INVESTIGATION_COOLDOWN_MINUTES: z.coerce.number().int().min(1).default(20),
  INVESTIGATION_MAX_CONCURRENT: z.coerce.number().int().min(1).default(2),
  INVESTIGATION_LOG_TAIL_LINES: z.coerce.number().int().min(10).default(50),
  INVESTIGATION_METRICS_WINDOW_MINUTES: z.coerce.number().int().min(5).default(60),
  INVESTIGATION_MIN_SEVERITY: z.enum(['critical', 'warning', 'info']).default('warning'),

  // Packet Capture (PCAP)
  PCAP_ENABLED: boolStr(false),
  PCAP_MAX_DURATION_SECONDS: z.coerce.number().int().min(1).max(3600).default(300),
  PCAP_MAX_FILE_SIZE_MB: z.coerce.number().int().min(1).max(500).default(50),
  PCAP_MAX_CONCURRENT: z.coerce.number().int().min(1).max(10).default(2),
  PCAP_RETENTION_DAYS: z.coerce.number().int().min(1).default(7),
  PCAP_STORAGE_DIR: z.string().default('./data/pcap'),
  PCAP_CAPTURE_IMAGE: z.string().default('alpine:3.21'),
  PCAP_CAPTURE_IMAGE_PULL: z.enum(['always', 'never', 'if-not-present']).default('if-not-present'),

  // Remediation Safety
  REMEDIATION_PROTECTED_CONTAINERS: z.string().optional(),

  // CORS
  // Comma-separated list of fully-qualified origins (protocol://host[:port], no path/trailing slash)
  // permitted to make cross-origin requests in production. Applies to both the REST API
  // (@fastify/cors) and Socket.IO. When unset, production keeps the existing
  // "no cross-origin" default (origin: false). Development uses DEV_ALLOWED_ORIGINS.
  // Example: CORS_ALLOWED_ORIGINS=https://dashboard.example.com,https://admin.example.com
  CORS_ALLOWED_ORIGINS: z
    .string()
    .optional()
    .refine(
      (raw) => {
        if (!raw) return true;
        const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
        const originRegex = /^https?:\/\/[^/\s]+$/;
        return parts.every((p) => originRegex.test(p));
      },
      {
        message:
          'CORS_ALLOWED_ORIGINS entries must be of the form protocol://host[:port] (no path, no trailing slash)',
      },
    ),

  // Cache
  CACHE_ENABLED: boolStr(true),
  CACHE_TTL_SECONDS: z.coerce.number().int().min(10).default(900),
  REDIS_URL: z.string().url().optional(),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_KEY_PREFIX: z.string().default('aidash:cache:'),

  // App PostgreSQL
  POSTGRES_APP_URL: z.string().default('postgresql://app_user:changeme@localhost:5433/portainer_dashboard'),
  POSTGRES_APP_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(200).default(20),

  // TimescaleDB (metrics + KPI storage)
  TIMESCALE_URL: z.string().default('postgresql://metrics_user:changeme@localhost:5432/metrics'),
  TIMESCALE_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(200).default(50),
  TIMESCALE_REPORTS_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(50).default(5),
  // Raw metrics/kpi_snapshots hypertable retention (#1504). METRICS_RETENTION_DAYS
  // is the canonical knob; this optional override exists only for deployments that
  // need the TimescaleDB chunk-drop policy to diverge from it. Unset (default) it
  // follows METRICS_RETENTION_DAYS — see resolveRawMetricsRetentionDays().
  METRICS_RAW_RETENTION_DAYS: z.coerce.number().int().min(1).optional(),
  METRICS_ROLLUP_5MIN_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  METRICS_ROLLUP_1HOUR_RETENTION_DAYS: z.coerce.number().int().min(1).default(90),
  METRICS_ROLLUP_1DAY_RETENTION_DAYS: z.coerce.number().int().min(1).default(365),

  // Server
  PORT: z.coerce.number().int().min(1).max(65535).default(3051),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  // Access-log verbosity (#1552). Fastify's automatic per-request logging is
  // disabled; the request-logging plugin emits one access-log line per request
  // instead. 'true' (default) keeps successful (2xx/3xx) requests at info;
  // 'false' demotes them to debug for quieter production logs. 4xx/5xx always
  // log at warn/error. Health probes, Socket.IO, and static assets are never
  // access-logged.
  LOG_HTTP_SUCCESS: boolStr(true),
  // HTTP/2 (opt-in, requires TLS cert/key)
  HTTP2_ENABLED: boolStr(false),
  TLS_CERT_PATH: z.string().optional(),
  TLS_KEY_PATH: z.string().optional(),
  // Trusted proxy IPs/CIDRs for Fastify trustProxy (#1099). Comma-separated list of
  // IPs or CIDR ranges (e.g., "127.0.0.1,10.0.0.0/8"). When unset, Fastify is started
  // with `trustProxy: true` because the production stack always runs behind nginx (and
  // optionally Traefik) on a private Docker network. Set this in hostile multi-tenant
  // network topologies to restrict which hops may populate `request.ip` from
  // `X-Forwarded-For`. Without trustProxy, rate-limit buckets and audit log IPs would
  // collapse to the proxy IP, defeating per-client throttling.
  TRUSTED_PROXY_IPS: z.string().optional(),
  // HSTS preload (opt-in). When true, the backend appends "; preload" to the
  // Strict-Transport-Security header AND bumps max-age to 63072000 (2 years —
  // hstspreload.org submission requirement). Submission is *irrevocable* for
  // ~6 months — only enable for HTTPS-only deployments. Default false keeps
  // the current 1-year max-age without the preload directive.
  HSTS_PRELOAD: boolStr(false),

  // Notifications — Teams
  TEAMS_WEBHOOK_URL: z.string().url().optional(),
  TEAMS_NOTIFICATIONS_ENABLED: boolStr(false),

  // Notifications — Discord
  DISCORD_WEBHOOK_URL: z.string().url().optional(),
  DISCORD_NOTIFICATIONS_ENABLED: boolStr(false),

  // Notifications — Telegram
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  TELEGRAM_NOTIFICATIONS_ENABLED: boolStr(false),

  // Notifications — Email
  // SMTP_HOST is intentionally env-only for SSRF protection.
  // getSafeSmtpHost() blocks private/loopback hosts and ignores DB overrides.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: boolStr(true),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default('AI Portainer Dashboard <notifications@example.com>'),
  EMAIL_NOTIFICATIONS_ENABLED: boolStr(false),
  EMAIL_RECIPIENTS: z.string().default(''),

  // Outbound HTTP deadlines (#1514) — every outbound fetch must bound its wait
  // so a hung remote (Teams/Discord/Telegram, Elasticsearch) cannot pin a
  // notification/log-ship call open indefinitely.
  NOTIFICATION_HTTP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(10000),
  LOG_SHIP_HTTP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(5000),
  // Ceiling for a single streaming LLM completion (#1514). Combined with the
  // caller's abort signal via AbortSignal.any, so an idle/hung upstream is cut
  // off even when the client never cancels. Generous by default — legitimate
  // streams finish well within it.
  LLM_STREAM_TIMEOUT_MS: z.coerce.number().int().min(5000).max(600000).default(120000),

  // Webhooks
  WEBHOOKS_ENABLED: boolStr(false),
  WEBHOOKS_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(5),
  WEBHOOKS_RETRY_INTERVAL_SECONDS: z.coerce.number().int().min(10).default(60),

  // Harbor Registry (Vulnerability Management)
  HARBOR_API_URL: optionalUrl,
  HARBOR_ROBOT_NAME: z.string().optional(),
  HARBOR_ROBOT_SECRET: z.string().optional(),
  HARBOR_VERIFY_SSL: boolStr(true),
  HARBOR_SYNC_ENABLED: boolStr(false),
  HARBOR_SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
  HARBOR_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  // Maximum pages fetched per Harbor sync (100 items/page → default 500 = 50k items).
  // Raise this when your Harbor instance has more than 50k vulnerabilities, or set
  // to 0 to disable the cap entirely (fetch until Harbor reports the last page).
  HARBOR_MAX_PAGES: z.coerce.number().int().min(0).default(500),

  // Image Staleness
  IMAGE_STALENESS_CHECK_ENABLED: boolStr(true),
  IMAGE_STALENESS_CHECK_INTERVAL_HOURS: z.coerce.number().int().min(1).default(24),

  // Prompt Injection Guard
  LLM_PROMPT_GUARD_STRICT: boolStr(true),
  PROMPT_GUARD_NEAR_MISS_ENABLED: boolStr(true),
  PROMPT_GUARD_NEAR_MISS_LOW_STRICT: z.coerce.number().min(0).max(1).default(0.2),
  PROMPT_GUARD_NEAR_MISS_HIGH_STRICT: z.coerce.number().min(0).max(1).default(0.4),
  PROMPT_GUARD_NEAR_MISS_LOW_RELAXED: z.coerce.number().min(0).max(1).default(0.3),
  PROMPT_GUARD_NEAR_MISS_HIGH_RELAXED: z.coerce.number().min(0).max(1).default(0.5),

  // MCP (Model Context Protocol)
  MCP_TOOL_TIMEOUT: z.coerce.number().int().min(1).max(600).default(60),
  LLM_MAX_TOOL_ITERATIONS: z.coerce.number().int().min(1).max(20).default(10),

  // eBPF Trace Ingestion (Grafana Beyla)
  TRACES_INGESTION_ENABLED: boolStr(false),
  TRACES_INGESTION_API_KEY: z.string().default(''),
  // How many days of spans to retain. Daily cleanup runs alongside
  // METRICS_RETENTION_DAYS in scheduler.runCleanup().
  TRACES_RETENTION_DAYS: z.coerce.number().int().min(1).default(7),
  // Head-sampling rate, 0..1. 1.0 = accept all (default; no-op for existing
  // deployments). Deterministic on trace_id so all spans of a trace travel
  // together.
  TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1.0),
  // Per-source token-bucket refill (spans/sec) keyed by
  // service_namespace||service_name. 0 = unbounded. Set this to protect the
  // trace store from a single chatty fleet.
  TRACES_INGEST_MAX_SPANS_PER_SEC: z.coerce.number().int().min(0).default(0),
  // Trace-driven anomaly detector (runs alongside the metric-anomaly cycle).
  // Z-score threshold for recent p95 vs 24h baseline. Raised 2.5 → 3.0 in
  // #1294 (epic #1291): at 2.5σ a Gaussian baseline produces ~1.2% false-
  // positive samples (≈17/day for a 1-sample-per-min service); 3.0σ drops
  // that to ~0.27% (≈4/day) and aligns with the metric-detector's stricter
  // posture. Lower = more sensitive.
  TRACES_ANOMALY_P95_ZSCORE: z.coerce.number().min(0).default(3.0),
  // Recent error-rate (percent) above which a service is flagged regardless
  // of baseline. Set to a very high number (e.g. 100) to disable.
  TRACES_ANOMALY_ERROR_RATE_PCT: z.coerce.number().min(0).max(100).default(5),
  // Per-service rate limit for trace anomalies (#1294 / epic #1291, fix 7).
  // The existing 10-min per-(service,metric_type) cooldown still applies; this
  // adds an additional ceiling of at most one new anomaly per service per
  // TRACES_ANOMALY_PER_SERVICE_MIN minutes — so a single noisy service cannot
  // emit one latency + one error-rate anomaly + another latency anomaly back
  // to back. Set to 0 to disable.
  TRACES_ANOMALY_PER_SERVICE_MIN: z.coerce.number().int().min(0).default(5),
  // Minimum recent-sample count required before a service is eligible for
  // trace anomaly detection (#1294 / epic #1291, fix 8). Mirrors
  // ANOMALY_MIN_SAMPLES on the metric path so brand-new services with sparse
  // baselines do not fire on their first few buckets.
  TRACES_ANOMALY_MIN_SAMPLES: z.coerce.number().int().min(1).default(10),
  // Comma-separated hostnames of upstream LLM providers. The frontend asks
  // /api/traces?netPeerName=<host> for each entry to render the LLM latency
  // breakdown panel; the backend includes the matching `x-trace-correlation-id`
  // on every outbound LLM call so the panel can split network vs model time.
  LLM_PEER_HOSTNAMES: z
    .string()
    .default('api.anthropic.com,api.openai.com,api.mistral.ai,api.deepseek.com,api.groq.com'),

  // OpenTelemetry Span Export (OTLP/HTTP JSON)
  OTEL_EXPORTER_ENABLED: boolStr(false),
  OTEL_EXPORTER_ENDPOINT: z.string().url().optional(),
  OTEL_EXPORTER_HEADERS: z.string().optional(),
  OTEL_EXPORTER_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
  OTEL_EXPORTER_FLUSH_INTERVAL_MS: z.coerce.number().int().min(500).max(60000).default(5000),

  // Log Shipping (Elasticsearch)
  LOG_SHIPPING_ENABLED: boolStr(false),
  LOG_SHIPPING_ENDPOINT: z.string().url().optional(),
  LOG_SHIPPING_INDEX_PREFIX: z.string().default('dashboard-logs'),
  LOG_SHIPPING_USERNAME: z.string().optional(),
  LOG_SHIPPING_PASSWORD: z.string().optional(),
  LOG_SHIPPING_BATCH_SIZE: z.coerce.number().int().min(1).default(100),
  LOG_SHIPPING_FLUSH_INTERVAL_MS: z.coerce.number().int().min(500).default(5000),

  // Scalability Limits (#544, #547)
  INSIGHTS_RETENTION_DAYS: z.coerce.number().int().min(1).default(7),
  MAX_LLM_HISTORY_MESSAGES: z.coerce.number().int().min(1).default(50),
  // Maximum input tokens (rough estimate: ~4 chars/token) for LLM chat requests.
  // Default 3500 fits small-context models (gemma-3-4b's 4K window with margin
  // for response). Raise this when using larger-context models — e.g. set to
  // 7000 for Llama-3.1-8B's 8K window, 100000+ for Claude/GPT-4-class models.
  // When the budget is exceeded, the chat handler trims history, MCP tool
  // descriptions, built-in tools, and infrastructure context (in that order).
  LLM_CONTEXT_BUDGET: z.coerce.number().int().min(512).default(3500),
  LOG_ANALYSIS_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(3),

  // Data Retention (#1505) — daily cleanup windows for app-DB history tables
  // that previously grew without bound. Pruned by the scheduler's daily
  // cleanup job in 10k-row batches on the created_at index.
  AUDIT_LOG_RETENTION_DAYS: z.coerce.number().int().min(1).default(90),
  NOTIFICATION_LOG_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  LLM_TRACES_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  WEBHOOK_DELIVERIES_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  MONITORING_CYCLES_RETENTION_DAYS: z.coerce.number().int().min(1).default(14),
  // monitoring_snapshots feeds the public status page's 90-day uptime
  // timeline (getDailyUptimeBuckets(90)) — keep this >= 90.
  MONITORING_SNAPSHOTS_RETENTION_DAYS: z.coerce.number().int().min(1).default(90),

  // Rate Limiting
  API_RATE_LIMIT: z.coerce.number().int().min(10).default(
    process.env.NODE_ENV === 'production' ? 600 : 1200
  ),
  LOGIN_RATE_LIMIT: z.coerce.number().int().min(1).default(
    process.env.NODE_ENV === 'production' ? 5 : 30
  ),
  LLM_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20),
});

export type EnvConfig = z.infer<typeof envSchema>;
