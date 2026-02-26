import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type UserRole = 'viewer' | 'operator' | 'admin';

export interface UserRecord {
  id: string;
  username: string;
  role: UserRole;
  default_landing_page: string;
  created_at: string;
  updated_at: string;
}

export interface CreateUserInput {
  username: string;
  password: string;
  role: UserRole;
}

export interface UpdateUserInput {
  username?: string;
  password?: string;
  role?: UserRole;
}

const usersKey = ['users'] as const;

export function useUsers() {
  return useQuery<UserRecord[]>({
    queryKey: usersKey,
    queryFn: () => api.get<UserRecord[]>('/api/users'),
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateUserInput) => api.post<UserRecord>('/api/users', payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: usersKey }),
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateUserInput }) =>
      api.request<UserRecord>(`/api/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: usersKey }),
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ success: boolean }>(`/api/users/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: usersKey }),
  });
}
