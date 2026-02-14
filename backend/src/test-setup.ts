/**
 * Global test setup file for vitest
 * Sets minimal required environment variables for config validation
 */

// Set minimal env vars for getConfig() validation
process.env.PORTAINER_API_KEY = process.env.PORTAINER_API_KEY || 'test-portainer-key';
process.env.DASHBOARD_USERNAME = process.env.DASHBOARD_USERNAME || 'test-admin';
process.env.DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'test-password';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters-long-for-validation';

// Test database URL is set in CI (POSTGRES_TEST_URL)
// If not set, tests requiring database will skip or use default
