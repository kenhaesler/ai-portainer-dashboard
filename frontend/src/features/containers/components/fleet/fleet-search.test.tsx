import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, act } from '@testing-library/react';
import { FleetSearch } from './fleet-search';

describe('FleetSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderSearch(props: Partial<React.ComponentProps<typeof FleetSearch>> = {}) {
    const onSearch = vi.fn();
    const utils = render(
      <FleetSearch
        onSearch={onSearch}
        totalCount={10}
        filteredCount={10}
        placeholder="Search endpoints... (name:prod status:up)"
        label="Search endpoints"
        {...props}
      />,
    );
    return { onSearch, ...utils };
  }

  it('renders with placeholder text', () => {
    renderSearch();
    expect(screen.getByPlaceholderText(/search endpoints/i)).toBeInTheDocument();
  });

  it('renders with aria-label', () => {
    renderSearch();
    expect(screen.getByRole('textbox', { name: /search endpoints/i })).toBeInTheDocument();
  });

  it('debounces search input by 300ms', () => {
    const { onSearch } = renderSearch();
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'prod' } });

    // Not called immediately
    expect(onSearch).not.toHaveBeenCalled();

    // Called after 300ms
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(onSearch).toHaveBeenCalledWith('prod');
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it('debounces multiple rapid inputs', () => {
    const { onSearch } = renderSearch();
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'p' } });
    act(() => { vi.advanceTimersByTime(100); });
    fireEvent.change(input, { target: { value: 'pr' } });
    act(() => { vi.advanceTimersByTime(100); });
    fireEvent.change(input, { target: { value: 'pro' } });
    act(() => { vi.advanceTimersByTime(100); });
    fireEvent.change(input, { target: { value: 'prod' } });

    // Only the debounce timer for the last input should fire
    act(() => { vi.advanceTimersByTime(300); });

    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenCalledWith('prod');
  });

  it('shows clear button when input has value', () => {
    renderSearch();
    const input = screen.getByRole('textbox');

    // No clear button initially
    expect(screen.queryByRole('button', { name: /clear search/i })).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'test' } });

    expect(screen.getByRole('button', { name: /clear search/i })).toBeInTheDocument();
  });

  it('clear button resets input and calls onSearch immediately', () => {
    const { onSearch } = renderSearch();
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'test' } });
    fireEvent.click(screen.getByRole('button', { name: /clear search/i }));

    expect((input as HTMLInputElement).value).toBe('');
    // Clear should call onSearch immediately (not debounced)
    expect(onSearch).toHaveBeenCalledWith('');
  });

  it('Escape key clears input', () => {
    const { onSearch } = renderSearch();
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'test' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect((input as HTMLInputElement).value).toBe('');
    expect(onSearch).toHaveBeenCalledWith('');
  });

  it('does not show count when not filtering', () => {
    renderSearch({ totalCount: 10, filteredCount: 10 });
    expect(screen.queryByTestId('fleet-search-count')).not.toBeInTheDocument();
  });

  it('shows filtered count when search reduces results', () => {
    renderSearch({ totalCount: 10, filteredCount: 3 });
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'prod' } });

    expect(screen.getByTestId('fleet-search-count')).toHaveTextContent('3 of 10');
  });

  it('does not show count when query is empty even if counts differ', () => {
    renderSearch({ totalCount: 10, filteredCount: 10 });
    expect(screen.queryByTestId('fleet-search-count')).not.toBeInTheDocument();
  });

  it('uses custom placeholder', () => {
    renderSearch({ placeholder: 'Custom placeholder' });
    expect(screen.getByPlaceholderText('Custom placeholder')).toBeInTheDocument();
  });

  it('renders example chips when examples provided and field is empty', () => {
    renderSearch({ examples: ['name:prod', 'status:up'] });
    expect(screen.getByRole('group', { name: /example searches/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'name:prod' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'status:up' })).toBeInTheDocument();
  });

  it('hides example chips once a query is typed', () => {
    renderSearch({ examples: ['name:prod'] });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x' } });
    expect(screen.queryByRole('button', { name: 'name:prod' })).not.toBeInTheDocument();
  });

  it('does not render the example group when no examples are given', () => {
    renderSearch();
    expect(screen.queryByRole('group', { name: /example searches/i })).not.toBeInTheDocument();
  });

  it('clicking an example chip fills the query and calls onSearch immediately', () => {
    const { onSearch } = renderSearch({ examples: ['status:up'] });
    fireEvent.click(screen.getByRole('button', { name: 'status:up' }));
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('status:up');
    // Immediate (not debounced): assert before advancing timers.
    expect(onSearch).toHaveBeenCalledWith('status:up');
  });

  it('focuses the input on mount when autoFocus is set', () => {
    renderSearch({ autoFocus: true });
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });

  it('does not focus the input on mount by default', () => {
    renderSearch();
    expect(document.activeElement).not.toBe(screen.getByRole('textbox'));
  });

  it('Escape clears the query and blurs the input', () => {
    const { onSearch } = renderSearch();
    const input = screen.getByRole('textbox');
    input.focus();
    fireEvent.change(input, { target: { value: 'test' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect((input as HTMLInputElement).value).toBe('');
    expect(onSearch).toHaveBeenCalledWith('');
    expect(document.activeElement).not.toBe(input);
  });
});
