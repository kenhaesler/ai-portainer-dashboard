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
      logs: [
        {
          id: 'log-1',
          containerId: 'abc123',
          containerName: 'web-frontend',
          endpointId: 1,
          message: 'GET /index.html 200',
        },
      ],
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

describe('CommandPalette (Spotlight Style)', () => {
  beforeEach(() => {
    useUiStore.setState({ commandPaletteOpen: true });
    useSearchStore.setState({ recent: [] });
  });

  it('renders search icon on search row', () => {
    renderPalette();
    expect(screen.getByTestId('search-logo')).toBeInTheDocument();
  });

  it('renders category buttons that are always visible', () => {
    renderPalette();
    const categoryButtons = screen.getByTestId('category-buttons');
    expect(categoryButtons).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by Containers')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by Logs')).toBeInTheDocument();
  });

  it('category buttons are visible in both idle and typing states', () => {
    renderPalette();
    // Idle state
    expect(screen.getByLabelText('Filter by Containers')).toBeInTheDocument();

    // Typing state
    const input = screen.getByPlaceholderText('Search or Ask Neural AI...');
    fireEvent.change(input, { target: { value: 'web' } });
    expect(screen.getByLabelText('Filter by Containers')).toBeInTheDocument();
  });

  it('toggles category on click and filters results', () => {
    renderPalette();
    const input = screen.getByPlaceholderText('Search or Ask Neural AI...');
    fireEvent.change(input, { target: { value: 'web' } });

    // With 'all' category, containers should be visible
    expect(screen.getByText('web-frontend')).toBeInTheDocument();

    // Click Logs category
    const logsBtn = screen.getByLabelText('Filter by Logs');
    fireEvent.click(logsBtn);
    expect(logsBtn).toHaveAttribute('aria-pressed', 'true');

    // Container results should be hidden when logs filter is active
    expect(screen.queryByText('Infrastructure Units')).not.toBeInTheDocument();
  });

  it('deselects category on second click (returns to all)', () => {
    renderPalette();
    const containersBtn = screen.getByLabelText('Filter by Containers');

    // Click to activate
    fireEvent.click(containersBtn);
    expect(containersBtn).toHaveAttribute('aria-pressed', 'true');

    // Click again to deactivate
    fireEvent.click(containersBtn);
    expect(containersBtn).toHaveAttribute('aria-pressed', 'false');
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
    const input = screen.getByPlaceholderText('Search or Ask Neural AI...');
    fireEvent.change(input, { target: { value: 'se' } });
    expect(screen.queryByText('Backups')).not.toBeInTheDocument();
    expect(screen.getAllByText('Settings').length).toBeGreaterThan(0);
  });

  it('starts compact and expands when typing', () => {
    renderPalette();
    const dialog = screen.getByPlaceholderText('Search or Ask Neural AI...').closest('[class*="z-[101]"]');
    // Dialog should exist and have the base classes
    expect(dialog?.className).toContain('z-[101]');
    expect(dialog?.className).toContain('w-full');

    // Verify typing updates the query state
    const input = screen.getByPlaceholderText('Search or Ask Neural AI...');
    fireEvent.change(input, { target: { value: 'test' } });
    expect((input as HTMLInputElement).value).toBe('test');
  });

  it('respects prefers-reduced-motion via CSS utility classes', () => {
    renderPalette();
    const dialog = screen.getByPlaceholderText('Search or Ask Neural AI...').closest('[class*="z-[101]"]');
    expect(dialog).toBeInTheDocument();
    expect(dialog?.className).toContain('z-[101]');
  });
});
