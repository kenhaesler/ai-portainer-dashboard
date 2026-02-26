import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { EndpointHealthTreemap, getHealthColor_testable } from './endpoint-health-treemap';

// Recharts ResponsiveContainer needs explicit dimensions in jsdom
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: any) => (
      <div data-testid="responsive-container" style={{ width: 800, height: 400 }}>
        {children}
      </div>
    ),
  };
});

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

const makeEndpoint = (id: number, name: string, running: number, stopped: number) => ({
  id,
  name,
  running,
  stopped,
  total: running + stopped,
});

describe('EndpointHealthTreemap', () => {
  it('shows empty state when no endpoints', () => {
    renderWithRouter(<EndpointHealthTreemap endpoints={[]} />);
    expect(screen.getByText('No endpoint data')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    renderWithRouter(<EndpointHealthTreemap endpoints={[]} isLoading />);
    expect(screen.queryByText('No endpoint data')).not.toBeInTheDocument();
  });

  it('renders without crashing with 5 endpoints', () => {
    const endpoints = [
      makeEndpoint(1, 'Production', 10, 2),
      makeEndpoint(2, 'Staging', 5, 1),
      makeEndpoint(3, 'Development', 3, 5),
      makeEndpoint(4, 'Testing', 2, 8),
      makeEndpoint(5, 'CI/CD', 1, 0),
    ];

    renderWithRouter(<EndpointHealthTreemap endpoints={endpoints} />);
    expect(screen.queryByText('No endpoint data')).not.toBeInTheDocument();
    // Legend rendered
    expect(screen.getByText('>80% healthy')).toBeInTheDocument();
    expect(screen.getByText('50-80%')).toBeInTheDocument();
    expect(screen.getByText('<50%')).toBeInTheDocument();
    // Treemap chart container rendered
    expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
  });

  it('renders with 50 endpoints without crashing', () => {
    const endpoints = Array.from({ length: 50 }, (_, i) =>
      makeEndpoint(i + 1, `Endpoint-${i + 1}`, Math.floor(Math.random() * 20) + 1, Math.floor(Math.random() * 5)),
    );

    renderWithRouter(<EndpointHealthTreemap endpoints={endpoints} />);
    expect(screen.queryByText('No endpoint data')).not.toBeInTheDocument();
    expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
  });

  it('renders endpoints even when total containers are 0', () => {
    const endpoints = [
      makeEndpoint(1, 'HasContainers', 5, 2),
      makeEndpoint(2, 'EmptyEndpoint', 0, 0),
    ];

    renderWithRouter(<EndpointHealthTreemap endpoints={endpoints} />);
    expect(screen.queryByText('No endpoint data')).not.toBeInTheDocument();
  });

  it('does not show empty state when all endpoints have 0 containers', () => {
    const endpoints = [
      makeEndpoint(1, 'Empty1', 0, 0),
      makeEndpoint(2, 'Empty2', 0, 0),
    ];

    renderWithRouter(<EndpointHealthTreemap endpoints={endpoints} />);
    expect(screen.queryByText('No endpoint data')).not.toBeInTheDocument();
  });
});

describe('getHealthColor_testable', () => {
  it('returns green for >80% health', () => {
    expect(getHealthColor_testable(0.9)).toBe('#22c55e');
    expect(getHealthColor_testable(0.81)).toBe('#22c55e');
    expect(getHealthColor_testable(1)).toBe('#22c55e');
  });

  it('returns amber for 50-80% health', () => {
    expect(getHealthColor_testable(0.8)).toBe('#f59e0b');
    expect(getHealthColor_testable(0.5)).toBe('#f59e0b');
    expect(getHealthColor_testable(0.65)).toBe('#f59e0b');
  });

  it('returns red for <50% health', () => {
    expect(getHealthColor_testable(0.49)).toBe('#ef4444');
    expect(getHealthColor_testable(0)).toBe('#ef4444');
    expect(getHealthColor_testable(0.1)).toBe('#ef4444');
  });
});
