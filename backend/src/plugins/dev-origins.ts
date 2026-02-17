/**
 * Single source of truth for development-mode allowed origins.
 * Used by both the CORS plugin and Socket.IO plugin to avoid drift.
 */
export const DEV_ALLOWED_ORIGINS = [
  'http://localhost:5273',
  'http://localhost:8080',
];
