import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { useMcpServers, useMcpServerTools, useUpdateMcpServer } from './use-mcp';

// Mock the api client
const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPut = vi.fn();
const mockDelete = vi.fn();

vi.mock('@/shared/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    put: (...args: unknown[]) => mockPut(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe('use-mcp hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useMcpServers', () => {
    it('fetches servers from API', async () => {
      const mockServers = [
        {
          id: 1,
          name: 'test-server',
          transport: 'stdio' as const,
          command: 'npx server',
          url: null,
          args: null,
          env: null,
          enabled: 1,
          disabled_tools: null,
          created_at: '2026-01-01',
          updated_at: '2026-01-01',
          connected: true,
          toolCount: 3,
          connectionError: null,
        },
      ];
      mockGet.mockResolvedValue(mockServers);

      const { result } = renderHook(() => useMcpServers(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockServers);
      expect(mockGet).toHaveBeenCalledWith('/api/mcp/servers');
    });

    it('handles API errors', async () => {
      mockGet.mockRejectedValue(new Error('Unauthorized'));

      const { result } = renderHook(() => useMcpServers(), { wrapper: createWrapper() });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      }, { timeout: 5000 });
    });
  });

  describe('useMcpServerTools', () => {
    it('fetches tools when enabled', async () => {
      const mockTools = {
        server: 'test',
        tools: [
          { serverName: 'test', name: 'read_file', description: 'Read a file', inputSchema: {} },
        ],
      };
      mockGet.mockResolvedValue(mockTools);

      const { result } = renderHook(
        () => useMcpServerTools(1, true),
        { wrapper: createWrapper() },
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual(mockTools);
      expect(mockGet).toHaveBeenCalledWith('/api/mcp/servers/1/tools');
    });

    it('does not fetch when disabled', () => {
      const { result } = renderHook(
        () => useMcpServerTools(1, false),
        { wrapper: createWrapper() },
      );

      expect(result.current.isFetching).toBe(false);
      expect(mockGet).not.toHaveBeenCalled();
    });
  });

  describe('useUpdateMcpServer', () => {
    it('calls PUT /api/mcp/servers/:id with update body', async () => {
      const updatedServer = {
        id: 1,
        name: 'test-server',
        transport: 'sse' as const,
        command: null,
        url: 'http://localhost:3000/sse',
        args: null,
        env: null,
        enabled: 1,
        disabled_tools: null,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
        connected: false,
        toolCount: 0,
        connectionError: null,
      };
      mockPut.mockResolvedValue(updatedServer);

      const { result } = renderHook(() => useUpdateMcpServer(), { wrapper: createWrapper() });

      result.current.mutate({ id: 1, body: { transport: 'sse', url: 'http://localhost:3000/sse' } });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(mockPut).toHaveBeenCalledWith('/api/mcp/servers/1', { transport: 'sse', url: 'http://localhost:3000/sse' });
    });
  });
});
