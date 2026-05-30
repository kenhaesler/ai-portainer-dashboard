/**
 * Single source of truth for development-mode allowed origins.
 * Used by both the CORS plugin and Socket.IO plugin to avoid drift.
 *
 * Browsers treat `localhost` and `127.0.0.1` as distinct origins for CORS
 * purposes (RFC 6454 §4: origin = scheme+host+port, where host is a string
 * compare). Both loopback aliases are listed so a developer hitting either
 * URL gets the same allow-list behaviour. Production allow-listing is
 * controlled separately via CORS_ALLOWED_ORIGINS — this constant is dev-only.
 */
export const DEV_ALLOWED_ORIGINS = [
  'http://localhost:5273',
  'http://localhost:8080',
  'http://127.0.0.1:5273',
  'http://127.0.0.1:8080',
];
