import { z } from 'zod';

export const envSchema = z.object({
  // Auth
  DASHBOARD_USERNAME: z.string().min(1).default('admin'),
  DASHBOARD_PASSWORD: z.string().min(8).default('changeme123'),
  JWT_SECRET: z.string().min(32).default('dev-secret-change-in-production-must-be-at-least-32-chars'),

  // Portainer
  PORTAINER_API_URL: z.string().url().default('http://localhost:9000'),
  PORTAINER_API_KEY: z.string().min(1).default(''),
  PORTAINER_VERIFY_SSL: z.coerce.boolean().default(true),

  // Ollama
  OLLAMA_BASE_URL: z.string().url().default('http://ollama:11434'),
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
  ANOMALY_ZSCORE_THRESHOLD: z.coerce.number().min(0.5).default(2.5),
  ANOMALY_MOVING_AVERAGE_WINDOW: z.coerce.number().int().min(5).default(30),
  ANOMALY_MIN_SAMPLES: z.coerce.number().int().min(3).default(10),
  ANOMALY_DETECTION_METHOD: z.enum(['zscore', 'bollinger', 'adaptive']).default('adaptive'),

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
  REDIS_KEY_PREFIX: z.string().default('aidash:cache:'),

  // Server
  PORT: z.coerce.number().int().min(1).max(65535).default(3051),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  SQLITE_PATH: z.string().default('./data/dashboard.db'),

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

  // Rate Limiting
  LOGIN_RATE_LIMIT: z.coerce.number().int().min(1).default(
    process.env.NODE_ENV === 'production' ? 5 : 30
  ),
});

export type EnvConfig = z.infer<typeof envSchema>;
