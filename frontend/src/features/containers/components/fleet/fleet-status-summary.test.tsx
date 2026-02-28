import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FleetStatusSummary, type FleetStatusSummaryProps } from './fleet-status-summary';
import type { Endpoint } from '@/features/containers/hooks/use-endpoints';

// Mock framer-motion to avoid animation complexity in tests
vi.mock('framer-motion', () => ({
  motion: {
    button: ({ children, ...props }: React.PropsWithChildren<React.ButtonHTMLAttributes<HTMLButtonElement>>) => {
      const { initial, animate, exit, transition: _transition, ...rest } = props as any;
      return <button {...rest}>{children}</button>;
    },
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
  useReducedMotion: () => false,
}));

function makeEndpoint(overrides: Partial<Endpoint> = {}): Endpoint {
  return {
    id: 1,
    name: 'test-ep',
    type: 1,
    url: 'tcp://10.0.0.1:9001',
    status: 'up',
    containersRunning: 5,
    containersStopped: 1,
    containersHealthy: 4,
    containersUnhealthy: 0,
    totalContainers: 6,
    stackCount: 2,
    totalCpu: 4,
    totalMemory: 8589934592,
    isEdge: false,
    edgeMode: null,
    snapshotAge: null,
    checkInInterval: null,
    capabilities: { exec: true, realtimeLogs: true, liveStats: true, immediateActions: true },
    ...overrides,
  };
}

function renderSummary(overrides: Partial<FleetStatusSummaryProps> = {}) {
  const defaultProps: FleetStatusSummaryProps = {
    endpoints: [],
    stacks: [],
    activeEndpointStatusFilter: undefined,
    onEndpointStatusChange: vi.fn(),
    activeStackStatusFilter: undefined,
    onStackStatusChange: vi.fn(),
    ...overrides,
  };
  return { ...render(<FleetStatusSummary {...defaultProps} />), props: defaultProps };
}

describe('FleetStatusSummary — endpoint section', () => {
  it('renders endpoint total count', () => {
    renderSummary({
      endpoints: [
        makeEndpoint({ id: 1, status: 'up' }),
        makeEndpoint({ id: 2, status: 'down' }),
      ],
    });

    expect(screen.getByTestId('endpoint-total')).toHaveTextContent('2 endpoints');
  });

  it('renders singular "endpoint" for single endpoint', () => {
    renderSummary({
      endpoints: [makeEndpoint({ id: 1, status: 'up' })],
    });

    expect(screen.getByTestId('endpoint-total')).toHaveTextContent('1 endpoint');
  });

  it('renders up and down status pills with counts', () => {
    renderSummary({
      endpoints: [
        makeEndpoint({ id: 1, status: 'up' }),
        makeEndpoint({ id: 2, status: 'up' }),
        makeEndpoint({ id: 3, status: 'down' }),
      ],
    });

    const upPill = screen.getByTestId('status-pill-up');
    expect(upPill).toHaveTextContent('Up');
    expect(upPill).toHaveTextContent('(2)');

    const downPill = screen.getByTestId('status-pill-down');
    expect(downPill).toHaveTextContent('Down');
    expect(downPill).toHaveTextContent('(1)');
  });

  it('shows zero count with opacity when no endpoints are down', () => {
    renderSummary({
      endpoints: [
        makeEndpoint({ id: 1, status: 'up' }),
        makeEndpoint({ id: 2, status: 'up' }),
      ],
    });

    const downPill = screen.getByTestId('status-pill-down');
    expect(downPill).toHaveTextContent('(0)');
    expect(downPill.className).toContain('opacity-50');
  });

  it('calls onEndpointStatusChange with "up" when Up pill clicked', () => {
    const onEndpointStatusChange = vi.fn();
    renderSummary({
      endpoints: [makeEndpoint({ id: 1, status: 'up' })],
      onEndpointStatusChange,
    });

    fireEvent.click(screen.getByTestId('status-pill-up'));
    expect(onEndpointStatusChange).toHaveBeenCalledWith('up');
  });

  it('calls onEndpointStatusChange with undefined when active Up pill clicked', () => {
    const onEndpointStatusChange = vi.fn();
    renderSummary({
      endpoints: [makeEndpoint({ id: 1, status: 'up' })],
      activeEndpointStatusFilter: 'up',
      onEndpointStatusChange,
    });

    fireEvent.click(screen.getByTestId('status-pill-up'));
    expect(onEndpointStatusChange).toHaveBeenCalledWith(undefined);
  });

  it('applies ring highlight to active endpoint pill', () => {
    renderSummary({
      endpoints: [makeEndpoint({ id: 1, status: 'up' })],
      activeEndpointStatusFilter: 'up',
    });

    const upPill = screen.getByTestId('status-pill-up');
    expect(upPill.className).toContain('ring-2');
    expect(upPill.className).toContain('ring-primary');
  });

  it('calls onEndpointStatusChange(undefined) when total button clicked', () => {
    const onEndpointStatusChange = vi.fn();
    renderSummary({
      endpoints: [makeEndpoint({ id: 1, status: 'up' })],
      activeEndpointStatusFilter: 'up',
      onEndpointStatusChange,
    });

    fireEvent.click(screen.getByTestId('endpoint-total'));
    expect(onEndpointStatusChange).toHaveBeenCalledWith(undefined);
  });

  it('renders endpoint progress bar', () => {
    renderSummary({
      endpoints: [
        makeEndpoint({ id: 1, status: 'up' }),
        makeEndpoint({ id: 2, status: 'down' }),
      ],
    });

    const bars = screen.getAllByTestId('progress-bar');
    expect(bars.length).toBeGreaterThanOrEqual(1);
  });
});

describe('FleetStatusSummary — stack section', () => {
  it('renders stack total count', () => {
    renderSummary({
      stacks: [
        { status: 'active' },
        { status: 'inactive' },
        { status: 'active' },
      ],
    });

    expect(screen.getByTestId('stack-total')).toHaveTextContent('3 stacks');
  });

  it('renders singular "stack" for single stack', () => {
    renderSummary({
      stacks: [{ status: 'active' }],
    });

    expect(screen.getByTestId('stack-total')).toHaveTextContent('1 stack');
  });

  it('renders active and inactive status pills with counts', () => {
    renderSummary({
      stacks: [
        { status: 'active' },
        { status: 'active' },
        { status: 'inactive' },
      ],
    });

    const activePill = screen.getByTestId('status-pill-active');
    expect(activePill).toHaveTextContent('Active');
    expect(activePill).toHaveTextContent('(2)');

    const inactivePill = screen.getByTestId('status-pill-inactive');
    expect(inactivePill).toHaveTextContent('Inactive');
    expect(inactivePill).toHaveTextContent('(1)');
  });

  it('calls onStackStatusChange with "active" when Active pill clicked', () => {
    const onStackStatusChange = vi.fn();
    renderSummary({
      stacks: [{ status: 'active' }],
      onStackStatusChange,
    });

    fireEvent.click(screen.getByTestId('status-pill-active'));
    expect(onStackStatusChange).toHaveBeenCalledWith('active');
  });

  it('calls onStackStatusChange with undefined when active pill clicked again', () => {
    const onStackStatusChange = vi.fn();
    renderSummary({
      stacks: [{ status: 'active' }],
      activeStackStatusFilter: 'active',
      onStackStatusChange,
    });

    fireEvent.click(screen.getByTestId('status-pill-active'));
    expect(onStackStatusChange).toHaveBeenCalledWith(undefined);
  });

  it('applies ring highlight to active stack pill', () => {
    renderSummary({
      stacks: [{ status: 'inactive' }],
      activeStackStatusFilter: 'inactive',
    });

    const inactivePill = screen.getByTestId('status-pill-inactive');
    expect(inactivePill.className).toContain('ring-2');
    expect(inactivePill.className).toContain('ring-primary');
  });

  it('calls onStackStatusChange(undefined) when total button clicked', () => {
    const onStackStatusChange = vi.fn();
    renderSummary({
      stacks: [{ status: 'active' }],
      activeStackStatusFilter: 'active',
      onStackStatusChange,
    });

    fireEvent.click(screen.getByTestId('stack-total'));
    expect(onStackStatusChange).toHaveBeenCalledWith(undefined);
  });
});

describe('FleetStatusSummary — progress bars', () => {
  it('renders two progress bars (endpoint + stack)', () => {
    renderSummary({
      endpoints: [makeEndpoint({ id: 1, status: 'up' })],
      stacks: [{ status: 'active' }],
    });

    const bars = screen.getAllByTestId('progress-bar');
    expect(bars).toHaveLength(2);
  });

  it('does not render progress bar when totals are zero', () => {
    renderSummary({
      endpoints: [],
      stacks: [],
    });

    expect(screen.queryByTestId('progress-bar')).not.toBeInTheDocument();
  });
});

describe('FleetStatusSummary — summary bar test-id', () => {
  it('renders with data-testid="summary-bar"', () => {
    renderSummary({
      endpoints: [makeEndpoint()],
      stacks: [{ status: 'active' }],
    });

    expect(screen.getByTestId('summary-bar')).toBeInTheDocument();
  });
});
