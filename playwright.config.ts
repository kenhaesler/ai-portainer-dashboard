import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration.
 *
 * Auth state is cached via global-setup so most tests skip the login
 * flow entirely.  The `setup` project runs first, stores browser
 * state to `e2e/.auth/user.json`, and the `chromium` project reuses it.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  /* Reasonable per-test timeout */
  timeout: 30_000,

  /* Global expect timeout for assertions */
  expect: {
    timeout: 10_000,
  },

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5273',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    /* Auth setup -- runs before all other projects */
    {
      name: 'setup',
      testMatch: /global-setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },

    /* Auth spec tests (login/logout) do NOT use cached state */
    {
      name: 'auth',
      testMatch: /auth\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },

    /* All other specs reuse the cached auth state */
    {
      name: 'chromium',
      testIgnore: /auth\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/user.json',
      },
    },
  ],
});
