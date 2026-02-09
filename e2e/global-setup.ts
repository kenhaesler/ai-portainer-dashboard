import { chromium, type FullConfig } from '@playwright/test';

/**
 * Playwright global setup: logs in once and saves the authenticated
 * browser storage state to `e2e/.auth/user.json`.
 *
 * Every test project that depends on the `setup` project inherits
 * the auth cookie/localStorage so individual tests skip the login flow.
 */
async function globalSetup(config: FullConfig) {
  const baseURL =
    config.projects[0]?.use?.baseURL ??
    process.env.E2E_BASE_URL ??
    'http://localhost:5273';

  const username = process.env.E2E_USERNAME ?? 'admin';
  const password = process.env.E2E_PASSWORD ?? 'changeme123';

  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });

  await page.goto('/login');

  // Wait for the login page to render
  await page.getByRole('heading', { name: /docker insights/i }).waitFor({
    state: 'visible',
    timeout: 15_000,
  });

  await page.getByLabel(/username/i).fill(username);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();

  // Wait for the dashboard to load
  await page.waitForURL(/\/(home)?$/, { timeout: 15_000 });

  // Persist storage state (cookies + localStorage with auth token)
  await page.context().storageState({ path: 'e2e/.auth/user.json' });

  await browser.close();
}

export default globalSetup;
