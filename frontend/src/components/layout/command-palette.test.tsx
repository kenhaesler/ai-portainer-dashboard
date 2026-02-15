import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CommandPalette } from './command-palette';
import { useUiStore } from '@/stores/ui-store';
import { useSearchStore } from '@/stores/search-store';
import { SearchProvider } from '@/providers/search-provider';

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    p: ({ children, ...props }: any) => <p {...props}>{children}</p>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

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

describe('CommandPalette (Neural Search)', () => {
  beforeEach(() => {
    useUiStore.setState({ commandPaletteOpen: true });
    useSearchStore.setState({ recent: [] });
  });

  it('renders initial state with Neural Search branding', () => {
    renderPalette();
    expect(screen.getByText('Neural Search')).toBeInTheDocument();
    expect(screen.getByText(/AI-Powered Infrastructure Intelligence/i)).toBeInTheDocument();
  });

  it('renders recent interactions when query is empty', () => {
    useSearchStore.setState({ recent: [{ term: 'postgres', lastUsed: Date.now() }] });
    renderPalette();
    expect(screen.getByText('Recent Neural Interactions')).toBeInTheDocument();
    expect(screen.getByText('postgres')).toBeInTheDocument();
  });

  it('renders container results when searching', () => {
    renderPalette();
    const input = screen.getByPlaceholderText('Search or Ask Neural AI...');
    fireEvent.change(input, { target: { value: 'web' } });
    expect(screen.getByText('Infrastructure Units')).toBeInTheDocument();
    expect(screen.getByText('web-frontend')).toBeInTheDocument();
  });

  it('shows Neural Run button for natural language queries', () => {
    renderPalette();
    const input = screen.getByPlaceholderText('Search or Ask Neural AI...');
    fireEvent.change(input, { target: { value: 'what containers are running' } });
    expect(screen.getByText('Neural Run')).toBeInTheDocument();
  });

  it('does not show Neural Run button for simple searches', () => {
    renderPalette();
    const input = screen.getByPlaceholderText('Search or Ask Neural AI...');
    fireEvent.change(input, { target: { value: 'nginx' } });
    expect(screen.queryByText('Neural Run')).toBeNull();
  });

  it('does not include deprecated backups page in static page entries', () => {
    renderPalette();
    expect(screen.queryByText('Backups')).not.toBeInTheDocument();
    // In our new pages list, Settings is just "Settings"
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });
});
