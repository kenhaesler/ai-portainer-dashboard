import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, ShieldAlert, UserPlus, Users as UsersIcon, Trash2, UserCog } from 'lucide-react';
import { useAuth } from '@/providers/auth-provider';
import { ThemedSelect } from '@/shared/components/themed-select';
import { useCreateUser, useDeleteUser, useUpdateUser, useUsers, type UserRole } from '@/features/core/hooks/use-users';
import { cn, formatDate } from '@/shared/lib/utils';

interface UserForm {
  username: string;
  password: string;
  role: UserRole;
}

const initialForm: UserForm = {
  username: '',
  password: '',
  role: 'viewer',
};

export function UsersPanel() {
  const { role } = useAuth();
  const usersQuery = useUsers();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();

  const [form, setForm] = useState<UserForm>(initialForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editHighlight, setEditHighlight] = useState(false);
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [search, setSearch] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const formSectionRef = useRef<HTMLElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(highlightTimer.current), []);

  const filteredUsers = useMemo(() => {
    const all = usersQuery.data ?? [];
    return all.filter((user) => {
      if (roleFilter !== 'all' && user.role !== roleFilter) return false;
      if (search && !user.username.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [roleFilter, search, usersQuery.data]);

  const resetForm = () => {
    setForm(initialForm);
    setEditingId(null);
    setEditHighlight(false);
    setErrorMessage(null);
  };

  const saveUser = async () => {
    const username = form.username.trim();
    if (!username) {
      setErrorMessage('Username is required.');
      return;
    }

    try {
      if (editingId) {
        const payload: { username?: string; password?: string; role?: UserRole } = {
          username,
          role: form.role,
        };
        if (form.password.trim()) payload.password = form.password;
        await updateUser.mutateAsync({ id: editingId, payload });
      } else {
        if (form.password.length < 8) {
          setErrorMessage('Password must be at least 8 characters.');
          return;
        }
        await createUser.mutateAsync({ username, password: form.password, role: form.role });
      }
      resetForm();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to save user');
    }
  };

  const startEdit = (user: { id: string; username: string; role: UserRole }) => {
    setEditingId(user.id);
    setForm({ username: user.username, password: '', role: user.role });
    setErrorMessage(null);
    // Scroll form into view and focus first input for immediate keyboard access
    requestAnimationFrame(() => {
      formSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      firstInputRef.current?.focus();
      // Trigger highlight pulse animation — clear previous timer to prevent stacking
      clearTimeout(highlightTimer.current);
      setEditHighlight(true);
      highlightTimer.current = setTimeout(() => setEditHighlight(false), 1200);
    });
  };

  const deactivateUser = async (userId: string) => {
    if (!window.confirm('Deactivate this account by changing role to Viewer?')) return;
    await updateUser.mutateAsync({ id: userId, payload: { role: 'viewer' } });
  };

  const removeUser = async (userId: string) => {
    if (!window.confirm('Delete this account permanently?')) return;
    await deleteUser.mutateAsync(userId);
  };

  if (role !== 'admin') {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-6">
        <div className="flex items-center gap-2 text-destructive">
          <ShieldAlert className="h-5 w-5" />
          <h1 className="text-lg font-semibold">Admin Access Required</h1>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          User management is restricted to administrators.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-5">
        <section className="rounded-lg border bg-card p-4 lg:col-span-3">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search username..."
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            />
            <ThemedSelect
              value={roleFilter}
              onValueChange={(val) => setRoleFilter(val as 'all' | UserRole)}
              options={[
                { value: 'all', label: 'All Roles' },
                { value: 'admin', label: 'Admin' },
                { value: 'operator', label: 'Operator' },
                { value: 'viewer', label: 'Viewer' },
              ]}
            />
          </div>

          {usersQuery.isLoading ? (
            <div className="space-y-2">
              <div className="h-10 animate-pulse rounded bg-muted" />
              <div className="h-10 animate-pulse rounded bg-muted" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-2.5 font-medium">User</th>
                    <th className="px-2 py-2.5 font-medium">Role</th>
                    <th className="px-2 py-2.5 font-medium">Created</th>
                    <th className="px-2 py-2.5 font-medium">Updated</th>
                    <th className="px-2 py-2.5 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user) => (
                    <tr key={user.id} className="border-b last:border-0">
                      <td className="px-2 py-2.5 font-medium">{user.username}</td>
                      <td className="px-2 py-2.5 capitalize">{user.role}</td>
                      <td className="px-2 py-2.5 text-xs text-muted-foreground">{formatDate(user.created_at)}</td>
                      <td className="px-2 py-2.5 text-xs text-muted-foreground">{formatDate(user.updated_at)}</td>
                      <td className="px-2 py-2.5">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => startEdit(user)}
                            className="rounded-md border border-input bg-background px-2 py-1 text-xs font-medium hover:bg-accent"
                          >
                            Edit
                          </button>
                          {user.role !== 'viewer' && (
                            <button
                              type="button"
                              onClick={() => void deactivateUser(user.id)}
                              className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300"
                            >
                              Deactivate
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void removeUser(user.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredUsers.length === 0 && (
                <p className="mt-2 text-xs text-muted-foreground">No users match the current filters.</p>
              )}
            </div>
          )}
        </section>

        <section
          ref={formSectionRef}
          className={cn(
            'rounded-lg border bg-card p-4 lg:col-span-2 transition-all duration-300',
            editHighlight && 'ring-2 ring-primary/60 shadow-md shadow-primary/10',
          )}
        >
          <h2 className="inline-flex items-center gap-2 text-base font-semibold">
            {editingId ? <UserCog className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
            {editingId ? 'Edit User' : 'Create User'}
          </h2>

          <div className="mt-3 space-y-3 text-sm">
            <label className="block">
              <span className="mb-1 block text-muted-foreground">Username</span>
              <input
                ref={firstInputRef}
                value={form.username}
                onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
                className="h-9 w-full rounded-md border border-input bg-background px-2"
                placeholder="ops-bot"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-muted-foreground">Password {editingId ? '(optional)' : ''}</span>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                className="h-9 w-full rounded-md border border-input bg-background px-2"
                placeholder={editingId ? 'Leave blank to keep current password' : 'Minimum 8 characters'}
              />
            </label>

            <div className="block">
              <span className="mb-1 block text-muted-foreground">Role</span>
              <ThemedSelect
                value={form.role}
                onValueChange={(val) => setForm((prev) => ({ ...prev, role: val as UserRole }))}
                options={[
                  { value: 'admin', label: 'Admin' },
                  { value: 'operator', label: 'Operator' },
                  { value: 'viewer', label: 'Viewer' },
                ]}
                className="w-full"
              />
            </div>

            {errorMessage && <p className="text-xs text-destructive">{errorMessage}</p>}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void saveUser()}
                disabled={createUser.isPending || updateUser.isPending}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {(createUser.isPending || updateUser.isPending) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UsersIcon className="h-3.5 w-3.5" />}
                {editingId ? 'Update User' : 'Create User'}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent"
              >
                Reset
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

export default function UsersPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">User Management</h1>
          <p className="text-muted-foreground">Manage account roles and access for dashboard operators.</p>
        </div>
      </div>
      <UsersPanel />
    </div>
  );
}
