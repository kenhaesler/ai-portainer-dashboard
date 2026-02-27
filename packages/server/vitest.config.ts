import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    clearMocks: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
    fileParallelism: false,
    env: {
      DASHBOARD_USERNAME: 'admin',
      DASHBOARD_PASSWORD: 'test-password-12345',
      JWT_SECRET: 'a'.repeat(64),
      REDIS_URL: 'redis://localhost:6379',
      PORTAINER_API_URL: 'http://localhost:9000',
      PORTAINER_API_KEY: 'test-api-key-placeholder',
      OLLAMA_BASE_URL: 'http://localhost:11434',
      OLLAMA_MODEL: 'tinyllama',
      CACHE_ENABLED: 'true',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['node_modules/', 'dist/'],
      thresholds: { lines: 50, functions: 50, branches: 50, statements: 50 },
    },
  },
});
