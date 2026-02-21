import { test as setup, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const authFile = path.join(__dirname, '.auth/user.json');

/**
 * Playwright setup project: logs in once and saves the authenticated
 * browser storage state to `e2e/.auth/user.json`.
 *
 * Every test project that depends on the `setup` project inherits
 * the auth cookie/localStorage so individual tests skip the login flow.
 */
setup('authenticate', async ({ page }) => {
  const username = process.env.E2E_USERNAME ?? 'admin';
  const password = process.env.E2E_PASSWORD ?? 'changeme12345';

  // Ensure the output directory exists
  fs.mkdirSync(path.dirname(authFile), { recursive: true });

  await page.goto('/login');

  // Wait for the login page to render
  await expect(
    page.getByRole('heading', { name: /docker insights/i }),
  ).toBeVisible({ timeout: 15_000 });

  await page.getByLabel(/username/i).fill(username);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();

  // Wait for the dashboard to load
  await page.waitForURL(/\/(home)?$/, { timeout: 15_000 });

  // Persist storage state (cookies + localStorage with auth token)
  await page.context().storageState({ path: authFile });
});
