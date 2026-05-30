import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SmartRefreshControls } from './smart-refresh-controls';

describe('SmartRefreshControls', () => {
  const defaultProps = {
    interval: 30 as const,
    enabled: true,
    onIntervalChange: vi.fn(),
    onToggle: vi.fn(),
    onRefresh: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders pause button when enabled', () => {
    render(<SmartRefreshControls {...defaultProps} />);
    expect(screen.getByLabelText('Pause auto-refresh')).toBeDefined();
    expect(screen.getByTestId('pause-icon')).toBeDefined();
  });

  it('renders play button when paused', () => {
    render(<SmartRefreshControls {...defaultProps} enabled={false} />);
    expect(screen.getByLabelText('Resume auto-refresh')).toBeDefined();
    expect(screen.getByTestId('play-icon')).toBeDefined();
  });

  it('calls onToggle when pause/play clicked', () => {
    render(<SmartRefreshControls {...defaultProps} />);
    fireEvent.click(screen.getByLabelText('Pause auto-refresh'));
    expect(defaultProps.onToggle).toHaveBeenCalledOnce();
  });

  it('calls onRefresh when refresh button clicked', () => {
    render(<SmartRefreshControls {...defaultProps} />);
    fireEvent.click(screen.getByLabelText('Refresh now'));
    expect(defaultProps.onRefresh).toHaveBeenCalledOnce();
  });

  it('shows current interval in dropdown trigger', () => {
    render(<SmartRefreshControls {...defaultProps} interval={60} />);
    expect(screen.getByText('1m')).toBeDefined();
  });

  it('shows "Paused" text when disabled', () => {
    render(<SmartRefreshControls {...defaultProps} enabled={false} />);
    // Paused badge + dropdown text
    const pausedElements = screen.getAllByText('Paused');
    expect(pausedElements.length).toBeGreaterThanOrEqual(1);
  });

  it('opens dropdown and selects interval', () => {
    render(<SmartRefreshControls {...defaultProps} />);
    // Open dropdown
    fireEvent.click(screen.getByLabelText('Set refresh interval'));
    // Select 1m option
    fireEvent.click(screen.getByText('1m'));
    expect(defaultProps.onIntervalChange).toHaveBeenCalledWith(60);
  });

  it('shows "Updated X ago" when lastUpdated provided', () => {
    const recentDate = new Date(Date.now() - 3000); // 3s ago
    render(<SmartRefreshControls {...defaultProps} lastUpdated={recentDate} />);
    expect(screen.getByText(/Updated just now/)).toBeDefined();
  });

  it('does not show timestamp when lastUpdated is null', () => {
    render(<SmartRefreshControls {...defaultProps} lastUpdated={null} />);
    expect(screen.queryByText(/Updated/)).toBeNull();
  });

  it('shows spinning icon when isRefreshing is true', () => {
    const { container } = render(
      <SmartRefreshControls {...defaultProps} isRefreshing={true} />
    );
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).not.toBeNull();
  });
});
