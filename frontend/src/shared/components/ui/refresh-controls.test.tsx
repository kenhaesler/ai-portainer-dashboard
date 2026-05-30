import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { RefreshControls } from './refresh-controls';

function getRefreshButton() {
  return screen.getByRole('button', { name: /refresh/i });
}

function getIntervalSelect() {
  return screen.getByLabelText('Auto-refresh interval') as HTMLSelectElement;
}

describe('RefreshControls', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the interval selector and an icon-only refresh button joined in one pill', () => {
    const { container } = render(
      <RefreshControls interval={0} onIntervalChange={vi.fn()} onRefresh={vi.fn()} />,
    );

    // Joined container: a single rounded-full pill.
    const pill = container.firstElementChild as HTMLElement;
    expect(pill).toHaveClass('rounded-full');
    expect(pill).toHaveClass('h-10');

    // Interval label when off.
    expect(screen.getByText(/Auto-refresh: Off/i)).toBeTruthy();

    // The refresh button carries no visible text — it is the symbol only.
    expect(getRefreshButton()).toHaveTextContent('');
    expect(getIntervalSelect()).toBeInTheDocument();
  });

  it('exposes all six interval options and coerces the chosen value to a number', () => {
    const onIntervalChange = vi.fn();
    render(<RefreshControls interval={30} onIntervalChange={onIntervalChange} onRefresh={vi.fn()} />);

    const select = getIntervalSelect();
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      '0', '15', '30', '60', '120', '300',
    ]);

    fireEvent.change(select, { target: { value: '300' } });
    const arg = onIntervalChange.mock.calls[0][0];
    expect(typeof arg).toBe('number');
    expect(arg).toBe(300);
  });

  it('clicking refresh prefers onForceRefresh when supplied', () => {
    const onRefresh = vi.fn();
    const onForceRefresh = vi.fn();
    render(
      <RefreshControls
        interval={0}
        onIntervalChange={vi.fn()}
        onRefresh={onRefresh}
        onForceRefresh={onForceRefresh}
      />,
    );

    fireEvent.click(getRefreshButton());
    expect(onForceRefresh).toHaveBeenCalledTimes(1);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('clicking refresh falls back to onRefresh when no force handler is supplied', () => {
    const onRefresh = vi.fn();
    render(<RefreshControls interval={0} onIntervalChange={vi.fn()} onRefresh={onRefresh} />);

    fireEvent.click(getRefreshButton());
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('changing the interval does not trigger a manual refresh', () => {
    const onRefresh = vi.fn();
    const onForceRefresh = vi.fn();
    render(
      <RefreshControls
        interval={0}
        onIntervalChange={vi.fn()}
        onRefresh={onRefresh}
        onForceRefresh={onForceRefresh}
      />,
    );

    fireEvent.change(getIntervalSelect(), { target: { value: '60' } });
    expect(onRefresh).not.toHaveBeenCalled();
    expect(onForceRefresh).not.toHaveBeenCalled();
  });

  it('spins the refresh icon while loading and keeps it for the minimum duration', () => {
    const { rerender } = render(
      <RefreshControls interval={0} onIntervalChange={vi.fn()} onRefresh={vi.fn()} isLoading />,
    );

    const icon = getRefreshButton().querySelector('svg');
    expect(icon).toHaveClass('animate-spin');

    rerender(
      <RefreshControls interval={0} onIntervalChange={vi.fn()} onRefresh={vi.fn()} isLoading={false} />,
    );
    expect(icon).toHaveClass('animate-spin');

    act(() => {
      vi.advanceTimersByTime(1501);
    });
    expect(icon).not.toHaveClass('animate-spin');
  });

  it('forwards className onto the outer pill', () => {
    const { container } = render(
      <RefreshControls
        interval={0}
        onIntervalChange={vi.fn()}
        onRefresh={vi.fn()}
        className="custom-class"
      />,
    );
    expect(container.firstElementChild).toHaveClass('custom-class');
  });
});
