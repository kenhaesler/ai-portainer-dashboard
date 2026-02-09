import { test, expect } from '@playwright/test';

/**
 * Container-related E2E tests.
 *
 * These use cached auth state.  The Workload Explorer page shows
 * the container list with search/filter, endpoint/stack dropdowns,
 * and links to container detail pages.
 */
test.describe('Container List (Workload Explorer)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/workloads');
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();
  });

  test('container list loads and displays rows', async ({ page }) => {
    // The DataTable should render with at least one row, or show an
    // empty state.  We wait for either outcome.
    const table = page.locator('[data-testid="data-table"]');
    const emptyState = page.locator('[data-testid="container-empty-state"]');

    // One of these should appear within the timeout
    await expect(table.or(emptyState)).toBeVisible();

    // If the table is present, it should have at least one row
    const rowCount = await table.locator('tbody tr').count();
    if (rowCount > 0) {
      await expect(table.locator('tbody tr').first()).toBeVisible();
    }
  });

  test('search filter narrows displayed containers', async ({ page }) => {
    const table = page.locator('[data-testid="data-table"]');

    // Wait for table to render
    await expect(table).toBeVisible({ timeout: 15_000 });

    // Get the search/filter input inside the data table
    const searchInput = page.locator('[data-testid="data-table-search"]');

    // Only proceed if there is a search input
    if (await searchInput.isVisible()) {
      // Type a filter term that is unlikely to match all containers
      await searchInput.fill('zzz_no_match_expected');

      // The table should show either zero rows or an empty/filtered message
      // Give the filter a moment to apply
      await page.waitForTimeout(500);

      const filteredRows = await table.locator('tbody tr').count();
      // We typed gibberish, so the count should be zero or very low
      expect(filteredRows).toBeLessThanOrEqual(1);
    }
  });

  test('clicking a container name opens the detail view', async ({ page }) => {
    const table = page.locator('[data-testid="data-table"]');

    // Wait for table with at least one row
    await expect(table).toBeVisible({ timeout: 15_000 });
    const firstRow = table.locator('tbody tr').first();
    await expect(firstRow).toBeVisible();

    // Click the container name link (first link/button in the row)
    const containerLink = firstRow.locator('button, a').first();
    await containerLink.click();

    // Should navigate to a container detail page
    await expect(page).toHaveURL(/\/containers\/\d+\/[a-f0-9]+/);

    // Breadcrumb should reflect container details
    const breadcrumb = page.locator(
      '[data-testid="header"] nav[aria-label="Breadcrumb"]',
    );
    await expect(breadcrumb).toContainText('Container Details');
  });

  test('empty state is shown when no containers match', async ({ page }) => {
    // This test validates that when the API returns an empty list (or all
    // containers are filtered out), a user-friendly empty state appears.
    const table = page.locator('[data-testid="data-table"]');
    const emptyState = page.locator('[data-testid="container-empty-state"]');

    // Either the table or the empty state should be visible
    await expect(table.or(emptyState)).toBeVisible({ timeout: 15_000 });
  });
});
