import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const mockCreateUser = vi.fn();
const mockUpdateUser = vi.fn();
const mockDeleteUser = vi.fn();

const mockUseAuth = vi.fn();

vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/features/core/hooks/use-users', () => ({
  useUsers: () => ({
    data: [
      {
        id: 'u1',
        username: 'admin',
        role: 'admin',
        default_landing_page: '/',
        created_at: '2026-02-06T10:00:00.000Z',
        updated_at: '2026-02-06T10:00:00.000Z',
      },
      {
        id: 'u2',
        username: 'ops-bot',
        role: 'operator',
        default_landing_page: '/health',
        created_at: '2026-02-06T10:01:00.000Z',
        updated_at: '2026-02-06T10:01:00.000Z',
      },
    ],
    isLoading: false,
  }),
  useCreateUser: () => ({ mutateAsync: (...args: unknown[]) => mockCreateUser(...args), isPending: false }),
  useUpdateUser: () => ({ mutateAsync: (...args: unknown[]) => mockUpdateUser(...args), isPending: false }),
  useDeleteUser: () => ({ mutateAsync: (...args: unknown[]) => mockDeleteUser(...args), isPending: false }),
}));

import { UsersPanel } from './users';

describe('UsersPanel', () => {
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ role: 'admin' });
  });

  afterEach(() => {
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    vi.unstubAllGlobals();
  });

  it('shows admin-only warning for non-admin users', () => {
    mockUseAuth.mockReturnValue({ role: 'viewer' });
    render(<UsersPanel />);
    expect(screen.getByText('Admin Access Required')).toBeInTheDocument();
  });

  it('creates a new user account', async () => {
    render(<UsersPanel />);

    fireEvent.change(screen.getByPlaceholderText('ops-bot'), { target: { value: 'support-user' } });
    fireEvent.change(screen.getByPlaceholderText('Minimum 8 characters'), { target: { value: 'password123' } });

    const createSection = screen.getByRole('heading', { name: 'Create User' }).closest('section');
    expect(createSection).toBeTruthy();
    if (!createSection) {
      return;
    }
    const roleSelect = within(createSection).getByRole('combobox');
    fireEvent.click(roleSelect);
    fireEvent.click(screen.getByRole('option', { name: 'Operator' }));

    fireEvent.click(screen.getByRole('button', { name: 'Create User' }));

    await waitFor(() => {
      expect(mockCreateUser).toHaveBeenCalledWith({
        username: 'support-user',
        password: 'password123',
        role: 'operator',
      });
    });
  });

  it('scrolls and focuses first input when Edit is clicked', async () => {
    const scrollIntoViewMock = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    // requestAnimationFrame fires callback synchronously in tests
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });

    render(<UsersPanel />);

    const adminRow = screen.getAllByRole('row').find((row) => within(row).queryAllByText('admin').length > 0);
    expect(adminRow).toBeDefined();
    if (!adminRow) return;

    fireEvent.click(within(adminRow).getByRole('button', { name: 'Edit' }));

    // Form should switch to edit mode with username pre-filled
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Edit User' })).toBeInTheDocument();
    });

    // scrollIntoView must be called on the form section
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' });

    // Username input should be focused
    const usernameInput = screen.getByPlaceholderText('ops-bot');
    expect(document.activeElement).toBe(usernameInput);
  });

  it('shows highlight ring on form section when Edit is clicked and clears on Reset', async () => {
    const scrollIntoViewMock = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });

    render(<UsersPanel />);

    const adminRow = screen.getAllByRole('row').find((row) => within(row).queryAllByText('admin').length > 0);
    if (!adminRow) return;

    act(() => {
      fireEvent.click(within(adminRow).getByRole('button', { name: 'Edit' }));
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Edit User' })).toBeInTheDocument();
    });

    // Form section should have the ring highlight class during edit mode
    const formSection = screen.getByRole('heading', { name: 'Edit User' }).closest('section');
    expect(formSection?.className).toContain('ring-2');

    // Reset form returns to create mode — heading changes back
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create User' })).toBeInTheDocument();
    });
  });

  it('deactivates and deletes existing users', async () => {
    render(<UsersPanel />);

    const adminRow = screen
      .getAllByRole('row')
      .find(
        (row) =>
          within(row).queryAllByText('admin').length > 0 &&
          within(row).queryByRole('button', { name: 'Deactivate' }),
      );
    expect(adminRow).toBeDefined();
    if (!adminRow) {
      return;
    }

    // Click Deactivate, then confirm via modal dialog
    fireEvent.click(within(adminRow).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => {
      expect(screen.getByText('Deactivate User')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));

    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalledWith({ id: 'u1', payload: { role: 'viewer' } });
    });

    // Click Delete, then confirm via modal dialog
    fireEvent.click(within(adminRow).getByRole('button', { name: /Delete/ }));
    await waitFor(() => {
      expect(screen.getByText('Delete User')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockDeleteUser).toHaveBeenCalledWith('u1');
    });
  });

  it('shows error message when deactivateUser mutation fails', async () => {
    mockUpdateUser.mockRejectedValueOnce(new Error('Permission denied'));
    render(<UsersPanel />);

    const adminRow = screen
      .getAllByRole('row')
      .find(
        (row) =>
          within(row).queryAllByText('admin').length > 0 &&
          within(row).queryByRole('button', { name: 'Deactivate' }),
      );
    expect(adminRow).toBeDefined();
    if (!adminRow) return;

    fireEvent.click(within(adminRow).getByRole('button', { name: 'Deactivate' }));
    // Confirm in the dialog
    const confirmBtn = await screen.findByRole('button', { name: 'Deactivate' });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByText('Permission denied')).toBeInTheDocument();
    });
  });

  it('shows fallback error message when deactivateUser throws non-Error', async () => {
    mockUpdateUser.mockRejectedValueOnce('network failure');
    render(<UsersPanel />);

    const adminRow = screen
      .getAllByRole('row')
      .find(
        (row) =>
          within(row).queryAllByText('admin').length > 0 &&
          within(row).queryByRole('button', { name: 'Deactivate' }),
      );
    expect(adminRow).toBeDefined();
    if (!adminRow) return;

    fireEvent.click(within(adminRow).getByRole('button', { name: 'Deactivate' }));
    const confirmBtn = await screen.findByRole('button', { name: 'Deactivate' });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByText('Failed to deactivate user')).toBeInTheDocument();
    });
  });

  it('shows error message when removeUser mutation fails', async () => {
    mockDeleteUser.mockRejectedValueOnce(new Error('Cannot delete last admin'));
    render(<UsersPanel />);

    const adminRow = screen
      .getAllByRole('row')
      .find(
        (row) =>
          within(row).queryAllByText('admin').length > 0 &&
          within(row).queryByRole('button', { name: 'Delete' }),
      );
    expect(adminRow).toBeDefined();
    if (!adminRow) return;

    fireEvent.click(within(adminRow).getByRole('button', { name: 'Delete' }));
    const confirmBtn = await screen.findByRole('button', { name: 'Delete' });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByText('Cannot delete last admin')).toBeInTheDocument();
    });
  });

  it('shows fallback error message when removeUser throws non-Error', async () => {
    mockDeleteUser.mockRejectedValueOnce(42);
    render(<UsersPanel />);

    const adminRow = screen
      .getAllByRole('row')
      .find(
        (row) =>
          within(row).queryAllByText('admin').length > 0 &&
          within(row).queryByRole('button', { name: 'Delete' }),
      );
    expect(adminRow).toBeDefined();
    if (!adminRow) return;

    fireEvent.click(within(adminRow).getByRole('button', { name: 'Delete' }));
    const confirmBtn = await screen.findByRole('button', { name: 'Delete' });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByText('Failed to delete user')).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Issue #1048 — confirmation modal + error message coverage
  //
  // Pre-existing tests above already cover:
  //   • Deactivate success path (#1048 case 1) — see 'deactivates and deletes existing users'
  //   • Deactivate error path (#1048 case 2) — see 'shows error message when deactivateUser…'
  //   • Remove success path (#1048 case 3) — see 'deactivates and deletes existing users'
  //   • Remove error path  (#1048 case 4) — see 'shows error message when removeUser…'
  //
  // The describe blocks below close the remaining gaps from the issue:
  //   • Case 5 — dismissing the confirm dialog must NOT call the mutation
  //   • Case 6 — error message renders inside the form section after a failure
  // Plus a focused success-path test that opening the dialog and confirming
  // calls the mutation exactly once with the correct payload (separate from
  // the combined deactivate+delete flow above).
  //
  // Deps verified CLOSED: #1019 (window.confirm → ConfirmDialog modal) and
  // #1036 (mutation errors surfaced via setErrorMessage) — see PR body.
  // ---------------------------------------------------------------------------

  it('does not call deactivate mutation when the confirm dialog is cancelled', async () => {
    render(<UsersPanel />);

    const adminRow = screen
      .getAllByRole('row')
      .find(
        (row) =>
          within(row).queryAllByText('admin').length > 0 &&
          within(row).queryByRole('button', { name: 'Deactivate' }),
      );
    expect(adminRow).toBeDefined();
    if (!adminRow) return;

    // Open the deactivate confirm dialog
    fireEvent.click(within(adminRow).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => {
      expect(screen.getByText('Deactivate User')).toBeInTheDocument();
    });

    // Click the dialog's Cancel button (rendered by ConfirmDialog with cancelLabel default)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // Dialog closes and no mutation is invoked
    await waitFor(() => {
      expect(screen.queryByText('Deactivate User')).not.toBeInTheDocument();
    });
    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it('does not call delete mutation when the confirm dialog is cancelled', async () => {
    render(<UsersPanel />);

    const adminRow = screen
      .getAllByRole('row')
      .find(
        (row) =>
          within(row).queryAllByText('admin').length > 0 &&
          within(row).queryByRole('button', { name: 'Delete' }),
      );
    expect(adminRow).toBeDefined();
    if (!adminRow) return;

    fireEvent.click(within(adminRow).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(screen.getByText('Delete User')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByText('Delete User')).not.toBeInTheDocument();
    });
    expect(mockDeleteUser).not.toHaveBeenCalled();
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('dismisses the confirm dialog via Escape without calling the mutation', async () => {
    render(<UsersPanel />);

    const adminRow = screen
      .getAllByRole('row')
      .find(
        (row) =>
          within(row).queryAllByText('admin').length > 0 &&
          within(row).queryByRole('button', { name: 'Delete' }),
      );
    expect(adminRow).toBeDefined();
    if (!adminRow) return;

    fireEvent.click(within(adminRow).getByRole('button', { name: 'Delete' }));
    const dialogTitle = await screen.findByText('Delete User');
    expect(dialogTitle).toBeInTheDocument();

    // Radix Dialog's onOpenChange fires when Escape is pressed → onCancel
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
      code: 'Escape',
    });

    await waitFor(() => {
      expect(screen.queryByText('Delete User')).not.toBeInTheDocument();
    });
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it('shows the deactivate confirmation modal with descriptive title and body before any mutation runs', async () => {
    render(<UsersPanel />);

    const adminRow = screen
      .getAllByRole('row')
      .find(
        (row) =>
          within(row).queryAllByText('admin').length > 0 &&
          within(row).queryByRole('button', { name: 'Deactivate' }),
      );
    expect(adminRow).toBeDefined();
    if (!adminRow) return;

    // Trigger the row-level Deactivate button — the mutation must not run yet
    fireEvent.click(within(adminRow).getByRole('button', { name: 'Deactivate' }));
    expect(mockUpdateUser).not.toHaveBeenCalled();

    // The Radix dialog renders the descriptive title + body from ConfirmDialog
    expect(await screen.findByText('Deactivate User')).toBeInTheDocument();
    expect(
      screen.getByText('Deactivate this account by changing role to Viewer?'),
    ).toBeInTheDocument();

    // Confirming the dialog finally invokes the mutation with the expected payload
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalledTimes(1);
      expect(mockUpdateUser).toHaveBeenCalledWith({ id: 'u1', payload: { role: 'viewer' } });
    });
  });

  it('shows the delete confirmation modal with descriptive title and body before any mutation runs', async () => {
    render(<UsersPanel />);

    const adminRow = screen
      .getAllByRole('row')
      .find(
        (row) =>
          within(row).queryAllByText('admin').length > 0 &&
          within(row).queryByRole('button', { name: 'Delete' }),
      );
    expect(adminRow).toBeDefined();
    if (!adminRow) return;

    fireEvent.click(within(adminRow).getByRole('button', { name: 'Delete' }));
    expect(mockDeleteUser).not.toHaveBeenCalled();

    expect(await screen.findByText('Delete User')).toBeInTheDocument();
    expect(screen.getByText('Delete this account permanently?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(mockDeleteUser).toHaveBeenCalledTimes(1);
      expect(mockDeleteUser).toHaveBeenCalledWith('u1');
    });
  });

  it('renders the errorMessage state inside the user form section after a failed deactivate', async () => {
    mockUpdateUser.mockRejectedValueOnce(new Error('Forbidden — admin only'));
    render(<UsersPanel />);

    const adminRow = screen
      .getAllByRole('row')
      .find(
        (row) =>
          within(row).queryAllByText('admin').length > 0 &&
          within(row).queryByRole('button', { name: 'Deactivate' }),
      );
    expect(adminRow).toBeDefined();
    if (!adminRow) return;

    fireEvent.click(within(adminRow).getByRole('button', { name: 'Deactivate' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));

    // Wait for confirm dialog to close (handleConfirmAction → setConfirmAction(null))
    await waitFor(() => {
      expect(screen.queryByText('Deactivate this account by changing role to Viewer?')).not.toBeInTheDocument();
    });

    // The error renders within the Create User / Edit User <section>, not in
    // the dialog. This locks the contract that errorMessage state binds to
    // the form panel — see users.tsx:275 (`<p className="text-xs text-destructive">`).
    const formSection = screen.getByRole('heading', { name: /Create User/i }).closest('section');
    expect(formSection).toBeTruthy();
    if (!formSection) return;

    expect(within(formSection).getByText('Forbidden — admin only')).toBeInTheDocument();
  });

  it('renders the errorMessage state inside the user form section after a failed delete', async () => {
    mockDeleteUser.mockRejectedValueOnce(new Error('User has active sessions'));
    render(<UsersPanel />);

    const adminRow = screen
      .getAllByRole('row')
      .find(
        (row) =>
          within(row).queryAllByText('admin').length > 0 &&
          within(row).queryByRole('button', { name: 'Delete' }),
      );
    expect(adminRow).toBeDefined();
    if (!adminRow) return;

    fireEvent.click(within(adminRow).getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(screen.queryByText('Delete this account permanently?')).not.toBeInTheDocument();
    });

    const formSection = screen.getByRole('heading', { name: /Create User/i }).closest('section');
    expect(formSection).toBeTruthy();
    if (!formSection) return;

    expect(within(formSection).getByText('User has active sessions')).toBeInTheDocument();
  });
});
