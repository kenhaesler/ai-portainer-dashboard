import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NlqSearchBar } from './nlq-search-bar';

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

function renderBar() {
  return render(
    <MemoryRouter>
      <NlqSearchBar />
    </MemoryRouter>,
  );
}

describe('NlqSearchBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNlQuery.isPending = false;
    mockNlQuery.data = null;
    mockNlQuery.error = null;
  });

  it('renders search input with placeholder', () => {
    renderBar();
    expect(screen.getByPlaceholderText(/ask about your containers/i)).toBeDefined();
  });

  it('renders example query chips', () => {
    renderBar();
    expect(screen.getByText('high memory containers')).toBeDefined();
    expect(screen.getByText('running nginx')).toBeDefined();
    expect(screen.getByText('stopped containers')).toBeDefined();
    expect(screen.getByText('top CPU consumers')).toBeDefined();
  });

  it('calls mutate on Enter key', () => {
    renderBar();
    const input = screen.getByPlaceholderText(/ask about your containers/i);
    fireEvent.change(input, { target: { value: 'show running containers' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockMutate).toHaveBeenCalledWith('show running containers', expect.any(Object));
  });

  it('does not call mutate with empty query', () => {
    renderBar();
    const input = screen.getByPlaceholderText(/ask about your containers/i);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('calls mutate when example chip is clicked', () => {
    renderBar();
    fireEvent.click(screen.getByText('running nginx'));
    expect(mockMutate).toHaveBeenCalledWith('running nginx', expect.any(Object));
  });

  it('shows loading state when pending', () => {
    mockNlQuery.isPending = true;
    renderBar();
    expect(screen.getByText('Processing query...')).toBeDefined();
  });

  it('shows answer result', () => {
    mockMutate.mockImplementation((_query: string, opts: { onSuccess: (data: any) => void }) => {
      opts.onSuccess({ action: 'answer', text: 'Found 3 containers running nginx' });
    });
    renderBar();
    const input = screen.getByPlaceholderText(/ask about your containers/i);
    fireEvent.change(input, { target: { value: 'nginx containers' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('Found 3 containers running nginx')).toBeDefined();
  });

  it('shows navigate result with link', () => {
    mockMutate.mockImplementation((_query: string, opts: { onSuccess: (data: any) => void }) => {
      opts.onSuccess({ action: 'navigate', page: '/containers', description: 'View all containers' });
    });
    renderBar();
    const input = screen.getByPlaceholderText(/ask about your containers/i);
    fireEvent.change(input, { target: { value: 'show containers' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('View all containers')).toBeDefined();
    expect(screen.getByText('/containers')).toBeDefined();
  });

  it('shows error result', () => {
    mockMutate.mockImplementation((_query: string, opts: { onError: () => void }) => {
      opts.onError();
    });
    renderBar();
    const input = screen.getByPlaceholderText(/ask about your containers/i);
    fireEvent.change(input, { target: { value: 'broken query' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText(/failed to process query/i)).toBeDefined();
  });

  it('clears result when clear button is clicked', () => {
    mockMutate.mockImplementation((_query: string, opts: { onSuccess: (data: any) => void }) => {
      opts.onSuccess({ action: 'answer', text: 'Some result' });
    });
    renderBar();
    const input = screen.getByPlaceholderText(/ask about your containers/i);
    fireEvent.change(input, { target: { value: 'test query' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('Some result')).toBeDefined();
    fireEvent.click(screen.getByLabelText('Clear search'));
    expect(screen.queryByText('Some result')).toBeNull();
  });

  it('has accessible label on search input', () => {
    renderBar();
    expect(screen.getByLabelText('Natural language search')).toBeDefined();
  });
});
