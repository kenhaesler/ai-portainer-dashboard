import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';

vi.mock('@/features/security/hooks/use-security-audit', () => ({
  useSecurityIgnoreList: () => ({
    data: { patterns: [], defaults: [] },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useUpdateSecurityIgnoreList: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/features/core/hooks/use-oidc', () => ({
  useOIDCEffectiveRedirectUri: () => ({ data: { source: 'none', redirectUri: '' } }),
}));

vi.mock('@/features/core/hooks/use-discovered-oidc-groups', () => ({
  useDiscoveredOidcGroups: () => ({ data: undefined }),
}));

vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({ role: 'admin' }),
}));

// The users panel is a lazily loaded page of its own; it is not under test here.
vi.mock('@/features/core/pages/users', () => ({
  UsersPanel: () => <div data-testid="users-panel" />,
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { SecurityTab } from './tab-security';
import { DEFAULT_SETTINGS } from './shared';

function renderTab() {
  const values: Record<string, string> = {};
  Object.values(DEFAULT_SETTINGS).flat().forEach((s) => { values[s.key] = s.defaultValue; });
  return render(
    <SecurityTab
      editedValues={values}
      originalValues={values}
      onChange={vi.fn()}
      isSaving={false}
    />,
  );
}

describe('SecurityTab', () => {
  it('hosts the public status page — unauthenticated exposure is a security decision', async () => {
    renderTab();

    expect(screen.getByText('Public Status Page')).toBeInTheDocument();
    const row = screen.getByTestId('setting-row-status.page.enabled');
    expect(row).toHaveAttribute('data-risk', 'security');
    expect(row).toHaveTextContent(/no sign-in/i);
    await waitFor(() => expect(screen.getByTestId('users-panel')).toBeInTheDocument());
  });

  it('says whether the status page is published, not whether it is "configured"', () => {
    renderTab();

    expect(screen.getByText('Not published')).toBeInTheDocument();
  });

  it('marks the plaintext-OIDC toggle as security-risk and states the consequence', () => {
    renderTab();

    const row = screen.getByTestId('setting-row-oidc.allow_insecure_transport');
    expect(row).toHaveAttribute('data-risk', 'security');
    expect(within(row).getByText('Security')).toBeInTheDocument();
    expect(row).toHaveTextContent(/capture and replay them/i);
    // The toggle still defaults off — presentation changed, the default did not.
    expect(within(row).getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('no longer buries the danger in a glyph inside muted body copy', () => {
    renderTab();

    const row = screen.getByTestId('setting-row-oidc.allow_insecure_transport');
    expect(row.textContent).not.toContain('⚠');
  });
});
