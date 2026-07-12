import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import {
  LlmSettingsSection,
  McpServerRow,
  McpServersSection,
  PromptTestPanel,
  ImportPreviewPanel,
} from './tab-ai-llm';
import type { McpServer } from '@/features/ai-intelligence/hooks/use-mcp';
import { REDACTED_SECRET } from './shared';

const testConnectionMock = vi.fn();

const mcpState = vi.hoisted(() => ({
  isLoading: false,
  servers: [] as unknown[],
}));

vi.mock('@/features/ai-intelligence/hooks/use-mcp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/ai-intelligence/hooks/use-mcp')>();
  return {
    ...actual,
    useMcpServers: () => ({ data: mcpState.servers, isLoading: mcpState.isLoading }),
    useCreateMcpServer: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
    useUpdateMcpServer: () => ({ mutate: vi.fn(), isPending: false }),
    useDeleteMcpServer: () => ({ mutate: vi.fn(), isPending: false }),
    useConnectMcpServer: () => ({ mutate: vi.fn(), isPending: false }),
    useDisconnectMcpServer: () => ({ mutate: vi.fn(), isPending: false }),
    useMcpServerTools: () => ({ data: undefined, isLoading: false }),
  };
});

function makeMcpServer(overrides: Partial<McpServer> = {}): McpServer {
  return {
    id: 1,
    name: 'files',
    transport: 'stdio',
    command: 'mcp-files',
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
    ...overrides,
  };
}

vi.mock('@/features/ai-intelligence/hooks/use-llm-models', () => ({
  useLlmModels: () => ({ data: undefined, isLoading: false, refetch: vi.fn() }),
  useLlmTestConnection: () => ({
    mutate: testConnectionMock,
    isPending: false,
    data: undefined,
  }),
  useLlmTestPrompt: () => ({ mutate: vi.fn(), isPending: false, data: undefined }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
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

const baseValues: Record<string, string> = {
  'llm.api_url': 'https://upstream.example/v1',
  'llm.model': 'gpt-4o-mini',
  'llm.temperature': '0.7',
  'llm.max_tokens': '2048',
  'llm.auth_type': 'bearer',
};

describe('LlmSettingsSection — Test Connection token sanitisation', () => {
  beforeEach(() => {
    testConnectionMock.mockReset();
  });

  it('does NOT send the redaction sentinel as the token when user has not retyped it', () => {
    const values = {
      ...baseValues,
      'llm.api_token': REDACTED_SECRET,
    };

    render(
      <LlmSettingsSection
        values={values}
        originalValues={values}
        onChange={vi.fn()}
        disabled={false}
      />,
      { wrapper: createWrapper() },
    );

    fireEvent.click(screen.getByRole('button', { name: /test connection/i }));

    expect(testConnectionMock).toHaveBeenCalledTimes(1);
    const body = testConnectionMock.mock.calls[0][0];
    expect(body.url).toBe('https://upstream.example/v1');
    expect(body.token).toBeUndefined();
  });

  it('sends a real typed token through unchanged', () => {
    const values = {
      ...baseValues,
      'llm.api_token': 'sk-real-token',
    };

    render(
      <LlmSettingsSection
        values={values}
        originalValues={values}
        onChange={vi.fn()}
        disabled={false}
      />,
      { wrapper: createWrapper() },
    );

    fireEvent.click(screen.getByRole('button', { name: /test connection/i }));

    expect(testConnectionMock).toHaveBeenCalledTimes(1);
    const body = testConnectionMock.mock.calls[0][0];
    expect(body.url).toBe('https://upstream.example/v1');
    expect(body.token).toBe('sk-real-token');
  });
});

describe('LlmSettingsSection — model use-case reference table (DataTable)', () => {
  it('renders the model use-case table via the shared DataTable when expanded', () => {
    render(
      <LlmSettingsSection
        values={baseValues}
        originalValues={baseValues}
        onChange={vi.fn()}
        disabled={false}
      />,
      { wrapper: createWrapper() },
    );

    // Table is collapsed by default; the "All models" toggle reveals it.
    fireEvent.click(screen.getByRole('button', { name: /all models/i }));

    // Shared DataTable rendered (carries data-testid="data-table").
    const table = screen.getByTestId('data-table');
    expect(table).toBeInTheDocument();

    // The "Label" / "Description" headers are unique to the table.
    expect(screen.getByText('Label')).toBeInTheDocument();
    expect(screen.getByText('Description')).toBeInTheDocument();

    // Known reference rows render inside the table.
    expect(screen.getByText('qwen3:32b')).toBeInTheDocument();
    expect(screen.getByText('phi-4')).toBeInTheDocument();
    expect(screen.getAllByText('Gold Standard').length).toBeGreaterThan(0);
  });
});

describe('MCP servers — connection state and loading (#1548, #1549)', () => {
  it('exposes a connected server state as text, not color alone', () => {
    render(<McpServerRow server={makeMcpServer({ connected: true })} />, {
      wrapper: createWrapper(),
    });
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('exposes a disconnected server state as text, not color alone', () => {
    render(<McpServerRow server={makeMcpServer({ connected: false })} />, {
      wrapper: createWrapper(),
    });
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });

  it('renders a skeleton list instead of raw loading text while servers load', () => {
    mcpState.isLoading = true;
    try {
      render(<McpServersSection />, { wrapper: createWrapper() });
      expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
      expect(screen.queryByText('Loading servers...')).not.toBeInTheDocument();
    } finally {
      mcpState.isLoading = false;
    }
  });
});

describe('Prompt panels — icon-only close buttons expose names (#1540)', () => {
  it('labels the test-results close button', () => {
    render(
      <PromptTestPanel feature="chat" systemPrompt="prompt" model="" temperature="" />,
      { wrapper: createWrapper() },
    );

    fireEvent.click(screen.getByRole('button', { name: /test prompt/i }));
    expect(screen.getByRole('button', { name: 'Close test results' })).toBeInTheDocument();
  });

  it('labels the import-preview close button', () => {
    const preview = {
      profile: 'default',
      featureCount: 1,
      exportedFrom: undefined,
      changes: {},
      summary: { modified: 0, added: 0, unchanged: 0 },
    };
    render(
      <ImportPreviewPanel
        preview={preview as never}
        importData={{} as never}
        features={[]}
        onCancel={vi.fn()}
        onApply={vi.fn()}
        isApplying={false}
      />,
      { wrapper: createWrapper() },
    );

    expect(screen.getByRole('button', { name: 'Close import preview' })).toBeInTheDocument();
  });
});
