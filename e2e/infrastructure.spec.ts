import { test, expect } from '@playwright/test';

/**
 * Infrastructure Overview E2E tests.
 *
 * `/infrastructure` renders `features/containers/pages/fleet-overview.tsx`,
 * which exposes three Radix tabs: Fleet Overview, Stack Overview, Kubernetes.
 *
 * These tests use cached auth state. They focus on page-render integrity
 * (sidebar / header / breadcrumb / tabs) rather than exact endpoint data,
 * so the suite stays green whether or not Portainer endpoints are present
 * in the CI fixture.
 */
test.describe('Infrastructure Overview', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/infrastructure');
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();
  });

  test('renders the page header, breadcrumb, and tab list', async ({ page }) => {
    // Page heading
    await expect(
      page.getByRole('heading', { name: /^infrastructure$/i, level: 1 }),
    ).toBeVisible({ timeout: 15_000 });

    // Breadcrumb confirms route
    const breadcrumb = page.locator(
      '[data-testid="header"] nav[aria-label="Breadcrumb"]',
    );
    await expect(breadcrumb).toContainText('Infrastructure');

    // The three Radix tabs render
    await expect(page.locator('[data-testid="tab-fleet"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-stacks"]')).toBeVisible();
    await expect(page.locator('[data-testid="tab-kubernetes"]')).toBeVisible();
  });

  test('endpoint list renders or graceful empty state appears', async ({ page }) => {
    // The Fleet tab is the default landing tab. The filtered count is always
    // rendered once endpoints have loaded, even if the count is zero.
    const filteredCount = page.locator('[data-testid="fleet-filtered-count"]');
    // The error message is rendered inside a <p> at fleet-overview.tsx:856,
    // not a heading — match by visible text instead of role.
    const errorState = page.getByText(/failed to load infrastructure data/i);

    // Either we get the count text (success path) or an explicit error card.
    // We accept both — backend may be cold/unreachable in CI.
    await expect(filteredCount.or(errorState)).toBeVisible({
      timeout: 15_000,
    });
  });

  test('switching to the Stacks tab updates the active tab', async ({ page }) => {
    const stacksTab = page.locator('[data-testid="tab-stacks"]');
    await expect(stacksTab).toBeVisible();
    await stacksTab.click();

    // Radix exposes the active state via aria-selected or data-state="active"
    await expect(stacksTab).toHaveAttribute('data-state', 'active');
  });

  test('endpoint status badges render up/down state when endpoints exist', async ({
    page,
  }) => {
    // Endpoint cards include either a "Running"/"Up" or "Stopped"/"Down" label
    // (case-insensitive). When no endpoints exist, the filtered count is "0".
    const filteredCount = page.locator('[data-testid="fleet-filtered-count"]');
    await expect(filteredCount).toBeVisible({ timeout: 15_000 });

    const countText = (await filteredCount.textContent()) ?? '';
    const hasEndpoints = !/^\s*0\s/.test(countText);

    if (hasEndpoints) {
      // At least one status keyword should appear somewhere on the page.
      const statusKeywords = page.getByText(
        /\b(running|up|stopped|down|unreachable|edge|active|inactive)\b/i,
      );
      await expect(statusKeywords.first()).toBeVisible({ timeout: 10_000 });
    }
  });
});
