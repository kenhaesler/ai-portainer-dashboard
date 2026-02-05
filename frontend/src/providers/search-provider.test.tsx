import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SearchProvider, useSearch } from './search-provider';
import { useSearchStore } from '@/stores/search-store';

function TestConsumer() {
  const { recent, addRecent, clearRecent } = useSearch();
  return (
    <div>
      <span data-testid="count">{recent.length}</span>
      {recent.map((item) => (
        <span key={item.term} data-testid="term">{item.term}</span>
      ))}
      <button onClick={() => addRecent('test-term')}>Add</button>
      <button onClick={() => clearRecent()}>Clear</button>
    </div>
  );
}

describe('SearchProvider', () => {
  beforeEach(() => {
    useSearchStore.setState({ recent: [] });
  });

  it('should expose search context to children', () => {
    render(
      <SearchProvider>
        <TestConsumer />
      </SearchProvider>,
    );

    expect(screen.getByTestId('count')).toHaveTextContent('0');
  });

  it('should allow adding recent terms via context', () => {
    render(
      <SearchProvider>
        <TestConsumer />
      </SearchProvider>,
    );

    fireEvent.click(screen.getByText('Add'));
    expect(screen.getByTestId('count')).toHaveTextContent('1');
    expect(screen.getByTestId('term')).toHaveTextContent('test-term');
  });

  it('should allow clearing recent terms via context', () => {
    useSearchStore.getState().addRecent('existing');

    render(
      <SearchProvider>
        <TestConsumer />
      </SearchProvider>,
    );

    expect(screen.getByTestId('count')).toHaveTextContent('1');
    fireEvent.click(screen.getByText('Clear'));
    expect(screen.getByTestId('count')).toHaveTextContent('0');
  });

  it('should throw when useSearch is used outside provider', () => {
    // Suppress console.error for expected error
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(<TestConsumer />);
    }).toThrow('useSearch must be used within SearchProvider');

    spy.mockRestore();
  });
});
