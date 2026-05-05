/**
 * Single source of truth for the production CORS allow-list, consumed by
 * both `@fastify/cors` (REST) and Socket.IO. Keeps REST and WebSocket CORS
 * policies in lock-step — there is no scenario in which they should differ.
 *
 * Behaviour:
 *   - Development (NODE_ENV !== 'production'): callers should use
 *     DEV_ALLOWED_ORIGINS from `dev-origins.ts`.
 *   - Production with CORS_ALLOWED_ORIGINS unset/empty: returns `false`
 *     (matches the legacy `origin: false` behaviour — no cross-origin
 *     requests permitted).
 *   - Production with CORS_ALLOWED_ORIGINS set: returns a parsed array of
 *     origins. Format is validated at boot via the Zod refinement on
 *     CORS_ALLOWED_ORIGINS — invalid entries fail-fast before this is called.
 */
import { getConfig } from '../config/index.js';

/**
 * Parse and return the configured CORS allow-list, or `false` when none
 * is configured (preserves the previous "no cross-origin in production"
 * default). Intended for use in the production code path; dev callers
 * should branch on NODE_ENV and use DEV_ALLOWED_ORIGINS instead.
 */
export function getAllowedOrigins(): string[] | false {
  const raw = getConfig().CORS_ALLOWED_ORIGINS;
  if (!raw) return false;
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : false;
}
