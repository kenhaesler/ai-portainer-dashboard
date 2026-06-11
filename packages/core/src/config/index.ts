import { existsSync } from 'node:fs';
import { envSchema, type EnvConfig } from './env.schema.js';

let config: EnvConfig | null = null;
const LEGACY_DEFAULT_JWT_SECRET = 'dev-secret-change-in-production-must-be-at-least-32-chars';
const WEAK_JWT_SECRETS = new Set([
  LEGACY_DEFAULT_JWT_SECRET,
  'changeme',
  'changeme123',
  'default',
  'generate-a-random-64-char-string',
  'password',
  'secret',
  'test',
]);
const WEAK_DASHBOARD_PASSWORDS = new Set([
  'admin',
  'adminadmin12',
  'admin123',
  'changeme',
  'changeme123',
  'changeme1234',
  'changeme12345',
  'changeme123456',
  'changeme1234567890',
  'password',
  'password123',
  'password12345',
]);
const WEAK_SERVICE_PASSWORDS = new Set([
  'changeme',
  'changeme-redis',
  'changeme-timescale',
  'changeme123',
  'password',
  'password123',
  'secret',
  'redis',
  'postgres',
  'default',
]);

/**
 * Calculate Shannon entropy in bits per character.
 * Formula: -Σ p(x) * log2(p(x)) where p(x) is frequency of each character.
 */
export function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

const MIN_PASSWORD_ENTROPY = 2.5;

function validateJwtSecret(secret: string): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (WEAK_JWT_SECRETS.has(secret.toLowerCase())) {
    throw new Error('Invalid environment configuration:\n  JWT_SECRET: insecure JWT secret value is not allowed');
  }
}

function validateJwtAlgorithm(data: EnvConfig): void {
  const { JWT_ALGORITHM, JWT_PRIVATE_KEY_PATH, JWT_PUBLIC_KEY_PATH } = data;

  if (JWT_ALGORITHM === 'RS256' || JWT_ALGORITHM === 'ES256') {
    if (!JWT_PRIVATE_KEY_PATH || !JWT_PUBLIC_KEY_PATH) {
      throw new Error(
        `Invalid environment configuration:\n  JWT_ALGORITHM=${JWT_ALGORITHM} requires both JWT_PRIVATE_KEY_PATH and JWT_PUBLIC_KEY_PATH`
      );
    }
    if (!existsSync(JWT_PRIVATE_KEY_PATH)) {
      throw new Error(
        `Invalid environment configuration:\n  JWT_PRIVATE_KEY_PATH: file not found: ${JWT_PRIVATE_KEY_PATH}`
      );
    }
    if (!existsSync(JWT_PUBLIC_KEY_PATH)) {
      throw new Error(
        `Invalid environment configuration:\n  JWT_PUBLIC_KEY_PATH: file not found: ${JWT_PUBLIC_KEY_PATH}`
      );
    }
  }
}

function validatePrometheusToken(data: EnvConfig): void {
  if (
    process.env.NODE_ENV === 'production' &&
    data.PROMETHEUS_METRICS_ENABLED &&
    (!data.PROMETHEUS_BEARER_TOKEN || data.PROMETHEUS_BEARER_TOKEN.length < 16)
  ) {
    throw new Error(
      'Invalid environment configuration:\n  PROMETHEUS_BEARER_TOKEN: must be at least 16 characters when Prometheus metrics are enabled in production'
    );
  }
}

function validateTraceIngestionKey(data: EnvConfig): void {
  // The OTLP ingest endpoint is unauthenticated apart from this key. In
  // production, refuse to start with ingestion enabled but no strong key —
  // mirrors the Prometheus-token guard above.
  if (
    process.env.NODE_ENV === 'production' &&
    data.TRACES_INGESTION_ENABLED &&
    (!data.TRACES_INGESTION_API_KEY || data.TRACES_INGESTION_API_KEY.length < 16)
  ) {
    throw new Error(
      'Invalid environment configuration:\n  TRACES_INGESTION_API_KEY: must be at least 16 characters when trace ingestion is enabled in production'
    );
  }
}

function validateDashboardCredentials(username: string, password: string): void {
  if (process.env.NODE_ENV !== 'production') return;

  const normalizedPassword = password.toLowerCase();
  if (username === 'admin' && normalizedPassword === 'changeme123') {
    throw new Error(
      'Invalid environment configuration:\n  DASHBOARD_PASSWORD: default admin credentials are not allowed'
    );
  }

  if (WEAK_DASHBOARD_PASSWORDS.has(normalizedPassword)) {
    throw new Error(
      'Invalid environment configuration:\n  DASHBOARD_PASSWORD: weak dashboard password is not allowed'
    );
  }

  if (shannonEntropy(password) < MIN_PASSWORD_ENTROPY) {
    throw new Error(
      'Invalid environment configuration:\n  DASHBOARD_PASSWORD: password entropy too low (must be >= 2.5 bits/char)'
    );
  }
}

function validateServicePasswords(data: EnvConfig): void {
  if (process.env.NODE_ENV !== 'production') return;

  if (data.REDIS_PASSWORD && WEAK_SERVICE_PASSWORDS.has(data.REDIS_PASSWORD.toLowerCase())) {
    throw new Error(
      'Invalid environment configuration:\n  REDIS_PASSWORD: weak Redis password is not allowed in production'
    );
  }

  // Extract password from TIMESCALE_URL (format: postgresql://user:password@host:port/db)
  try {
    const url = new URL(data.TIMESCALE_URL);
    const tsPassword = decodeURIComponent(url.password);
    if (tsPassword && WEAK_SERVICE_PASSWORDS.has(tsPassword.toLowerCase())) {
      throw new Error(
        'Invalid environment configuration:\n  TIMESCALE_URL: weak TimescaleDB password is not allowed in production'
      );
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('TIMESCALE_URL')) throw e;
    // URL parsing failed — non-standard format, skip password check
  }
}

// Category A + B env vars that are now configurable via Settings UI.
// During the deprecation window, they still work as fallbacks but log a warning.
//
// ── Intentionally env-only vars (NOT deprecated) ───────────────────────────────
// SMTP_HOST          – env-only for SSRF protection; getSafeSmtpHost() blocks
//                      private/loopback hosts and ignores DB overrides.
// ISOLATION_FOREST_TREES, ISOLATION_FOREST_SAMPLE_SIZE, ISOLATION_FOREST_CONTAMINATION
//                    – low-level ML tuning parameters that affect model structure.
//                      Changing at runtime would invalidate cached models without
//                      retraining, leading to incorrect anomaly scores. Keep as
//                      env-only so changes require a deliberate restart.
// ────────────────────────────────────────────────────────────────────────────────
export const DEPRECATED_ENV_VARS: Record<string, string> = {
  // Category A: already have Settings UI
  MONITORING_ENABLED: 'Settings → Monitoring → General (monitoring.enabled)',
  MONITORING_INTERVAL_MINUTES: 'Settings → Monitoring → General (monitoring.polling_interval)',
  TEAMS_WEBHOOK_URL: 'Settings → Monitoring → Notifications',
  TEAMS_NOTIFICATIONS_ENABLED: 'Settings → Monitoring → Notifications',
  DISCORD_WEBHOOK_URL: 'Settings → Monitoring → Notifications',
  DISCORD_NOTIFICATIONS_ENABLED: 'Settings → Monitoring → Notifications',
  TELEGRAM_BOT_TOKEN: 'Settings → Monitoring → Notifications',
  TELEGRAM_CHAT_ID: 'Settings → Monitoring → Notifications',
  TELEGRAM_NOTIFICATIONS_ENABLED: 'Settings → Monitoring → Notifications',
  SMTP_PORT: 'Settings → Monitoring → Notifications',
  SMTP_SECURE: 'Settings → Monitoring → Notifications',
  SMTP_USER: 'Settings → Monitoring → Notifications',
  SMTP_PASSWORD: 'Settings → Monitoring → Notifications',
  SMTP_FROM: 'Settings → Monitoring → Notifications',
  EMAIL_NOTIFICATIONS_ENABLED: 'Settings → Monitoring → Notifications',
  EMAIL_RECIPIENTS: 'Settings → Monitoring → Notifications',
  WEBHOOKS_ENABLED: 'Settings → Integrations → Webhooks',
  WEBHOOKS_MAX_RETRIES: 'Settings → Integrations → Webhooks',
  WEBHOOKS_RETRY_INTERVAL_SECONDS: 'Settings → Integrations → Webhooks',
  // Category B: AI tuning (now in Settings → AI & LLM → Advanced)
  ANOMALY_ZSCORE_THRESHOLD: 'Settings → AI & LLM → Advanced AI Tuning',
  ANOMALY_MOVING_AVERAGE_WINDOW: 'Settings → AI & LLM → Advanced AI Tuning',
  ANOMALY_MIN_SAMPLES: 'Settings → AI & LLM → Advanced AI Tuning',
  ANOMALY_DETECTION_METHOD: 'Settings → AI & LLM → Advanced AI Tuning',
  ANOMALY_COOLDOWN_MINUTES: 'Settings → AI & LLM → Advanced AI Tuning',
  ANOMALY_THRESHOLD_PCT: 'Settings → AI & LLM → Advanced AI Tuning',
  ANOMALY_HARD_THRESHOLD_ENABLED: 'Settings → AI & LLM → Advanced AI Tuning',
  BOLLINGER_BANDS_ENABLED: 'Settings → AI & LLM → Advanced AI Tuning',
  PREDICTIVE_ALERTING_ENABLED: 'Settings → AI & LLM → Advanced AI Tuning',
  PREDICTIVE_ALERT_THRESHOLD_HOURS: 'Settings → AI & LLM → Advanced AI Tuning',
  ANOMALY_EXPLANATION_ENABLED: 'Settings → AI & LLM → Advanced AI Tuning',
  ANOMALY_EXPLANATION_MAX_PER_CYCLE: 'Settings → AI & LLM → Advanced AI Tuning',
  ISOLATION_FOREST_ENABLED: 'Settings → AI & LLM → Advanced AI Tuning',
  ISOLATION_FOREST_RETRAIN_HOURS: 'Settings → AI & LLM → Advanced AI Tuning',
  NLP_LOG_ANALYSIS_ENABLED: 'Settings → AI & LLM → Advanced AI Tuning',
  NLP_LOG_ANALYSIS_MAX_PER_CYCLE: 'Settings → AI & LLM → Advanced AI Tuning',
  NLP_LOG_ANALYSIS_TAIL_LINES: 'Settings → AI & LLM → Advanced AI Tuning',
  SMART_GROUPING_ENABLED: 'Settings → AI & LLM → Advanced AI Tuning',
  SMART_GROUPING_SIMILARITY_THRESHOLD: 'Settings → AI & LLM → Advanced AI Tuning',
  INCIDENT_SUMMARY_ENABLED: 'Settings → AI & LLM → Advanced AI Tuning',
  INVESTIGATION_ENABLED: 'Settings → AI & LLM → Advanced AI Tuning',
  INVESTIGATION_COOLDOWN_MINUTES: 'Settings → AI & LLM → Advanced AI Tuning',
  INVESTIGATION_MAX_CONCURRENT: 'Settings → AI & LLM → Advanced AI Tuning',
  INVESTIGATION_LOG_TAIL_LINES: 'Settings → AI & LLM → Advanced AI Tuning',
  INVESTIGATION_METRICS_WINDOW_MINUTES: 'Settings → AI & LLM → Advanced AI Tuning',
  INVESTIGATION_MIN_SEVERITY: 'Settings → AI & LLM → Advanced AI Tuning',
  AI_ANALYSIS_ENABLED: 'Settings → AI & LLM → Advanced AI Tuning',
  MAX_INSIGHTS_PER_CYCLE: 'Settings → AI & LLM → Advanced AI Tuning',
  INSIGHTS_RETENTION_DAYS: 'Settings → Infrastructure → Metrics Retention',
};

let deprecationWarned = false;

function warnDeprecatedEnvVars(): void {
  if (deprecationWarned) return;
  deprecationWarned = true;

  for (const [envVar, uiLocation] of Object.entries(DEPRECATED_ENV_VARS)) {
    if (process.env[envVar] !== undefined) {
      console.warn(
        `[DEPRECATED] Env var ${envVar} is now configurable via ${uiLocation} and will be removed in a future release. ` +
        `Migrate to the Settings UI and remove it from your .env file.`,
      );
    }
  }
}

export function getConfig(): EnvConfig {
  if (!config) {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      const errors = result.error.issues
        .map((i) => `  ${i.path.join('.')}: ${i.message}`)
        .join('\n');
      throw new Error(`Invalid environment configuration:\n${errors}`);
    }
    validateJwtSecret(result.data.JWT_SECRET);
    validateJwtAlgorithm(result.data);
    validateDashboardCredentials(result.data.DASHBOARD_USERNAME, result.data.DASHBOARD_PASSWORD);
    validateServicePasswords(result.data);
    validatePrometheusToken(result.data);
    validateTraceIngestionKey(result.data);
    warnDeprecatedEnvVars();
    config = result.data;
  }
  return config;
}

/** Reset the cached config — use in afterEach when tests override config. */
export function resetConfig(): void {
  config = null;
}

/**
 * Override specific config values for a test. Call resetConfig() in afterEach.
 * Throws if called outside the test environment.
 */
export function setConfigForTest(partial: Partial<EnvConfig>): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('setConfigForTest can only be called in the test environment');
  }
  config = { ...getConfig(), ...partial };
}

export type { EnvConfig };
