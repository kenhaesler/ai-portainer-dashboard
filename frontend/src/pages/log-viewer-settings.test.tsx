import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockGet = vi.fn();
const mockPut = vi.fn();
const mockPost = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQueries: () => [],
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    put: (...args: unknown[]) => mockPut(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

vi.mock('@/hooks/use-endpoints', () => ({
  useEndpoints: () => ({ data: [{ id: 1, name: 'Local Docker' }] }),
}));

vi.mock('@/hooks/use-containers', () => ({
  useContainers: () => ({ data: [{ id: 'c1', name: 'api', endpointId: 1 }] }),
}));

import LogViewerPage from './log-viewer';

describe('LogViewerPage logs settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGet.mockImplementation((path: string) => {
      if (path === '/api/settings') {
        return Promise.resolve([
          { key: 'elasticsearch.enabled', value: 'true' },
          { key: 'elasticsearch.endpoint', value: 'https://logs.example:9200' },
          { key: 'elasticsearch.api_key', value: 'abc123' },
          { key: 'elasticsearch.index_pattern', value: 'logs-*' },
          { key: 'elasticsearch.verify_ssl', value: 'true' },
        ]);
      }
      if (path === '/api/logs/config') {
        return Promise.resolve({ configured: true, endpoint: 'https://logs.example:9200', indexPattern: 'logs-*' });
      }
      return Promise.resolve({});
    });

    mockPut.mockResolvedValue({});
    mockPost.mockResolvedValue({ success: true, cluster_name: 'logs-cluster', status: 'green', number_of_nodes: 3 });
  });

  it('saves logs settings and tests connection', async () => {
    render(<LogViewerPage />);

    const endpointInput = await screen.findByPlaceholderText('https://logs.internal:9200');
    fireEvent.change(endpointInput, { target: { value: 'https://logs.internal:9200' } });

    fireEvent.click(screen.getByText('Test Connection'));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/api/logs/test-connection', {
        endpoint: 'https://logs.internal:9200',
        apiKey: 'abc123',
      });
      expect(screen.getByText('Connection successful')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Save Settings'));

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalled();
      expect(screen.getByText('Saved')).toBeInTheDocument();
    });
  });

  it('shows validation message for invalid endpoint', async () => {
    render(<LogViewerPage />);

    const endpointInput = await screen.findByPlaceholderText('https://logs.internal:9200');
    fireEvent.change(endpointInput, { target: { value: 'not-a-url' } });

    expect(screen.getByText('Enter a valid URL (for example: https://logs.internal:9200)')).toBeInTheDocument();
    expect(screen.getByText('Test Connection')).toBeDisabled();
  });
});
