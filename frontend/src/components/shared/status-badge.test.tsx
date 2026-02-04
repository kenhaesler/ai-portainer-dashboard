import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from './status-badge';

describe('StatusBadge', () => {
  it('should render the status text', () => {
    render(<StatusBadge status="running" />);
    expect(screen.getByText('running')).toBeInTheDocument();
  });

  it('should apply running status colors', () => {
    render(<StatusBadge status="running" />);
    const badge = screen.getByText('running');
    expect(badge).toHaveClass('bg-emerald-100');
  });

  it('should apply stopped status colors', () => {
    render(<StatusBadge status="stopped" />);
    const badge = screen.getByText('stopped');
    expect(badge).toHaveClass('bg-red-100');
  });

  it('should apply paused status colors', () => {
    render(<StatusBadge status="paused" />);
    const badge = screen.getByText('paused');
    expect(badge).toHaveClass('bg-amber-100');
  });

  it('should apply unknown status colors for unrecognized status', () => {
    render(<StatusBadge status="custom-status" />);
    const badge = screen.getByText('custom-status');
    expect(badge).toHaveClass('bg-gray-100');
  });

  it('should apply custom className', () => {
    render(<StatusBadge status="running" className="custom-class" />);
    const badge = screen.getByText('running');
    expect(badge).toHaveClass('custom-class');
  });

  it('should render various status types correctly', () => {
    const statuses = ['healthy', 'unhealthy', 'pending', 'completed', 'failed', 'warning', 'critical'];

    statuses.forEach((status) => {
      const { unmount } = render(<StatusBadge status={status} />);
      expect(screen.getByText(status)).toBeInTheDocument();
      unmount();
    });
  });
});
