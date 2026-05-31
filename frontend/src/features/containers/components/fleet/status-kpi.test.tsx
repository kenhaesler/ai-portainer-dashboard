import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatusKpi, ENDPOINT_STATUS_COLORS, STACK_STATUS_COLORS, type StatusKpiPill } from './status-kpi';

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

function makePills(overrides: Partial<StatusKpiPill>[] = []): StatusKpiPill[] {
  const base: StatusKpiPill[] = [
    { key: 'up', label: 'Up', count: 2, isActive: false, colors: ENDPOINT_STATUS_COLORS.up, onClick: vi.fn() },
    { key: 'down', label: 'Down', count: 1, isActive: false, colors: ENDPOINT_STATUS_COLORS.down, onClick: vi.fn() },
  ];
  return base.map((p, i) => ({ ...p, ...(overrides[i] ?? {}) }));
}

describe('StatusKpi', () => {
  it('renders each pill with its label and count', () => {
    render(<StatusKpi pills={makePills()} ariaLabel="Endpoint status" />);

    const upPill = screen.getByTestId('status-pill-up');
    expect(upPill).toHaveTextContent('Up');
    expect(upPill).toHaveTextContent('(2)');

    const downPill = screen.getByTestId('status-pill-down');
    expect(downPill).toHaveTextContent('Down');
    expect(downPill).toHaveTextContent('(1)');
  });

  it('exposes the group via aria-label', () => {
    render(<StatusKpi pills={makePills()} ariaLabel="Endpoint status" />);
    expect(screen.getByRole('group', { name: 'Endpoint status' })).toBeInTheDocument();
  });

  it('fires onClick when a pill is clicked', () => {
    const onClick = vi.fn();
    render(<StatusKpi pills={makePills([{ onClick }])} ariaLabel="Endpoint status" />);

    fireEvent.click(screen.getByTestId('status-pill-up'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('applies ring highlight to the active pill', () => {
    render(<StatusKpi pills={makePills([{ isActive: true }])} ariaLabel="Endpoint status" />);

    const upPill = screen.getByTestId('status-pill-up');
    expect(upPill.className).toContain('ring-2');
    expect(upPill.className).toContain('ring-primary');
  });

  it('dims a pill with a zero count', () => {
    render(<StatusKpi pills={makePills([{}, { count: 0 }])} ariaLabel="Endpoint status" />);

    const downPill = screen.getByTestId('status-pill-down');
    expect(downPill).toHaveTextContent('(0)');
    expect(downPill.className).toContain('opacity-50');
  });

  it('works with stack status colors and labels', () => {
    const pills: StatusKpiPill[] = [
      { key: 'active', label: 'Active', count: 3, isActive: false, colors: STACK_STATUS_COLORS.active, onClick: vi.fn() },
      { key: 'inactive', label: 'Inactive', count: 0, isActive: false, colors: STACK_STATUS_COLORS.inactive, onClick: vi.fn() },
    ];
    render(<StatusKpi pills={pills} ariaLabel="Stack status" />);

    expect(screen.getByTestId('status-pill-active')).toHaveTextContent('(3)');
    expect(screen.getByTestId('status-pill-inactive')).toHaveTextContent('(0)');
  });
});
