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

  it('filter section has higher z-index than log output area (#404)', () => {
    const { container } = render(<LogViewerPage />);

    // The filter section (with backdrop-blur) must have z-20 so its dropdown floats above the log area
    const filterSection = container.querySelector('section.z-20');
    expect(filterSection).toBeInTheDocument();
    expect(filterSection).toHaveClass('backdrop-blur');

    // The log output section must have z-10 so it sits below the filter dropdown
    const logSection = container.querySelector('section.z-10');
    expect(logSection).toBeInTheDocument();
    expect(logSection).toHaveClass('overflow-hidden');
  });
});
