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
      { label: /workloads/i, urlPattern: /\/workloads/ },
      { label: /health & monitoring/i, urlPattern: /\/health/ },
      { label: /metrics dashboard/i, urlPattern: /\/metrics/ },
      { label: /settings/i, urlPattern: /\/settings/ },
    ];

    for (const route of routes) {
      // Sidebar destinations are real <a href> anchors so that middle-click and
      // cmd-click open a new tab (#design-critique). They must expose the link
      // role, not button.
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
      .getByRole('link', { name: /workloads/i })
      .click();

    await expect(page).toHaveURL(/\/workloads/);

    // Breadcrumb reads "Home / Workloads": the root crumb matches the sidebar
    // label and the h1 rather than inventing a third name ("Dashboard"), and
    // every crumb label comes from the single navigation manifest.
    const breadcrumb = page.locator(
      '[data-testid="header"] nav[aria-label="Breadcrumb"]',
    );
    await expect(breadcrumb).toBeVisible();
    await expect(breadcrumb).toContainText('Home');
    await expect(breadcrumb).toContainText('Workloads');
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

  test('/ai-monitor redirects to /health', async ({ page }) => {
    await page.goto('/ai-monitor');
    await expect(page).toHaveURL(/\/health/);
  });

  test('unknown routes render a 404 instead of silently landing on Home', async ({
    page,
  }) => {
    // Previously the catch-all `*` redirected to `/` with `replace`, so a stale
    // bookmark or typo'd deep link dropped the operator on Home believing it
    // was the page they asked for — and Back could not return them.
    await page.goto('/this-route-does-not-exist');

    await expect(page).toHaveURL(/\/this-route-does-not-exist/);
    await expect(
      page.getByText('/this-route-does-not-exist', { exact: false }),
    ).toBeVisible();
  });

  test('explicit legacy redirects still work', async ({ page }) => {
    // The six deliberate aliases must keep redirecting; only *unknown* paths
    // get the 404.
    await page.goto('/fleet');
    await expect(page).toHaveURL(/\/infrastructure/);
  });
});
