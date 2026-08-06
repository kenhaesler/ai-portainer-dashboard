import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    clearMocks: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    env: {
      // Required fields with no schema defaults — must be set for getConfig() to parse cleanly
      DASHBOARD_USERNAME: 'admin',
      DASHBOARD_PASSWORD: 'test-password-12345',
      JWT_SECRET: 'a'.repeat(64),
      // Service URLs for integration tests (tests gracefully degrade when services are unreachable)
      REDIS_URL: 'redis://localhost:6379',
      PORTAINER_API_URL: 'http://localhost:9000',
      PORTAINER_API_KEY: 'test-api-key-placeholder',
      // No OLLAMA_* here on purpose (#1645). They are not in the env schema, so
      // they never reached getConfig(); the only reader is test-ollama-helper.ts
      // via process.env, and its `?? 'http://localhost:11434'` default is the
      // same value this used to pin. Setting them here only overrode a
      // developer's own export with localhost.
      CACHE_ENABLED: 'true',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['node_modules/', 'dist/'],
    },
  },
});
