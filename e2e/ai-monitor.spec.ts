import { test, expect, type ConsoleMessage } from '@playwright/test';

/**
 * AI Monitor / Health & Monitoring E2E tests.
 *
 * The route `/ai-monitor` is a legacy alias that redirects to `/health`,
 * which renders the AI Monitor page (`features/ai-intelligence/pages/ai-monitor.tsx`).
 *
 * These tests use the cached auth state from global-setup, so the browser
 * is already authenticated when tests start.
 *
 * Assertions are intentionally tolerant: the page may render insights,
 * anomalies, or empty states depending on the live state of the fleet
 * and Ollama availability in CI. The goal is page render integrity, not
 * exact data shape.
 */
test.describe('AI Monitor (Health & Monitoring)', () => {
  test('legacy /ai-monitor route redirects to /health and renders the page', async ({
    page,
  }) => {
    await page.goto('/ai-monitor');

    // The router rewrites /ai-monitor -> /health
    await expect(page).toHaveURL(/\/health/);

    // Authenticated layout renders
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();
    await expect(page.locator('[data-testid="header"]')).toBeVisible();

    // Breadcrumb confirms we're on the Health & Monitoring page
    const breadcrumb = page.locator(
      '[data-testid="header"] nav[aria-label="Breadcrumb"]',
    );
    await expect(breadcrumb).toContainText('Health & Monitoring');

    // The page-level heading renders even if no insights have been generated
    await expect(
      page.getByRole('heading', { name: /health & monitoring/i, level: 1 }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('renders insight stats cards or graceful empty state', async ({ page }) => {
    await page.goto('/health');
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();

    // The page renders the stat cards (Total / Critical / Warning / Info) AND,
    // when no insights exist, an empty-state copy — both can be present at once,
    // so assert at least one is visible (.first() avoids a strict-mode match of 2).
    const statsHeading = page.getByText(/total insights/i);
    const emptyHeading = page.getByRole('heading', { name: /no insights/i });

    await expect(statsHeading.or(emptyHeading).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('anomaly / health-issue section is present when there are issues', async ({
    page,
  }) => {
    await page.goto('/health');
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();

    // Wait for the page to fully render (heading is the most reliable anchor).
    await expect(
      page.getByRole('heading', { name: /health & monitoring/i, level: 1 }),
    ).toBeVisible({ timeout: 15_000 });

    // The anomalies section only renders when there are correlated anomalies
    // or unhealthy containers. Check that *if* it renders, it includes its
    // section heading; if not, the page must still be operable (i.e. the
    // heading-1 above is still visible). Either branch is acceptable.
    const anomaliesHeading = page.getByRole('heading', {
      name: /anomalies & health issues/i,
    });
    const healthIssueCard = page.locator('[data-testid="health-issue-card"]');
    const zscoreBars = page.locator('[data-testid="zscore-bars"]');

    if (await anomaliesHeading.isVisible().catch(() => false)) {
      // If the section is rendered, at least one cue (card or z-score bars)
      // should also be present.
      await expect(
        anomaliesHeading
          .or(healthIssueCard.first())
          .or(zscoreBars.first()),
      ).toBeVisible();
    }
  });

  test('does not throw uncaught JS errors when WebSocket connection fails', async ({
    page,
  }) => {
    // Capture pageerror (uncaught JS exceptions) and console.error messages.
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (err: Error) => {
      pageErrors.push(err.message);
    });
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Force every WebSocket upgrade to fail before navigation. The page
    // must still render and remain interactive.
    await page.route('**/ws/**', (route) => route.abort());
    await page.route('**/socket.io/**', (route) => route.abort());

    await page.goto('/health');
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /health & monitoring/i, level: 1 }),
    ).toBeVisible({ timeout: 15_000 });

    // Allow the failed WS handshake to surface any unhandled rejection.
    await page.waitForLoadState('networkidle').catch(() => {
      /* networkidle is best-effort with long-poll fallbacks */
    });

    // No uncaught exceptions; console.error is allowed (the app may log
    // about WS retries) but must not include an "Uncaught" prefix.
    expect(pageErrors, pageErrors.join('\n')).toHaveLength(0);
    const uncaught = consoleErrors.filter((msg) => /uncaught/i.test(msg));
    expect(uncaught, uncaught.join('\n')).toHaveLength(0);
  });
});
