import { readFileSync } from 'node:fs';

/**
 * Read a secret value from `/run/secrets/<secretName>` if available, otherwise
 * fall back to the named environment variable.
 *
 * This is the bridge between the Docker Secrets path (production) and the
 * environment-variable path (local dev / backwards compatibility). It allows
 * callers — the env schema layer, primarily — to remain agnostic of the
 * underlying source.
 *
 * Behaviour:
 *   1. If `/run/secrets/<secretName>` exists and is readable, return its
 *      contents with trailing whitespace stripped (Docker writes a trailing
 *      newline when the secret file is created with shell redirects).
 *   2. Otherwise, return `process.env[envVarName]` (which itself may be
 *      `undefined`).
 *
 * Any filesystem error — file not found, permission denied, EISDIR, etc. — is
 * swallowed and treated as "no Docker Secret here, fall back to env". This is
 * deliberate: we never want Docker Secrets misconfiguration to crash dev or
 * test runs that rely on env vars.
 *
 * @param secretName  Filename under `/run/secrets/` (e.g. `jwt_secret`).
 * @param envVarName  Environment variable to consult as a fallback.
 * @returns The secret value, or `undefined` if neither source is available.
 */
export function readSecret(secretName: string, envVarName: string): string | undefined {
  try {
    return readFileSync(`/run/secrets/${secretName}`, 'utf-8').trim();
  } catch {
    return process.env[envVarName];
  }
}
