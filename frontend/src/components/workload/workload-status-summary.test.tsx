import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Container } from '@/hooks/use-containers';

vi.mock('framer-motion', () => ({
  motion: {
    button: ({ children, ...props }: React.ComponentProps<'button'>) => <button {...props}>{children}</button>,
    div: ({ children, ...props }: React.ComponentProps<'div'>) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => false,
}));

import { WorkloadStatusSummary } from './workload-status-summary';

const makeContainer = (overrides: Partial<Container> = {}): Container => ({
  id: `c-${Math.random().toString(36).slice(2)}`,
  name: 'test-container',
  image: 'test:latest',
  state: 'running',
  status: 'Up',
  endpointId: 1,
  endpointName: 'local',
  ports: [],
  created: 1700000000,
  labels: {},
  networks: [],
  ...overrides,
});

describe('WorkloadStatusSummary', () => {
  it('renders total count and state pills', () => {
    const containers = [
      makeContainer({ state: 'running' }),
      makeContainer({ state: 'running' }),
      makeContainer({ state: 'stopped' }),
    ];
    const onChange = vi.fn();
    render(
      <WorkloadStatusSummary
        containers={containers}
        activeStateFilter={undefined}
        onStateFilterChange={onChange}
      />,
    );

    expect(screen.getByText('Total: 3')).toBeInTheDocument();
    expect(screen.getByTitle('Filter by running')).toBeInTheDocument();
    expect(screen.getByTitle('Filter by stopped')).toBeInTheDocument();
  });

  it('calls onStateFilterChange when a pill is clicked', () => {
    const containers = [makeContainer({ state: 'running' })];
    const onChange = vi.fn();
    render(
      <WorkloadStatusSummary
        containers={containers}
        activeStateFilter={undefined}
        onStateFilterChange={onChange}
      />,
    );

    fireEvent.click(screen.getByTitle('Filter by running'));
    expect(onChange).toHaveBeenCalledWith('running');
  });

  it('clears filter when active pill is clicked', () => {
    const containers = [makeContainer({ state: 'running' })];
    const onChange = vi.fn();
    render(
      <WorkloadStatusSummary
        containers={containers}
        activeStateFilter="running"
        onStateFilterChange={onChange}
      />,
    );

    fireEvent.click(screen.getByTitle('Clear running filter'));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('clears filter when Total is clicked', () => {
    const containers = [makeContainer({ state: 'running' })];
    const onChange = vi.fn();
    render(
      <WorkloadStatusSummary
        containers={containers}
        activeStateFilter="running"
        onStateFilterChange={onChange}
      />,
    );

    fireEvent.click(screen.getByText('Total: 1'));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('returns null when no containers', () => {
    const onChange = vi.fn();
    const { container } = render(
      <WorkloadStatusSummary
        containers={[]}
        activeStateFilter={undefined}
        onStateFilterChange={onChange}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
