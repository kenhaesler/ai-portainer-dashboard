import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { RefreshButton } from './refresh-button';

function getButtons() {
  return screen.getAllByRole('button');
}

describe('RefreshButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('always renders split control with two buttons', () => {
    const onClick = vi.fn();
    render(<RefreshButton onClick={onClick} />);

    const buttons = getButtons();
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveTextContent('Refresh');
    expect(buttons[1]).toHaveTextContent('Bypass cache');
  });

  it('calls onClick when primary refresh button is clicked', () => {
    const onClick = vi.fn();
    render(<RefreshButton onClick={onClick} />);

    fireEvent.click(getButtons()[0]);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('keeps Refresh label when loading to avoid width changes', () => {
    const onClick = vi.fn();
    render(<RefreshButton onClick={onClick} isLoading={true} />);

    expect(getButtons()[0]).toHaveTextContent('Refresh');
  });

  it('applies spin animation to icon when loading', () => {
    const onClick = vi.fn();
    const { container } = render(<RefreshButton onClick={onClick} isLoading={true} />);

    const icon = container.querySelector('svg');
    expect(icon).toHaveClass('animate-spin');
  });

  it('keeps spin visible briefly after loading ends', () => {
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

  it('applies custom className to outer container', () => {
    const onClick = vi.fn();
    const { container } = render(<RefreshButton onClick={onClick} className="custom-class" />);

    expect(container.firstElementChild).toHaveClass('custom-class');
  });

  it('uses rounded-full pill styling', () => {
    const onClick = vi.fn();
    render(<RefreshButton onClick={onClick} />);

    expect(getButtons()[0]).toHaveClass('rounded-full');
    expect(getButtons()[1]).toHaveClass('rounded-full');
  });

  it('calls onForceRefresh when flash button is clicked and handler exists', () => {
    const onClick = vi.fn();
    const onForceRefresh = vi.fn();
    render(<RefreshButton onClick={onClick} onForceRefresh={onForceRefresh} />);

    fireEvent.click(getButtons()[1]);
    expect(onForceRefresh).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('falls back to onClick when flash button is clicked without force handler', () => {
    const onClick = vi.fn();
    render(<RefreshButton onClick={onClick} />);

    fireEvent.click(getButtons()[1]);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('uses clear bypass-cache tooltip when force handler exists', () => {
    const onClick = vi.fn();
    const onForceRefresh = vi.fn();
    render(<RefreshButton onClick={onClick} onForceRefresh={onForceRefresh} />);

    expect(getButtons()[1]).toHaveAttribute('title', 'Bypass cache and fetch fresh data');
  });

  it('uses fallback tooltip when force handler is unavailable', () => {
    const onClick = vi.fn();
    render(<RefreshButton onClick={onClick} />);
    expect(getButtons()[1]).toHaveAttribute('title', 'Refresh (cache bypass unavailable on this page)');
  });
});
