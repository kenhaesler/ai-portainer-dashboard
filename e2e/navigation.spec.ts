import { test, expect } from '@playwright/test';

/**
 * Navigation E2E tests.
 *
 * These use the cached auth state from global-setup, so the browser
 * is already authenticated when tests start.
 */
test.describe('Sidebar Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for the dashboard layout to be ready
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();
  });

  test('navigates to major pages via sidebar links', async ({ page }) => {
    const routes = [
      { label: /workload explorer/i, urlPattern: /\/workloads/ },
      { label: /container health/i, urlPattern: /\/health/ },
      { label: /metrics dashboard/i, urlPattern: /\/metrics/ },
      { label: /settings/i, urlPattern: /\/settings/ },
    ];

    for (const route of routes) {
      // Click sidebar link
      await page
        .locator('[data-testid="sidebar"]')
        .getByRole('link', { name: route.label })
        .click();

      // Verify URL updated
      await expect(page).toHaveURL(route.urlPattern);

      // Verify page content loaded (not stuck on loader)
      await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();
    }
  });

  test('breadcrumbs reflect current page', async ({ page }) => {
    // Navigate to a nested page
    await page
      .locator('[data-testid="sidebar"]')
      .getByRole('link', { name: /workload explorer/i })
      .click();

    await expect(page).toHaveURL(/\/workloads/);

    // Breadcrumb should show Dashboard / Workload Explorer
    const breadcrumb = page.locator(
      '[data-testid="header"] nav[aria-label="Breadcrumb"]',
    );
    await expect(breadcrumb).toBeVisible();
    await expect(breadcrumb).toContainText('Dashboard');
    await expect(breadcrumb).toContainText('Workload Explorer');
  });

  test('direct URL access loads the correct page', async ({ page }) => {
    await page.goto('/settings');

    await expect(page).toHaveURL(/\/settings/);

    // Header breadcrumb should say Settings
    const breadcrumb = page.locator(
      '[data-testid="header"] nav[aria-label="Breadcrumb"]',
    );
    await expect(breadcrumb).toContainText('Settings');
  });

  test('unknown routes redirect to home', async ({ page }) => {
    // The router has a catch-all `*` that redirects to `/`
    await page.goto('/this-route-does-not-exist');

    await expect(page).toHaveURL(/\/(home)?$/);
  });
});
