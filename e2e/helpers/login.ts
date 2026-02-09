import { type Page, expect } from '@playwright/test';

const DEFAULT_USERNAME = 'admin';
const DEFAULT_PASSWORD = 'changeme123';

/**
 * Log in to the dashboard via the login form.
 *
 * Credentials fall back to `E2E_USERNAME` / `E2E_PASSWORD` env vars,
 * then to hard-coded development defaults.
 */
export async function login(
  page: Page,
  username?: string,
  password?: string,
): Promise<void> {
  const user = username ?? process.env.E2E_USERNAME ?? DEFAULT_USERNAME;
  const pass = password ?? process.env.E2E_PASSWORD ?? DEFAULT_PASSWORD;

  await page.goto('/login');

  // Wait for the login form to render (lazy-loaded page)
  await expect(
    page.getByRole('heading', { name: /docker insights/i }),
  ).toBeVisible({ timeout: 15_000 });

  // Fill credentials
  await page.getByLabel(/username/i).fill(user);
  await page.getByLabel(/password/i).fill(pass);

  // Submit
  await page.getByRole('button', { name: /sign in/i }).click();

  // Wait until we land on the authenticated dashboard
  await expect(page).toHaveURL(/\/(home)?$/, { timeout: 15_000 });

  // Confirm the sidebar rendered (proves auth succeeded and layout loaded)
  await expect(page.locator('[data-testid="sidebar"]')).toBeVisible({
    timeout: 10_000,
  });
}
