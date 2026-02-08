import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// ─── Types ──────────────────────────────────────────────────────────────

export interface McpServer {
  id: number;
  name: string;
  transport: 'stdio' | 'sse' | 'http';
  command: string | null;
  url: string | null;
  args: string | null;
  env: string | null;
  enabled: number;
  disabled_tools: string | null;
  created_at: string;
  updated_at: string;
  connected: boolean;
  toolCount: number;
  connectionError: string | null;
}

export interface McpTool {
  serverName: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpServerCreate {
  name: string;
  transport: 'stdio' | 'sse' | 'http';
  command?: string;
  url?: string;
  args?: string;
  env?: string;
  enabled?: boolean;
  disabled_tools?: string;
}

export type McpServerUpdate = Partial<McpServerCreate>;

// ─── Hooks ──────────────────────────────────────────────────────────────

export function useMcpServers() {
  return useQuery<McpServer[]>({
    queryKey: ['mcp-servers'],
    queryFn: () => api.get<McpServer[]>('/api/mcp/servers'),
    staleTime: 10_000,
    retry: 1,
  });
}

export function useCreateMcpServer() {
  const queryClient = useQueryClient();
  return useMutation<McpServer, Error, McpServerCreate>({
    mutationFn: (body) => api.post<McpServer>('/api/mcp/servers', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mcp-servers'] });
    },
  });
}

export function useUpdateMcpServer() {
  const queryClient = useQueryClient();
  return useMutation<McpServer, Error, { id: number; body: McpServerUpdate }>({
    mutationFn: ({ id, body }) => api.put<McpServer>(`/api/mcp/servers/${id}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mcp-servers'] });
    },
  });
}

export function useDeleteMcpServer() {
  const queryClient = useQueryClient();
  return useMutation<{ success: boolean }, Error, number>({
    mutationFn: (id) => api.delete<{ success: boolean }>(`/api/mcp/servers/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mcp-servers'] });
    },
  });
}

export function useConnectMcpServer() {
  const queryClient = useQueryClient();
  return useMutation<{ success: boolean; name: string; connected: boolean }, Error, number>({
    mutationFn: (id) => api.post<{ success: boolean; name: string; connected: boolean }>(`/api/mcp/servers/${id}/connect`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mcp-servers'] });
    },
  });
}

export function useDisconnectMcpServer() {
  const queryClient = useQueryClient();
  return useMutation<{ success: boolean; name: string; connected: boolean }, Error, number>({
    mutationFn: (id) => api.post<{ success: boolean; name: string; connected: boolean }>(`/api/mcp/servers/${id}/disconnect`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mcp-servers'] });
    },
  });
}

export function useMcpServerTools(serverId: number, enabled: boolean) {
  return useQuery<{ server: string; tools: McpTool[] }>({
    queryKey: ['mcp-server-tools', serverId],
    queryFn: () => api.get<{ server: string; tools: McpTool[] }>(`/api/mcp/servers/${serverId}/tools`),
    enabled,
    staleTime: 30_000,
    retry: 1,
  });
}
