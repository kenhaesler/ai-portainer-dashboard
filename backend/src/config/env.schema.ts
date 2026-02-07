import { z } from 'zod';

export const envSchema = z.object({
  // Auth
  DASHBOARD_USERNAME: z.string().min(1),
  DASHBOARD_PASSWORD: z.string().min(12),
  JWT_SECRET: z.string().min(32),

  // Portainer
  PORTAINER_API_URL: z.string().url().default('http://localhost:9000'),
  PORTAINER_API_KEY: z.string().min(1).default(''),
  PORTAINER_VERIFY_SSL: z.coerce.boolean().default(true),

  // Ollama
  OLLAMA_BASE_URL: z.string().url().default('http://host.docker.internal:11434'),
  OLLAMA_MODEL: z.string().default('llama3.2'),
  OLLAMA_API_ENDPOINT: z.string().url().optional(), // OpenAI-compatible endpoint (e.g., OpenWebUI)
  OLLAMA_BEARER_TOKEN: z.string().optional(), // Bearer token or username:password for Basic auth

  // Kibana (optional)
  KIBANA_ENDPOINT: z.string().url().optional(),
  KIBANA_API_KEY: z.string().optional(),

  // Monitoring
  MONITORING_ENABLED: z.coerce.boolean().default(true),
  MONITORING_INTERVAL_MINUTES: z.coerce.number().int().min(1).default(5),

  // Metrics Collection
  METRICS_COLLECTION_ENABLED: z.coerce.boolean().default(true),
  METRICS_COLLECTION_INTERVAL_SECONDS: z.coerce.number().int().min(10).default(60),
  METRICS_RETENTION_DAYS: z.coerce.number().int().min(1).default(7),
  PROMETHEUS_METRICS_ENABLED: z.coerce.boolean().default(false),
  PROMETHEUS_BEARER_TOKEN: z.string().optional(),

  // Anomaly Detection
  ANOMALY_ZSCORE_THRESHOLD: z.coerce.number().min(0.5).default(3.0),
  ANOMALY_MOVING_AVERAGE_WINDOW: z.coerce.number().int().min(5).default(30),
  ANOMALY_MIN_SAMPLES: z.coerce.number().int().min(3).default(30),
  ANOMALY_DETECTION_METHOD: z.enum(['zscore', 'bollinger', 'adaptive']).default('adaptive'),
  ANOMALY_COOLDOWN_MINUTES: z.coerce.number().int().min(0).default(15),

  // Predictive Alerting
  PREDICTIVE_ALERTING_ENABLED: z.coerce.boolean().default(true),
  PREDICTIVE_ALERT_THRESHOLD_HOURS: z.coerce.number().int().min(1).default(24),

  // Anomaly Explanations (LLM)
  ANOMALY_EXPLANATION_ENABLED: z.coerce.boolean().default(true),
  ANOMALY_EXPLANATION_MAX_PER_CYCLE: z.coerce.number().int().min(1).max(20).default(5),

  // Isolation Forest Anomaly Detection
  ISOLATION_FOREST_ENABLED: z.coerce.boolean().default(true),
  ISOLATION_FOREST_TREES: z.coerce.number().int().min(10).max(500).default(100),
  ISOLATION_FOREST_SAMPLE_SIZE: z.coerce.number().int().min(32).max(512).default(256),
  ISOLATION_FOREST_CONTAMINATION: z.coerce.number().min(0.01).max(0.5).default(0.1),
  ISOLATION_FOREST_RETRAIN_INTERVAL: z.coerce.number().int().min(1).default(6),

  // NLP Log Analysis (LLM)
  NLP_LOG_ANALYSIS_ENABLED: z.coerce.boolean().default(true),
  NLP_LOG_ANALYSIS_MAX_PER_CYCLE: z.coerce.number().int().min(1).max(20).default(3),
  NLP_LOG_ANALYSIS_TAIL_LINES: z.coerce.number().int().min(10).max(500).default(100),

  // Smart Alert Grouping
  SMART_GROUPING_ENABLED: z.coerce.boolean().default(true),
  SMART_GROUPING_SIMILARITY_THRESHOLD: z.coerce.number().min(0.1).max(1.0).default(0.3),
  INCIDENT_SUMMARY_ENABLED: z.coerce.boolean().default(true),

  // Investigation (Root Cause Analysis)
  INVESTIGATION_ENABLED: z.coerce.boolean().default(true),
  INVESTIGATION_COOLDOWN_MINUTES: z.coerce.number().int().min(1).default(30),
  INVESTIGATION_MAX_CONCURRENT: z.coerce.number().int().min(1).default(2),
  INVESTIGATION_LOG_TAIL_LINES: z.coerce.number().int().min(10).default(50),
  INVESTIGATION_METRICS_WINDOW_MINUTES: z.coerce.number().int().min(5).default(60),

  // Packet Capture (PCAP)
  PCAP_ENABLED: z.coerce.boolean().default(false),
  PCAP_MAX_DURATION_SECONDS: z.coerce.number().int().min(1).max(3600).default(300),
  PCAP_MAX_FILE_SIZE_MB: z.coerce.number().int().min(1).max(500).default(50),
  PCAP_MAX_CONCURRENT: z.coerce.number().int().min(1).max(10).default(2),
  PCAP_RETENTION_DAYS: z.coerce.number().int().min(1).default(7),
  PCAP_STORAGE_DIR: z.string().default('./data/pcap'),

  // Cache
  CACHE_ENABLED: z.coerce.boolean().default(true),
  CACHE_TTL_SECONDS: z.coerce.number().int().min(10).default(900),
  REDIS_URL: z.string().url().optional(),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_KEY_PREFIX: z.string().default('aidash:cache:'),

  // Server
  PORT: z.coerce.number().int().min(1).max(65535).default(3051),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  SQLITE_PATH: z.string().default('./data/dashboard.db'),

  // HTTP/2 (opt-in, requires TLS cert/key)
  HTTP2_ENABLED: z.coerce.boolean().default(false),
  TLS_CERT_PATH: z.string().optional(),
  TLS_KEY_PATH: z.string().optional(),

  // Notifications — Teams
  TEAMS_WEBHOOK_URL: z.string().url().optional(),
  TEAMS_NOTIFICATIONS_ENABLED: z.coerce.boolean().default(false),

  // Notifications — Email
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.coerce.boolean().default(true),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default('AI Portainer Dashboard <notifications@example.com>'),
  EMAIL_NOTIFICATIONS_ENABLED: z.coerce.boolean().default(false),
  EMAIL_RECIPIENTS: z.string().default(''),

  // Webhooks
  WEBHOOKS_ENABLED: z.coerce.boolean().default(false),
  WEBHOOKS_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(5),
  WEBHOOKS_RETRY_INTERVAL_SECONDS: z.coerce.number().int().min(10).default(60),

  // Image Staleness
  IMAGE_STALENESS_CHECK_ENABLED: z.coerce.boolean().default(true),
  IMAGE_STALENESS_CHECK_INTERVAL_HOURS: z.coerce.number().int().min(1).default(24),

  // eBPF Trace Ingestion (Grafana Beyla)
  TRACES_INGESTION_ENABLED: z.string().default('false').transform((v) => v === 'true' || v === '1'),
  TRACES_INGESTION_API_KEY: z.string().default(''),

  // Rate Limiting
  LOGIN_RATE_LIMIT: z.coerce.number().int().min(1).default(
    process.env.NODE_ENV === 'production' ? 5 : 30
  ),
});

export type EnvConfig = z.infer<typeof envSchema>;
