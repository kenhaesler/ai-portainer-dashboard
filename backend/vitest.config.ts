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
      // Commonly needed in tests — override the schema default of empty string
      PORTAINER_API_KEY: 'test-portainer-api-key',
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
