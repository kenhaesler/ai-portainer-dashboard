import { test, expect } from '@playwright/test';

const USERNAME = process.env.E2E_USERNAME ?? 'admin';
const PASSWORD = process.env.E2E_PASSWORD ?? 'changeme123';

test.describe('Smoke Tests', () => {
  test('login flow redirects to dashboard', async ({ page }) => {
    await page.goto('/');

    // Should see login form
    await expect(page.getByRole('heading', { name: /sign in|login/i })).toBeVisible({ timeout: 10_000 });

    // Fill credentials and submit
    await page.getByLabel(/username/i).fill(USERNAME);
    await page.getByLabel(/password/i).fill(PASSWORD);
    await page.getByRole('button', { name: /sign in|login|log in/i }).click();

    // Should land on dashboard
    await expect(page).toHaveURL(/\/(home)?$/, { timeout: 15_000 });
  });

  test('dashboard renders KPI cards after login', async ({ page }) => {
    // Login first
    await page.goto('/');
    await page.getByLabel(/username/i).fill(USERNAME);
    await page.getByLabel(/password/i).fill(PASSWORD);
    await page.getByRole('button', { name: /sign in|login|log in/i }).click();

    // Wait for dashboard to load
    await expect(page).toHaveURL(/\/(home)?$/, { timeout: 15_000 });

    // Verify key dashboard elements render
    const cards = page.locator('[data-testid="kpi-card"], .kpi-card, [class*="card"]');
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });
  });

  test('sidebar navigation is visible', async ({ page }) => {
    // Login first
    await page.goto('/');
    await page.getByLabel(/username/i).fill(USERNAME);
    await page.getByLabel(/password/i).fill(PASSWORD);
    await page.getByRole('button', { name: /sign in|login|log in/i }).click();

    // Wait for dashboard
    await expect(page).toHaveURL(/\/(home)?$/, { timeout: 15_000 });

    // Sidebar should be present
    const sidebar = page.locator('aside');
    await expect(sidebar).toBeVisible({ timeout: 5_000 });
  });
});
