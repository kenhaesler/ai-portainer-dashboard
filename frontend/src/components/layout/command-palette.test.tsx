import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
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

describe('CommandPalette', () => {
  beforeEach(() => {
    useUiStore.setState({ commandPaletteOpen: true });
    useSearchStore.setState({ recent: [] });
  });

  it('renders recent searches when query is empty', () => {
    useSearchStore.setState({ recent: [{ term: 'postgres', lastUsed: Date.now() }] });

    render(
      <MemoryRouter>
        <SearchProvider>
          <CommandPalette />
        </SearchProvider>
      </MemoryRouter>
    );

    expect(screen.getByText('Recent')).toBeInTheDocument();
    expect(screen.getByText('postgres')).toBeInTheDocument();
  });

  it('renders container results when searching', () => {
    render(
      <MemoryRouter>
        <SearchProvider>
          <CommandPalette />
        </SearchProvider>
      </MemoryRouter>
    );

    const input = screen.getByPlaceholderText('Search containers, images, stacks, logs...');
    fireEvent.change(input, { target: { value: 'web' } });

    expect(screen.getByText('Containers')).toBeInTheDocument();
    expect(screen.getByText('web-frontend')).toBeInTheDocument();
  });
});
