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
    config = result.data;
  }
  return config;
}

export type { EnvConfig };
