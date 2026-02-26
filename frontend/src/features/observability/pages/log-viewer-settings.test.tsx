import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ElasticsearchSettingsSection } from '@/features/core/pages/settings';

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock('@/shared/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    patch: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

const defaultValues: Record<string, string> = {
  'elasticsearch.enabled': 'true',
  'elasticsearch.endpoint': 'https://logs.example:9200',
  'elasticsearch.api_key': 'abc123',
  'elasticsearch.index_pattern': 'logs-*',
  'elasticsearch.verify_ssl': 'true',
};

describe('ElasticsearchSettingsSection', () => {
  let onChange: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    onChange = vi.fn();

    mockGet.mockImplementation((path: string) => {
      if (path === '/api/logs/config') {
        return Promise.resolve({ configured: true, endpoint: 'https://logs.example:9200', indexPattern: 'logs-*' });
      }
      return Promise.resolve({});
    });

    mockPost.mockResolvedValue({ success: true, cluster_name: 'logs-cluster', status: 'green', number_of_nodes: 3 });
  });

  it('tests connection with settings payload including verifySsl', async () => {
    render(
      <ElasticsearchSettingsSection
        values={defaultValues}
        originalValues={defaultValues}
        onChange={onChange}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /test connection/i }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/api/logs/test-connection', {
        endpoint: 'https://logs.example:9200',
        apiKey: 'abc123',
        verifySsl: true,
      });
      expect(screen.getByText('Connection successful')).toBeInTheDocument();
    });
  });

  it('shows validation message for invalid endpoint and disables test button', async () => {
    const values = {
      ...defaultValues,
      'elasticsearch.endpoint': 'not-a-url',
    };

    render(
      <ElasticsearchSettingsSection
        values={values}
        originalValues={values}
        onChange={onChange}
      />,
    );

    await screen.findByText('Elasticsearch / Kibana');
    expect(screen.getByText('Enter a valid URL (for example: https://logs.internal:9200)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /test connection/i })).toBeDisabled();
  });

  it('toggles enable switch through onChange', async () => {
    render(
      <ElasticsearchSettingsSection
        values={defaultValues}
        originalValues={defaultValues}
        onChange={onChange}
      />,
    );

    await screen.findByText('Elasticsearch / Kibana');
    const toggle = screen.getByRole('button', { name: 'Toggle Elasticsearch logs' });
    fireEvent.click(toggle);

    expect(onChange).toHaveBeenCalledWith('elasticsearch.enabled', 'false');
  });
});
