import { test, expect } from '@playwright/test';

/**
 * Metrics Dashboard E2E tests.
 *
 * `/metrics` renders `features/observability/pages/metrics-dashboard.tsx`,
 * which shows endpoint / container selectors, a time-range selector, and a
 * chart container that lights up once a container is selected.
 *
 * These tests use cached auth state. The chart container only renders after
 * an endpoint + container have been selected, so the assertions focus on the
 * page chrome (selectors, time-range buttons) rather than chart contents,
 * which is sufficient for E2E page-coverage smoke.
 */
test.describe('Metrics Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/metrics');
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();
  });

  test('renders the page header and breadcrumb', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /metrics dashboard/i, level: 1 }),
    ).toBeVisible({ timeout: 15_000 });

    const breadcrumb = page.locator(
      '[data-testid="header"] nav[aria-label="Breadcrumb"]',
    );
    await expect(breadcrumb).toContainText('Metrics Dashboard');
  });

  test('renders endpoint, stack and container selectors', async ({ page }) => {
    // The three ThemedSelects render as comboboxes. Wait until at least three
    // are present (endpoint, stack, container).
    await expect(
      page.getByRole('heading', { name: /metrics dashboard/i, level: 1 }),
    ).toBeVisible({ timeout: 15_000 });

    const comboboxes = page.getByRole('combobox');
    await expect(comboboxes.first()).toBeVisible({ timeout: 15_000 });

    const count = await comboboxes.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('renders the time-range selector with multiple options', async ({ page }) => {
    // Time range buttons are simple <button> elements with labels like 1h, 6h, 24h.
    // Look for at least two distinct range labels to confirm the strip rendered.
    await expect(
      page.getByRole('heading', { name: /metrics dashboard/i, level: 1 }),
    ).toBeVisible({ timeout: 15_000 });

    const ranges = page.getByRole('button', {
      name: /^\s*\d+\s*(m|h|d)\s*$/i,
    });
    const rangeCount = await ranges.count();
    expect(rangeCount).toBeGreaterThanOrEqual(2);
  });

  test('zoom controls are present', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: /metrics dashboard/i, level: 1 }),
    ).toBeVisible({ timeout: 15_000 });

    // The page renders zoom in / zoom out buttons (title attributes), and
    // a percentage label in between (e.g. "100%"). Assert the percentage
    // text is visible — it's stable regardless of selection state.
    await expect(page.getByText(/^\d{2,3}%$/).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
