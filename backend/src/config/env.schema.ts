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

  // Anomaly Detection
  ANOMALY_ZSCORE_THRESHOLD: z.coerce.number().min(0.5).default(2.5),
  ANOMALY_MOVING_AVERAGE_WINDOW: z.coerce.number().int().min(5).default(30),
  ANOMALY_MIN_SAMPLES: z.coerce.number().int().min(3).default(10),

  // Cache
  CACHE_ENABLED: z.coerce.boolean().default(true),
  CACHE_TTL_SECONDS: z.coerce.number().int().min(10).default(900),

  // Server
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  SQLITE_PATH: z.string().default('./data/dashboard.db'),

  // Rate Limiting
  LOGIN_RATE_LIMIT: z.coerce.number().int().min(1).default(
    process.env.NODE_ENV === 'production' ? 5 : 30
  ),
});

export type EnvConfig = z.infer<typeof envSchema>;
