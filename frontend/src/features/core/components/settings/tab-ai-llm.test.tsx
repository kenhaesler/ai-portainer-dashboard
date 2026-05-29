import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { LlmSettingsSection } from './tab-ai-llm';
import { REDACTED_SECRET } from './shared';

const testConnectionMock = vi.fn();

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
