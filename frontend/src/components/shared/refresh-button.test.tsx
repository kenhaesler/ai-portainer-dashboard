import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RefreshButton } from './refresh-button';

describe('RefreshButton', () => {
  it('should render button with Refresh text', () => {
    const onClick = vi.fn();
    render(<RefreshButton onClick={onClick} />);

    expect(screen.getByRole('button')).toHaveTextContent('Refresh');
  });

  it('should call onClick when clicked', () => {
    const onClick = vi.fn();
    render(<RefreshButton onClick={onClick} />);

    fireEvent.click(screen.getByRole('button'));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('should show Updating text when isLoading is true', () => {
    const onClick = vi.fn();
    render(<RefreshButton onClick={onClick} isLoading={true} />);

    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('Updating...');
  });

  it('should show Refresh text when isLoading is false', () => {
    const onClick = vi.fn();
    render(<RefreshButton onClick={onClick} isLoading={false} />);

    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('Refresh');
  });

  it('should still be clickable when loading (optimistic)', () => {
    const onClick = vi.fn();
    render(<RefreshButton onClick={onClick} isLoading={true} />);

    fireEvent.click(screen.getByRole('button'));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('should apply spin animation to icon when loading', () => {
    const onClick = vi.fn();
    const { container } = render(<RefreshButton onClick={onClick} isLoading={true} />);

    const icon = container.querySelector('svg');
    expect(icon).toHaveClass('animate-spin');
  });

  it('should not apply spin animation when not loading', () => {
    const onClick = vi.fn();
    const { container } = render(<RefreshButton onClick={onClick} isLoading={false} />);

    const icon = container.querySelector('svg');
    expect(icon).not.toHaveClass('animate-spin');
  });

  it('should apply custom className', () => {
    const onClick = vi.fn();
    render(<RefreshButton onClick={onClick} className="custom-class" />);

    const button = screen.getByRole('button');
    expect(button).toHaveClass('custom-class');
  });

  it('should render with relative class for loading indicator', () => {
    const onClick = vi.fn();
    render(<RefreshButton onClick={onClick} isLoading={true} />);

    const button = screen.getByRole('button');
    expect(button).toHaveClass('relative');
  });

  it('should handle multiple clicks when not loading', () => {
    const onClick = vi.fn();
    render(<RefreshButton onClick={onClick} />);

    const button = screen.getByRole('button');
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it('should have proper base styling', () => {
    const onClick = vi.fn();
    render(<RefreshButton onClick={onClick} />);

    const button = screen.getByRole('button');
    expect(button).toHaveClass('inline-flex');
    expect(button).toHaveClass('items-center');
    expect(button).toHaveClass('rounded-full');
  });

  it('should contain RefreshCw icon', () => {
    const onClick = vi.fn();
    const { container } = render(<RefreshButton onClick={onClick} />);

    const icon = container.querySelector('svg');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveClass('h-4');
    expect(icon).toHaveClass('w-4');
  });

  describe('split-button (with onForceRefresh)', () => {
    it('should render single button when no onForceRefresh', () => {
      const onClick = vi.fn();
      render(<RefreshButton onClick={onClick} />);

      const buttons = screen.getAllByRole('button');
      expect(buttons).toHaveLength(1);
    });

    it('should render two buttons when onForceRefresh provided', () => {
      const onClick = vi.fn();
      const onForceRefresh = vi.fn();
      render(<RefreshButton onClick={onClick} onForceRefresh={onForceRefresh} />);

      const buttons = screen.getAllByRole('button');
      expect(buttons).toHaveLength(2);
    });

    it('should call onForceRefresh (not onClick) when force refresh button clicked', () => {
      const onClick = vi.fn();
      const onForceRefresh = vi.fn();
      render(<RefreshButton onClick={onClick} onForceRefresh={onForceRefresh} />);

      const buttons = screen.getAllByRole('button');
      fireEvent.click(buttons[1]); // second button is force refresh

      expect(onForceRefresh).toHaveBeenCalledTimes(1);
      expect(onClick).not.toHaveBeenCalled();
    });

    it('should show Updating text in split mode when loading', () => {
      const onClick = vi.fn();
      const onForceRefresh = vi.fn();
      render(
        <RefreshButton onClick={onClick} onForceRefresh={onForceRefresh} isLoading={true} />
      );

      const buttons = screen.getAllByRole('button');
      expect(buttons[0]).toHaveTextContent('Updating...');
    });

    it('should still call onClick on first button in split mode', () => {
      const onClick = vi.fn();
      const onForceRefresh = vi.fn();
      render(<RefreshButton onClick={onClick} onForceRefresh={onForceRefresh} />);

      const buttons = screen.getAllByRole('button');
      fireEvent.click(buttons[0]);

      expect(onClick).toHaveBeenCalledTimes(1);
      expect(onForceRefresh).not.toHaveBeenCalled();
    });
  });
});
