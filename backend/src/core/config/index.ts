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
