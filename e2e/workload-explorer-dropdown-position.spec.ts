import { test, expect, type Page } from '@playwright/test';

/**
 * Regression for #1310 — Workload Explorer filter dropdowns intermittently
 * rendered at viewport (0, 0) instead of anchoring to their trigger.
 *
 * Root cause: `.spotlight-card` had `transform: translateZ(0)`, which
 * creates a containing block for `position: fixed` descendants. Radix's
 * popover portal computes coordinates against the viewport via Floating
 * UI, but the layout resolution against the transformed ancestor pushed
 * the panel to (0, 0). Removed in `frontend/src/index.css`.
 *
 * These tests stress the four timing variations described in the issue.
 * If the bug returns, at least one of them should fail.
 */

const DROPDOWNS = [
  { id: 'endpoint-select', label: 'Endpoint' },
  { id: 'stack-select', label: 'Stack' },
  { id: 'group-select', label: 'Group' },
  { id: 'state-select', label: 'State' },
] as const;

async function expectAnchored(page: Page, triggerId: string) {
  const trigger = page.locator(`#${triggerId}`);
  const triggerBox = await trigger.boundingBox();
  expect(triggerBox).not.toBeNull();

  const content = page.locator('[role="listbox"]').first();
  await expect(content).toBeVisible();
  const contentBox = await content.boundingBox();
  expect(contentBox).not.toBeNull();

  // Must not be glued to viewport origin — that's the (0, 0) failure mode.
  expect(contentBox!.x).toBeGreaterThan(20);
  expect(contentBox!.y).toBeGreaterThan(20);

  // Must anchor near the trigger. Radix popper uses sideOffset=4 on bottom;
  // allow generous tolerance because alignment can swap on small viewports.
  expect(Math.abs(contentBox!.x - triggerBox!.x)).toBeLessThan(80);
  expect(Math.abs(contentBox!.y - (triggerBox!.y + triggerBox!.height))).toBeLessThan(40);
}

test.describe('Workload Explorer filter dropdowns anchor to trigger', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/workloads');
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();
  });

  for (const { id, label } of DROPDOWNS) {
    test(`${label} dropdown anchors to its trigger (no (0,0))`, async ({ page }) => {
      const trigger = page.locator(`#${id}`);
      await expect(trigger).toBeVisible({ timeout: 15_000 });
      // Race the entrance animation — click as soon as we see the trigger.
      await trigger.click();
      await expectAnchored(page, id);
      await page.keyboard.press('Escape');
    });
  }

  test('first-click during MotionStagger entrance animation still anchors', async ({ page }) => {
    // This is the variation that actually reproduces the bug pre-fix.
    // Override the default beforeEach navigation by re-navigating with no
    // waitFor, then attempting to click the trigger as fast as possible —
    // while the parent SpotlightCard is still animating in. With the
    // pre-fix `.spotlight-card { transform: translateZ(0); }`, Floating UI
    // snapshots a transforming `getBoundingClientRect()` and the dropdown
    // lands at viewport (0, 0).
    await page.goto('/workloads', { waitUntil: 'domcontentloaded' });
    const trigger = page.locator('#endpoint-select');
    await expect(trigger).toBeAttached({ timeout: 15_000 });
    // `{ timeout: 100 }` keeps the click attempt from blocking on a slow
    // mount; `force: true` skips the actionability checks (visible, stable,
    // enabled) that would otherwise wait until the entrance animation
    // settles — defeating the point of the variation.
    await trigger.click({ timeout: 100, force: true });
    await expectAnchored(page, 'endpoint-select');
    await page.keyboard.press('Escape');
  });

  test('rapid reopen does not collapse Endpoint dropdown to (0, 0)', async ({ page }) => {
    const trigger = page.locator('#endpoint-select');
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    for (let i = 0; i < 8; i++) {
      await trigger.click();
      await page.keyboard.press('Escape');
    }
    await trigger.click();
    await expectAnchored(page, 'endpoint-select');
    await page.keyboard.press('Escape');
  });

  test('State dropdown anchors correctly at narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 800 });
    const trigger = page.locator('#state-select');
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    await trigger.click();
    await expectAnchored(page, 'state-select');
    await page.keyboard.press('Escape');
  });

  test('Group dropdown anchors correctly with prefers-reduced-motion', async ({ browser }) => {
    const context = await browser.newContext({
      storageState: 'e2e/.auth/user.json',
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await page.goto('/workloads');
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();
    const trigger = page.locator('#group-select');
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    await trigger.click();
    await expectAnchored(page, 'group-select');
    await page.keyboard.press('Escape');
    await context.close();
  });
});
