import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { McpServerRow } from './tab-ai-llm';
import type { McpServer } from '@/hooks/use-mcp';

// Mock the hooks
const mockMutate = vi.fn();
const mockUpdateMutate = vi.fn();

vi.mock('@/hooks/use-mcp', () => ({
  useConnectMcpServer: () => ({ mutate: vi.fn(), isPending: false }),
  useDisconnectMcpServer: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteMcpServer: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateMcpServer: () => ({ mutate: mockUpdateMutate, isPending: false, isError: false, error: null }),
  useMcpServerTools: () => ({ data: null, isLoading: false }),
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

const stdioServer: McpServer = {
  id: 1,
  name: 'test-stdio-server',
  transport: 'stdio',
  command: 'npx -y @mcp/server',
  url: null,
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

const sseServer: McpServer = {
  id: 2,
  name: 'test-sse-server',
  transport: 'sse',
  command: null,
  url: 'http://localhost:3000/sse',
  args: null,
  env: null,
  enabled: 1,
  disabled_tools: null,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
  connected: true,
  toolCount: 5,
  connectionError: null,
};

describe('McpServerRow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders server info in read-only mode', () => {
    const Wrapper = createWrapper();
    render(<McpServerRow server={stdioServer} />, { wrapper: Wrapper });

    expect(screen.getByText('test-stdio-server')).toBeInTheDocument();
    expect(screen.getByText(/stdio · npx -y @mcp\/server/)).toBeInTheDocument();
  });

  it('renders SSE server with URL', () => {
    const Wrapper = createWrapper();
    render(<McpServerRow server={sseServer} />, { wrapper: Wrapper });

    expect(screen.getByText('test-sse-server')).toBeInTheDocument();
    expect(screen.getByText(/http:\/\/localhost:3000\/sse/)).toBeInTheDocument();
  });

  it('clicking edit shows form with pre-filled values', () => {
    const Wrapper = createWrapper();
    render(<McpServerRow server={stdioServer} />, { wrapper: Wrapper });

    // No form initially
    expect(screen.queryByText('Save')).not.toBeInTheDocument();

    // Click edit button
    fireEvent.click(screen.getByTitle('Edit'));

    // Form should appear with pre-filled values
    expect(screen.getByText('Save')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByDisplayValue('npx -y @mcp/server')).toBeInTheDocument();
  });

  it('edit form shows URL field for SSE transport', () => {
    const Wrapper = createWrapper();
    render(<McpServerRow server={sseServer} />, { wrapper: Wrapper });

    fireEvent.click(screen.getByTitle('Edit'));

    expect(screen.getByDisplayValue('http://localhost:3000/sse')).toBeInTheDocument();
    expect(screen.getByText('URL')).toBeInTheDocument();
  });

  it('edit form switches command/URL based on transport', () => {
    const Wrapper = createWrapper();
    render(<McpServerRow server={stdioServer} />, { wrapper: Wrapper });

    fireEvent.click(screen.getByTitle('Edit'));

    // Initially shows Command field for stdio
    expect(screen.getByText('Command')).toBeInTheDocument();

    // Switch to SSE transport
    fireEvent.change(screen.getByDisplayValue('stdio (local command)'), { target: { value: 'sse' } });

    // Now shows URL field
    expect(screen.getByText('URL')).toBeInTheDocument();
    expect(screen.queryByText('Command')).not.toBeInTheDocument();
  });

  it('save calls updateMutation with correct data', () => {
    const Wrapper = createWrapper();
    render(<McpServerRow server={stdioServer} />, { wrapper: Wrapper });

    fireEvent.click(screen.getByTitle('Edit'));

    // Modify the command
    const input = screen.getByDisplayValue('npx -y @mcp/server');
    fireEvent.change(input, { target: { value: 'npx -y @mcp/new-server' } });

    // Click save
    fireEvent.click(screen.getByText('Save'));

    expect(mockUpdateMutate).toHaveBeenCalledWith(
      { id: 1, body: { transport: 'stdio', command: 'npx -y @mcp/new-server' } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('cancel hides form and resets values', () => {
    const Wrapper = createWrapper();
    render(<McpServerRow server={stdioServer} />, { wrapper: Wrapper });

    fireEvent.click(screen.getByTitle('Edit'));
    expect(screen.getByText('Save')).toBeInTheDocument();

    // Modify and cancel
    const input = screen.getByDisplayValue('npx -y @mcp/server');
    fireEvent.change(input, { target: { value: 'modified-command' } });
    fireEvent.click(screen.getByText('Cancel'));

    // Form should be hidden
    expect(screen.queryByText('Save')).not.toBeInTheDocument();
  });

  it('save disabled when required field empty', () => {
    const Wrapper = createWrapper();
    render(<McpServerRow server={stdioServer} />, { wrapper: Wrapper });

    fireEvent.click(screen.getByTitle('Edit'));

    // Clear the command
    const input = screen.getByDisplayValue('npx -y @mcp/server');
    fireEvent.change(input, { target: { value: '' } });

    // Save button should be disabled
    const saveButton = screen.getByText('Save');
    expect(saveButton).toBeDisabled();
  });
});
