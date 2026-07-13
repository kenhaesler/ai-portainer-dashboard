import { test, expect } from '@playwright/test';
import { login } from './helpers/login';
import {
  apiLogin,
  authedContext,
  ADMIN_USERNAME,
  ADMIN_PASSWORD,
} from './helpers/api';
import {
  seedPendingAction,
  getActionStatus,
  deleteAction,
  type SeededAction,
} from './helpers/seed-action';

/**
 * Remediation Approval E2E tests (#1521).
 *
 * The remediation workflow is the *only* container-mutating path in this
 * observer-first product, so its approval gate and RBAC must hold end to end.
 * These specs exercise the real backend (Fastify routes + real Postgres SQL
 * guards) rather than the string-matching route mock the unit tests use.
 *
 * Seeding: there is intentionally no create-action API (actions are AI-proposed,
 * never client-created), so the seed-dependent tests insert a `pending` row via
 * `pg` against the app Postgres published by docker-compose.e2e.yml on
 * 127.0.0.1:5442. When that DB is not reachable those tests skip with a clear
 * message — no faked assertions. The RBAC test needs no seed and always runs.
 *
 * Boundary: the approved → execute path calls the container client against the
 * canned WireMock Portainer (never a real container), so we assert execution is
 * *authorized* and that the state transitions out of `approved`, not a specific
 * container outcome.
 */

const SEED_SKIP =
  'app Postgres not reachable for seeding — docker-compose.e2e.yml publishes it on 127.0.0.1:5442';

async function trySeed(overrides: Partial<SeededAction> = {}): Promise<SeededAction | null> {
  try {
    return await seedPendingAction(overrides);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[remediation-approval] seed skipped: ${(err as Error).message}`);
    return null;
  }
}

test.describe('Remediation Approval — admin (cached auth)', () => {
  test('a pending action offers Approve but not Execute (approval gates execution)', async ({
    page,
  }) => {
    const action = await trySeed({ containerName: `e2e-ui-target-${Date.now()}` });
    test.skip(action === null, SEED_SKIP);

    try {
      await page.goto('/remediation');
      await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();
      await expect(
        page.getByRole('heading', { name: /^remediation$/i, level: 1 }),
      ).toBeVisible({ timeout: 15_000 });

      // Filter to Pending so only pending rows (which offer Approve, never
      // Execute) are shown, then find our seeded row by container name.
      await page.getByRole('button', { name: /^pending/i }).click();

      const row = page.locator('tr', { hasText: action!.containerName });
      await expect(row).toBeVisible({ timeout: 15_000 });

      await expect(row.getByRole('button', { name: /approve/i })).toBeVisible();
      await expect(row.getByRole('button', { name: /execute/i })).toHaveCount(0);
    } finally {
      await deleteAction(action!.id);
    }
  });

  test('approval gates execution: pending cannot execute; approve then execute is authorized', async () => {
    const action = await trySeed({ containerName: 'e2e-api-target' });
    test.skip(action === null, SEED_SKIP);

    const adminToken = await apiLogin(ADMIN_USERNAME, ADMIN_PASSWORD);
    const admin = await authedContext(adminToken);

    try {
      // Executing a pending (un-approved) action is rejected by the SQL guard
      // `WHERE id = ? AND status = 'approved'` → 409, and leaves it pending.
      const earlyExecute = await admin.post(`/api/remediation/actions/${action!.id}/execute`);
      expect(earlyExecute.status()).toBe(409);
      expect(await getActionStatus(action!.id)).toBe('pending');

      // Approve moves pending → approved.
      const approve = await admin.post(`/api/remediation/actions/${action!.id}/approve`);
      expect(approve.status(), await approve.text()).toBe(200);
      expect(await getActionStatus(action!.id)).toBe('approved');

      // Re-approving is guarded by `WHERE status = 'pending'` → 409 (protects
      // against double-approval).
      const reApprove = await admin.post(`/api/remediation/actions/${action!.id}/approve`);
      expect(reApprove.status()).toBe(409);

      // Now authorized: passes RBAC + the approved-status gate. The mutation
      // targets the WireMock Portainer, so 200 (completed) or 502 (mock has no
      // restart mapping) are both acceptable — either proves it executed past
      // the gate and transitioned out of `approved`.
      const execute = await admin.post(`/api/remediation/actions/${action!.id}/execute`);
      expect([200, 502]).toContain(execute.status());
      const finalStatus = await getActionStatus(action!.id);
      expect(finalStatus).not.toBe('approved');
      expect(finalStatus).not.toBe('pending');
    } finally {
      await admin.dispose();
      await deleteAction(action!.id);
    }
  });
});

test.describe('Remediation Approval — RBAC', () => {
  test('a non-admin (viewer) cannot list, approve, or execute actions', async () => {
    const adminToken = await apiLogin(ADMIN_USERNAME, ADMIN_PASSWORD);
    const admin = await authedContext(adminToken);

    const viewerName = `e2e-viewer-${Date.now()}`;
    const viewerPassword = 'Viewer-e2e-Pw-7x2qD';

    const createRes = await admin.post('/api/users', {
      data: { username: viewerName, password: viewerPassword, role: 'viewer' },
    });
    expect(createRes.status(), await createRes.text()).toBe(201);
    const viewerUser = (await createRes.json()) as { id: string };

    try {
      const viewerToken = await apiLogin(viewerName, viewerPassword);
      const viewer = await authedContext(viewerToken);

      try {
        // Every remediation route is admin-only. RBAC fires at the
        // requireRole('admin') preHandler — before any DB lookup — so these are
        // 403 regardless of whether a matching action exists.
        expect((await viewer.get('/api/remediation/actions')).status()).toBe(403);
        expect(
          (await viewer.post('/api/remediation/actions/any-id/approve')).status(),
        ).toBe(403);
        expect(
          (await viewer.post('/api/remediation/actions/any-id/execute')).status(),
        ).toBe(403);
      } finally {
        await viewer.dispose();
      }
    } finally {
      await admin.delete(`/api/users/${viewerUser.id}`);
      await admin.dispose();
    }
  });
});

// A viewer browser session: the /remediation route is not role-gated in the
// router, so a viewer lands on the page — but the admin-only list endpoint 403s,
// so the page shows its load-error state and never renders approve controls.
test.describe('Remediation Approval — viewer browser session', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('a viewer sees no approve/execute controls on the remediation page', async ({ page }) => {
    const adminToken = await apiLogin(ADMIN_USERNAME, ADMIN_PASSWORD);
    const admin = await authedContext(adminToken);

    const viewerName = `e2e-viewer-ui-${Date.now()}`;
    const viewerPassword = 'Viewer-e2e-Pw-7x2qD';

    const createRes = await admin.post('/api/users', {
      data: { username: viewerName, password: viewerPassword, role: 'viewer' },
    });
    expect(createRes.status(), await createRes.text()).toBe(201);
    const viewerUser = (await createRes.json()) as { id: string };

    try {
      await login(page, viewerName, viewerPassword);
      await page.goto('/remediation');

      await expect(
        page.getByRole('heading', { name: /^remediation$/i, level: 1 }),
      ).toBeVisible({ timeout: 15_000 });

      // The admin-only list endpoint 403s for a viewer → the page renders its
      // error state, and no approval controls exist anywhere on the page.
      await expect(page.getByText(/failed to load actions/i)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('button', { name: /approve/i })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /execute/i })).toHaveCount(0);
    } finally {
      await admin.delete(`/api/users/${viewerUser.id}`);
      await admin.dispose();
    }
  });
});
