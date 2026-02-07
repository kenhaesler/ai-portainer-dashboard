import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CommandPalette } from './command-palette';
import { useUiStore } from '@/stores/ui-store';
import { useSearchStore } from '@/stores/search-store';
import { SearchProvider } from '@/providers/search-provider';

vi.mock('@/hooks/use-global-search', () => ({
  useGlobalSearch: vi.fn(() => ({
    data: {
      query: 'web',
      containers: [
        {
          id: 'abc123',
          name: 'web-frontend',
          image: 'nginx:alpine',
          state: 'running',
          status: 'Up 2 hours',
          endpointId: 1,
          endpointName: 'prod',
        },
      ],
      images: [],
      stacks: [],
      logs: [],
    },
    isLoading: false,
  })),
}));

vi.mock('@/hooks/use-nl-query', () => ({
  useNlQuery: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
}));

function renderPalette() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SearchProvider>
          <CommandPalette />
        </SearchProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('CommandPalette', () => {
  beforeEach(() => {
    useUiStore.setState({ commandPaletteOpen: true });
    useSearchStore.setState({ recent: [] });
  });

  it('renders recent searches when query is empty', () => {
    useSearchStore.setState({ recent: [{ term: 'postgres', lastUsed: Date.now() }] });
    renderPalette();
    expect(screen.getByText('Recent')).toBeInTheDocument();
    expect(screen.getByText('postgres')).toBeInTheDocument();
  });

  it('renders container results when searching', () => {
    renderPalette();
    const input = screen.getByPlaceholderText('Search or ask a question about your infrastructure...');
    fireEvent.change(input, { target: { value: 'web' } });
    expect(screen.getByText('Containers')).toBeInTheDocument();
    expect(screen.getByText('web-frontend')).toBeInTheDocument();
  });

  it('shows Ask AI button for natural language queries', () => {
    renderPalette();
    const input = screen.getByPlaceholderText('Search or ask a question about your infrastructure...');
    fireEvent.change(input, { target: { value: 'what containers are running' } });
    expect(screen.getByText('Ask AI')).toBeInTheDocument();
  });

  it('does not show Ask AI button for simple searches', () => {
    renderPalette();
    const input = screen.getByPlaceholderText('Search or ask a question about your infrastructure...');
    fireEvent.change(input, { target: { value: 'nginx' } });
    expect(screen.queryByText('Ask AI')).toBeNull();
  });

  it('shows keyboard shortcut hint for AI queries', () => {
    renderPalette();
    expect(screen.getByText('ask AI')).toBeInTheDocument();
  });

  it('does not include deprecated backups page in static page entries', () => {
    renderPalette();
    expect(screen.queryByText('Backups')).not.toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });
});
