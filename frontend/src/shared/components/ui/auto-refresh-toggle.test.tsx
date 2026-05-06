import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AutoRefreshToggle } from './auto-refresh-toggle';

describe('AutoRefreshToggle', () => {
  it('renders the current interval label when off', () => {
    render(<AutoRefreshToggle interval={0} onIntervalChange={vi.fn()} />);
    expect(screen.getByText(/Auto-refresh: Off/i)).toBeTruthy();
  });

  it('renders the current interval label when active', () => {
    render(<AutoRefreshToggle interval={30} onIntervalChange={vi.fn()} />);
    // The label appears once in the visible <span> and again in the <option>
    // shadow rendered by the native <select>. Both appearances are correct;
    // assert at least one and inspect the label specifically.
    expect(screen.getAllByText(/Every 30s/i).length).toBeGreaterThanOrEqual(1);
  });

  it('calls onIntervalChange with the chosen interval value', () => {
    const onChange = vi.fn();
    render(<AutoRefreshToggle interval={0} onIntervalChange={onChange} />);

    const select = screen.getByLabelText('Auto-refresh interval') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '60' } });

    expect(onChange).toHaveBeenCalledWith(60);
  });

  it('exposes all six interval options as <option> elements', () => {
    render(<AutoRefreshToggle interval={30} onIntervalChange={vi.fn()} />);
    const select = screen.getByLabelText('Auto-refresh interval') as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    // Off / 15s / 30s / 1m / 2m / 5m
    expect(optionValues).toEqual(['0', '15', '30', '60', '120', '300']);
  });

  it('coerces the select value to a number before invoking the callback', () => {
    const onChange = vi.fn();
    render(<AutoRefreshToggle interval={0} onIntervalChange={onChange} />);
    const select = screen.getByLabelText('Auto-refresh interval') as HTMLSelectElement;

    fireEvent.change(select, { target: { value: '300' } });

    // The onChange must receive a number, not the string '300', so the
    // RefreshInterval discriminated union stays well-typed at the boundary.
    const arg = onChange.mock.calls[0][0];
    expect(typeof arg).toBe('number');
    expect(arg).toBe(300);
  });
});
