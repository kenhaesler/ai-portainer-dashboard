import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterChipBar, type FilterChip } from './filter-chip-bar';

// Mock framer-motion to avoid animation timing issues in tests
vi.mock('framer-motion', async () => {
  const actual = await vi.importActual('framer-motion');
  return {
    ...actual,
    useReducedMotion: () => true,
  };
});

function makeFilter(overrides: Partial<FilterChip> = {}): FilterChip {
  return {
    key: 'status',
    label: 'Status',
    value: 'Up',
    ...overrides,
  };
}

describe('FilterChipBar', () => {
  it('returns null when filters array is empty', () => {
    const { container } = render(
      <FilterChipBar filters={[]} onRemove={vi.fn()} onClearAll={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a chip for each filter', () => {
    const filters = [
      makeFilter({ key: 'status', label: 'Status', value: 'Up' }),
      makeFilter({ key: 'type', label: 'Type', value: 'Docker' }),
    ];

    render(<FilterChipBar filters={filters} onRemove={vi.fn()} onClearAll={vi.fn()} />);

    expect(screen.getByTestId('filter-chip-status')).toBeInTheDocument();
    expect(screen.getByTestId('filter-chip-type')).toBeInTheDocument();
    expect(screen.getByText('Status:')).toBeInTheDocument();
    expect(screen.getByText('Up')).toBeInTheDocument();
    expect(screen.getByText('Type:')).toBeInTheDocument();
    expect(screen.getByText('Docker')).toBeInTheDocument();
  });

  it('calls onRemove with the correct key when X button is clicked', () => {
    const onRemove = vi.fn();
    const filters = [
      makeFilter({ key: 'status', label: 'Status', value: 'Up' }),
    ];

    render(<FilterChipBar filters={filters} onRemove={onRemove} onClearAll={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Status filter' }));
    expect(onRemove).toHaveBeenCalledWith('status');
  });

  it('does not show "Clear all" when only one filter is active', () => {
    const filters = [makeFilter()];

    render(<FilterChipBar filters={filters} onRemove={vi.fn()} onClearAll={vi.fn()} />);

    expect(screen.queryByTestId('filter-chip-clear-all')).not.toBeInTheDocument();
  });

  it('shows "Clear all" when 2 or more filters are active', () => {
    const filters = [
      makeFilter({ key: 'status', label: 'Status', value: 'Up' }),
      makeFilter({ key: 'type', label: 'Type', value: 'Docker' }),
    ];

    render(<FilterChipBar filters={filters} onRemove={vi.fn()} onClearAll={vi.fn()} />);

    expect(screen.getByTestId('filter-chip-clear-all')).toBeInTheDocument();
  });

  it('calls onClearAll when "Clear all" is clicked', () => {
    const onClearAll = vi.fn();
    const filters = [
      makeFilter({ key: 'status', label: 'Status', value: 'Up' }),
      makeFilter({ key: 'type', label: 'Type', value: 'Docker' }),
    ];

    render(<FilterChipBar filters={filters} onRemove={vi.fn()} onClearAll={onClearAll} />);

    fireEvent.click(screen.getByTestId('filter-chip-clear-all'));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it('has aria-live="polite" on the container', () => {
    const filters = [makeFilter()];

    render(<FilterChipBar filters={filters} onRemove={vi.fn()} onClearAll={vi.fn()} />);

    expect(screen.getByTestId('filter-chip-bar')).toHaveAttribute('aria-live', 'polite');
  });

  it('renders three filters and shows "Clear all"', () => {
    const filters = [
      makeFilter({ key: 'a', label: 'A', value: '1' }),
      makeFilter({ key: 'b', label: 'B', value: '2' }),
      makeFilter({ key: 'c', label: 'C', value: '3' }),
    ];

    render(<FilterChipBar filters={filters} onRemove={vi.fn()} onClearAll={vi.fn()} />);

    expect(screen.getByTestId('filter-chip-a')).toBeInTheDocument();
    expect(screen.getByTestId('filter-chip-b')).toBeInTheDocument();
    expect(screen.getByTestId('filter-chip-c')).toBeInTheDocument();
    expect(screen.getByTestId('filter-chip-clear-all')).toBeInTheDocument();
  });
});
