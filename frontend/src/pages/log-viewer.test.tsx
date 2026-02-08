import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import LogViewerPage from './log-viewer';

vi.mock('@tanstack/react-query', () => ({
  useQueries: () => [],
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
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
    data: [{ id: 'c1', name: 'api', endpointId: 1, state: 'running', labels: {} }],
  }),
}));

describe('LogViewerPage', () => {
  it('renders page shell and controls', () => {
    render(<LogViewerPage />);
    expect(screen.getByText('Log Viewer')).toBeInTheDocument();
    expect(screen.getByText('Regex Search')).toBeInTheDocument();
    expect(screen.getByText('Live Tail ON')).toBeInTheDocument();
    expect(screen.getByText('Select one or more containers to view aggregated logs.')).toBeInTheDocument();
  });
});
