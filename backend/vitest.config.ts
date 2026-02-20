import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    env: {
      // Required fields with no schema defaults — must be set for getConfig() to parse cleanly
      DASHBOARD_USERNAME: 'admin',
      DASHBOARD_PASSWORD: 'test-password-12345',
      JWT_SECRET: 'a'.repeat(64),
      // Real service URLs for integration tests
      REDIS_URL: 'redis://:redispass123changeme123@localhost:6379',
      PORTAINER_API_URL: 'http://localhost:9000',
      PORTAINER_API_KEY: 'ptr_paWqv7PClSsoRFWYNelv6+nh9MQj9/1JQJ+M+cewAUY=',
      OLLAMA_BASE_URL: 'http://localhost:11434',
      OLLAMA_MODEL: 'tinyllama',
      CACHE_ENABLED: 'true',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['node_modules/', 'dist/'],
      thresholds: {
        lines: 50,
        functions: 50,
        branches: 50,
        statements: 50,
      },
    },
  },
});
