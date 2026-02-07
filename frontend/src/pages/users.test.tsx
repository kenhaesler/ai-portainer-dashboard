import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const mockCreateUser = vi.fn();
const mockUpdateUser = vi.fn();
const mockDeleteUser = vi.fn();

const mockUseAuth = vi.fn();

vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/hooks/use-users', () => ({
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

import UsersPage from './users';

describe('UsersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    mockUseAuth.mockReturnValue({ role: 'admin' });
  });

  it('shows admin-only warning for non-admin users', () => {
    mockUseAuth.mockReturnValue({ role: 'viewer' });
    render(<UsersPage />);
    expect(screen.getByText('Admin Access Required')).toBeInTheDocument();
  });

  it('creates a new user account', async () => {
    render(<UsersPage />);

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

  it('deactivates and deletes existing users', async () => {
    render(<UsersPage />);

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
