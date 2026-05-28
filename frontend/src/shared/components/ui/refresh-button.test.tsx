import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { RefreshButton } from './refresh-button';

function getButton() {
  return screen.getByRole('button', { name: /refresh/i });
}

describe('RefreshButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a single pill button labelled Refresh', () => {
    const onClick = vi.fn();
    render(<RefreshButton onClick={onClick} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent('Refresh');
    expect(buttons[0]).toHaveClass('rounded-full');
    expect(buttons[0]).toHaveClass('h-10');
    expect(buttons[0]).toHaveClass('border-input');
    expect(buttons[0]).toHaveClass('bg-background');
  });

  it('clicking the button prefers onForceRefresh when supplied', () => {
    const onClick = vi.fn();
    const onForceRefresh = vi.fn();
    render(<RefreshButton onClick={onClick} onForceRefresh={onForceRefresh} />);

    fireEvent.click(getButton());
    expect(onForceRefresh).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('clicking the button falls back to onClick when no force handler is supplied', () => {
    const onClick = vi.fn();
    render(<RefreshButton onClick={onClick} />);

    fireEvent.click(getButton());
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('keeps the Refresh label while loading (no width jitter)', () => {
    const onClick = vi.fn();
    render(<RefreshButton onClick={onClick} isLoading={true} />);

    expect(getButton()).toHaveTextContent('Refresh');
  });

  it('applies the spin animation to the icon while loading', () => {
    const onClick = vi.fn();
    const { container } = render(<RefreshButton onClick={onClick} isLoading={true} />);

    const icon = container.querySelector('svg');
    expect(icon).toHaveClass('animate-spin');
  });

  it('keeps the spin visible for the minimum duration after loading ends', () => {
    const onClick = vi.fn();
    const { container, rerender } = render(<RefreshButton onClick={onClick} isLoading={true} />);

    const icon = container.querySelector('svg');
    expect(icon).toHaveClass('animate-spin');

    rerender(<RefreshButton onClick={onClick} isLoading={false} />);
    expect(icon).toHaveClass('animate-spin');

    act(() => {
      vi.advanceTimersByTime(1501);
    });
    expect(icon).not.toHaveClass('animate-spin');
  });

  it('forwards className onto the button', () => {
    const onClick = vi.fn();
    render(<RefreshButton onClick={onClick} className="custom-class" />);

    expect(getButton()).toHaveClass('custom-class');
  });
});
