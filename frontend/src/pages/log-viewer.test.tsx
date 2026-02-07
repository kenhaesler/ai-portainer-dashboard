import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import LogViewerPage from './log-viewer';

const mockGet = vi.fn().mockImplementation((path: string) => {
  if (path === '/api/logs/config') {
    return Promise.resolve({ configured: false, endpoint: null, indexPattern: null });
  }
  return Promise.resolve({});
});

vi.mock('@tanstack/react-query', () => ({
  useQueries: () => [],
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    put: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('@/hooks/use-endpoints', () => ({
  useEndpoints: () => ({
    data: [{ id: 1, name: 'Local Docker' }],
  }),
}));

vi.mock('@/hooks/use-containers', () => ({
  useContainers: () => ({
    data: [{ id: 'c1', name: 'api', endpointId: 1 }],
  }),
}));

describe('LogViewerPage', () => {
  it('renders page shell and controls', async () => {
    render(<LogViewerPage />);
    await screen.findByText('Open Settings');
    expect(screen.getByText('Log Viewer')).toBeInTheDocument();
    expect(screen.getByText('Elasticsearch Integration')).toBeInTheDocument();
    expect(screen.getByText('Open Settings')).toBeInTheDocument();
    expect(screen.getByText('Regex Search')).toBeInTheDocument();
    expect(screen.getByText('Live Tail ON')).toBeInTheDocument();
    expect(screen.getByText('Select one or more containers to view aggregated logs.')).toBeInTheDocument();
  });
});
