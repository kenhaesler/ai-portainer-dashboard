import { test, expect } from '@playwright/test';
import { login } from './helpers/login';

/**
 * Authentication E2E tests.
 *
 * These intentionally do NOT use cached auth state -- each test
 * starts with a clean browser context to exercise the full login /
 * logout flow.
 */
test.describe('Authentication', () => {
  test('successful login with valid credentials redirects to dashboard', async ({
    page,
  }) => {
    await login(page);

    // Sidebar and header should be visible (authenticated layout)
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();
    await expect(page.locator('[data-testid="header"]')).toBeVisible();
  });

  test('failed login with bad credentials shows error message', async ({
    page,
  }) => {
    await page.goto('/login');

    await expect(
      page.getByRole('heading', { name: /docker insights/i }),
    ).toBeVisible({ timeout: 15_000 });

    await page.getByLabel(/username/i).fill('wronguser');
    await page.getByLabel(/password/i).fill('wrongpass');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Should remain on the login page with an error message
    await expect(page.locator('[data-testid="login-error"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page).toHaveURL(/\/login/);
  });

  test('logout clears auth state and redirects to login', async ({ page }) => {
    // Login first
    await login(page);

    // Open user menu and click Log out
    await page.locator('[data-testid="user-menu-trigger"]').click();
    await page.locator('[data-testid="logout-button"]').click();

    // Should be back on login page
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    await expect(
      page.getByRole('heading', { name: /docker insights/i }),
    ).toBeVisible();
  });

  test('unauthenticated user visiting a protected route is redirected to login', async ({
    page,
  }) => {
    // Go directly to a protected route without logging in
    await page.goto('/settings');

    // Should redirect to login
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });
});
