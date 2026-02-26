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
        default_landing_page: '/ai-monitor',
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
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
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

    fireEvent.click(within(adminRow).getByRole('button', { name: 'Deactivate' }));
    fireEvent.click(within(adminRow).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockUpdateUser).toHaveBeenCalledWith({ id: 'u1', payload: { role: 'viewer' } });
      expect(mockDeleteUser).toHaveBeenCalledWith('u1');
    });
  });
});
