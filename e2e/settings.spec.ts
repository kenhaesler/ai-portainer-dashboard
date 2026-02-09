import { test, expect } from '@playwright/test';

/**
 * Settings page E2E tests.
 *
 * These use cached auth state.  The settings page uses Radix Tabs
 * for categories and stores theme preferences in Zustand with
 * localStorage persistence.
 */
test.describe('Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();
  });

  test('theme change persists after page reload', async ({ page }) => {
    // Record the current theme from the <html> element
    const initialTheme = await page.locator('html').getAttribute('class');

    // Find and click the theme toggle in the header
    const themeToggle = page.locator('[data-testid="theme-toggle"]');

    if (await themeToggle.isVisible()) {
      await themeToggle.click();

      // Wait for the theme transition
      await page.waitForTimeout(400);

      const newTheme = await page.locator('html').getAttribute('class');

      // Theme class should have changed
      expect(newTheme).not.toBe(initialTheme);

      // Reload the page
      await page.reload();
      await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();

      // Theme should persist after reload
      const afterReloadTheme = await page
        .locator('html')
        .getAttribute('class');
      expect(afterReloadTheme).toBe(newTheme);

      // Restore original theme
      await themeToggle.click();
    }
  });

  test('settings page renders tab navigation', async ({ page }) => {
    // The settings page uses Radix Tabs -- there should be a tab list
    const tabList = page.getByRole('tablist');
    await expect(tabList).toBeVisible();

    // Should have multiple tabs
    const tabs = tabList.getByRole('tab');
    const tabCount = await tabs.count();
    expect(tabCount).toBeGreaterThan(1);
  });

  test('switching settings tabs updates visible content', async ({ page }) => {
    const tabList = page.getByRole('tablist');
    await expect(tabList).toBeVisible();

    const tabs = tabList.getByRole('tab');
    const tabCount = await tabs.count();

    if (tabCount >= 2) {
      // Click second tab
      await tabs.nth(1).click();

      // The selected tab should have aria-selected="true"
      await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');

      // The corresponding tab panel should be visible
      const activePanel = page.getByRole('tabpanel');
      await expect(activePanel).toBeVisible();
    }
  });

  test('dashboard background toggle changes background state', async ({
    page,
  }) => {
    // Navigate to appearance / theme settings
    const tabList = page.getByRole('tablist');
    await expect(tabList).toBeVisible();

    // Look for an Appearance tab
    const appearanceTab = tabList.getByRole('tab', {
      name: /appearance/i,
    });

    if (await appearanceTab.isVisible()) {
      await appearanceTab.click();
      await expect(appearanceTab).toHaveAttribute('aria-selected', 'true');

      // Look for the dashboard background selector
      const bgSelector = page.locator(
        '[data-testid="dashboard-background-selector"]',
      );

      if (await bgSelector.isVisible()) {
        // Check current state of the <html> data attribute
        const initialBg = await page
          .locator('html')
          .getAttribute('data-animated-bg');

        // Click an option to toggle the background
        const options = bgSelector.locator('button, [role="radio"]');
        const optionCount = await options.count();

        if (optionCount >= 2) {
          // Click a different option than the current one
          await options.nth(optionCount - 1).click();
          await page.waitForTimeout(300);

          // Verify the data attribute changed (or appeared/disappeared)
          const newBg = await page
            .locator('html')
            .getAttribute('data-animated-bg');
          expect(newBg).not.toBe(initialBg);
        }
      }
    }
  });
});
