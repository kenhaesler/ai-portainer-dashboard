import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ContainerSmartSearch } from './container-smart-search';

// Mock the useNlQuery hook
const mockMutate = vi.fn();
const mockNlQuery = {
  mutate: mockMutate,
  isPending: false,
  data: null,
  error: null,
};

vi.mock('@/hooks/use-nl-query', () => ({
  useNlQuery: () => mockNlQuery,
}));

function renderSearch(props = {}) {
  const defaultProps = {
    value: '',
    onChange: vi.fn(),
    ...props,
  };
  return render(
    <MemoryRouter>
      <ContainerSmartSearch {...defaultProps} />
    </MemoryRouter>,
  );
}

describe('ContainerSmartSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNlQuery.isPending = false;
    mockNlQuery.data = null;
    mockNlQuery.error = null;
  });

  it('renders search input with placeholder', () => {
    renderSearch();
    expect(screen.getByPlaceholderText(/search containers/i)).toBeDefined();
  });

  it('renders example query chips when empty', () => {
    renderSearch();
    expect(screen.getByText('containers using >80% CPU')).toBeDefined();
    expect(screen.getByText('stopped nginx containers')).toBeDefined();
    expect(screen.getByText('high memory usage')).toBeDefined();
    expect(screen.getByText('running containers')).toBeDefined();
  });

  it('calls onChange when typing', () => {
    const onChange = vi.fn();
    renderSearch({ onChange });
    const input = screen.getByPlaceholderText(/search containers/i);
    fireEvent.change(input, { target: { value: 'nginx' } });
    expect(onChange).toHaveBeenCalledWith('nginx');
  });

  it('shows hint text when value is present', () => {
    renderSearch({ value: 'nginx' });
    expect(screen.getByText(/filtering locally/i)).toBeDefined();
    expect(screen.getByText('Enter')).toBeDefined(); // kbd element
  });

  it('calls mutate on Enter key', () => {
    const onChange = vi.fn();
    renderSearch({ value: 'show running containers', onChange });
    const input = screen.getByPlaceholderText(/search containers/i);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockMutate).toHaveBeenCalledWith('show running containers', expect.any(Object));
  });

  it('does not call mutate with empty query', () => {
    renderSearch({ value: '' });
    const input = screen.getByPlaceholderText(/search containers/i);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('calls mutate when example chip is clicked', () => {
    const onChange = vi.fn();
    renderSearch({ onChange });
    fireEvent.click(screen.getByText('running containers'));
    expect(onChange).toHaveBeenCalledWith('running containers');
    expect(mockMutate).toHaveBeenCalledWith('running containers', expect.any(Object));
  });

  it('shows loading state when pending', () => {
    mockNlQuery.isPending = true;
    renderSearch({ value: 'test query' });
    expect(screen.getByText('Processing query...')).toBeDefined();
    expect(screen.getByText(/analyzing containers with ai/i)).toBeDefined();
  });

  it('hides example chips when value is present', () => {
    renderSearch({ value: 'nginx' });
    expect(screen.queryByText('containers using >80% CPU')).toBeNull();
  });

  it('shows clear button when value is present', () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    renderSearch({ value: 'nginx', onChange, onClear });
    const clearButton = screen.getByLabelText('Clear search');
    expect(clearButton).toBeDefined();
    fireEvent.click(clearButton);
    expect(onChange).toHaveBeenCalledWith('');
    expect(onClear).toHaveBeenCalled();
  });

  it('has accessible label on search input', () => {
    renderSearch();
    expect(screen.getByLabelText('Smart container search')).toBeDefined();
  });
});
