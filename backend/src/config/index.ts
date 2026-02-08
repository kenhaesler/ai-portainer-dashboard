import { existsSync } from 'node:fs';
import { envSchema, type EnvConfig } from './env.schema.js';

let config: EnvConfig | null = null;
const LEGACY_DEFAULT_JWT_SECRET = 'dev-secret-change-in-production-must-be-at-least-32-chars';
const WEAK_JWT_SECRETS = new Set([
  LEGACY_DEFAULT_JWT_SECRET,
  'changeme',
  'changeme123',
  'default',
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
  'password',
  'password123',
  'password12345',
]);
/** Common weak passwords used to detect insecure defaults in production. */
export const WEAK_PASSWORDS = new Set([
  'changeme',
  'changeme123',
  'changeme-redis',
  'changeme-timescale',
  'change_me_before_production',
  'password',
  'password123',
  'secret',
  'admin',
  'default',
  '12345678',
  'redis',
  'postgres',
]);

function validateJwtSecret(secret: string): void {
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

function extractTimescalePassword(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.password || undefined;
  } catch {
    return undefined;
  }
}

function validateServiceCredentials(data: EnvConfig): void {
  if (process.env.NODE_ENV !== 'production') return;

  if (data.REDIS_PASSWORD && WEAK_PASSWORDS.has(data.REDIS_PASSWORD.toLowerCase())) {
    throw new Error(
      'Invalid environment configuration:\n  REDIS_PASSWORD: weak Redis password is not allowed in production'
    );
  }

  const tsPassword = extractTimescalePassword(data.TIMESCALE_URL);
  if (tsPassword && WEAK_PASSWORDS.has(tsPassword.toLowerCase())) {
    throw new Error(
      'Invalid environment configuration:\n  TIMESCALE_URL: weak TimescaleDB password is not allowed in production'
    );
  }
}

function validateDashboardCredentials(username: string, password: string): void {
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
    validatePrometheusToken(result.data);
    validateServiceCredentials(result.data);
    config = result.data;
  }
  return config;
}

export type { EnvConfig };
