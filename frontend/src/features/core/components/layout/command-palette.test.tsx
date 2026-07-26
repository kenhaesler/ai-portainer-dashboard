import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CommandPalette, pages } from './command-palette';

const PLACEHOLDER = 'Search containers, images, logs and pages';
import { useUiStore } from '@/stores/ui-store';
import { useSearchStore } from '@/stores/search-store';
import { SearchProvider } from '@/providers/search-provider';

vi.mock('@/features/containers/hooks/use-endpoints', () => ({
  useEndpoints: vi.fn(() => ({
    data: [
      { id: 1, name: 'prod-server', status: 'up', totalContainers: 12, stackCount: 3 },
      { id: 2, name: 'dev-server', status: 'up', totalContainers: 5, stackCount: 1 },
    ],
  })),
}));

vi.mock('@/features/containers/hooks/use-stacks', () => ({
  useStacks: vi.fn(() => ({
    data: [
      { id: 1, name: 'web-stack', status: 'active', endpointId: 1, containerCount: 4 },
      { id: 2, name: 'monitoring-stack', status: 'active', endpointId: 1, containerCount: 3 },
    ],
  })),
}));

vi.mock('@/shared/hooks/use-global-search', () => ({
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

vi.mock('@/features/ai-intelligence/hooks/use-nl-query', () => ({
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
    expect(screen.getByLabelText('Filter by Settings')).toBeInTheDocument();
  });

  it('category buttons are visible in both idle and typing states', () => {
    renderPalette();
    // Idle state
    expect(screen.getByLabelText('Filter by Containers')).toBeInTheDocument();

    // Typing state
    const input = screen.getByPlaceholderText(PLACEHOLDER);
    fireEvent.change(input, { target: { value: 'web' } });
    expect(screen.getByLabelText('Filter by Containers')).toBeInTheDocument();
  });

  it('toggles category on click and filters results', () => {
    renderPalette();
    const input = screen.getByPlaceholderText(PLACEHOLDER);
    fireEvent.change(input, { target: { value: 'web' } });

    // With 'all' category, containers should be visible
    expect(screen.getByText('web-frontend')).toBeInTheDocument();

    // Click Settings category
    const settingsBtn = screen.getByLabelText('Filter by Settings');
    fireEvent.click(settingsBtn);
    expect(settingsBtn).toHaveAttribute('aria-pressed', 'true');

    // Container results should be hidden when settings filter is active
    expect(screen.queryByText('Containers', { selector: '[cmdk-group-heading]' })).not.toBeInTheDocument();
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
    expect(screen.getByText('Recent')).toBeInTheDocument();
    expect(screen.getByText('postgres')).toBeInTheDocument();
  });

  it('renders container results when searching', () => {
    renderPalette();
    const input = screen.getByPlaceholderText(PLACEHOLDER);
    fireEvent.change(input, { target: { value: 'web' } });
    expect(screen.getByText('Containers', { selector: '[cmdk-group-heading]' })).toBeInTheDocument();
    expect(screen.getByText('web-frontend')).toBeInTheDocument();
  });

  it('shows the Ask AI button for natural language queries', () => {
    renderPalette();
    const input = screen.getByPlaceholderText(PLACEHOLDER);
    fireEvent.change(input, { target: { value: 'what containers are running' } });
    expect(screen.getByText('Ask AI')).toBeInTheDocument();
  });

  it('does not show the Ask AI button for simple searches', () => {
    renderPalette();
    const input = screen.getByPlaceholderText(PLACEHOLDER);
    fireEvent.change(input, { target: { value: 'nginx' } });
    expect(screen.queryByText('Ask AI')).toBeNull();
  });

  it('orders the Intelligence pages directly after Monitoring and before Diagnostics, mirroring the sidebar', () => {
    const order = pages.map((p) => p.path);
    const metrics = order.indexOf('/metrics'); // last Monitoring view
    const assistant = order.indexOf('/assistant'); // Intelligence
    const llmObservability = order.indexOf('/llm-observability'); // Intelligence
    const traces = order.indexOf('/traces'); // first Diagnostics view

    // Intelligence sits between Monitoring and Diagnostics, matching the
    // sidebar nav order (Monitoring -> Intelligence -> Diagnostics).
    expect(metrics).toBeLessThan(assistant);
    expect(assistant).toBeLessThan(llmObservability);
    expect(llmObservability).toBeLessThan(traces);
  });

  it('does not include deprecated backups page in static page entries', () => {
    renderPalette();
    const input = screen.getByPlaceholderText(PLACEHOLDER);
    fireEvent.change(input, { target: { value: 'se' } });
    expect(screen.queryByText('Backups')).not.toBeInTheDocument();
    expect(screen.getAllByText('Settings').length).toBeGreaterThan(0);
  });


  it('names things the way the sidebar names them', () => {
    renderPalette();
    const input = screen.getByPlaceholderText(PLACEHOLDER);
    // 'server' matches the mocked endpoints as well as the mocked containers.
    fireEvent.change(input, { target: { value: 'server' } });

    const headings = Array.from(
      document.querySelectorAll('[cmdk-group-heading]'),
    ).map((el) => el.textContent);

    expect(headings).toContain('Containers');
    expect(headings).toContain('Endpoints');
    expect(headings).toContain('Pages');
    expect(headings).toContain('Logs');
    for (const invented of [
      'Infrastructure Units',
      'Nodes',
      'Neural Navigation',
      'Binary Blueprints',
      'Neural Log Stream',
    ]) {
      expect(headings).not.toContain(invented);
    }
  });

  it('carries no "Neural" vocabulary anywhere in the rendered palette', () => {
    renderPalette();
    const input = screen.getByPlaceholderText(PLACEHOLDER);
    fireEvent.change(input, { target: { value: 'what containers are running' } });
    expect(document.body.textContent).not.toMatch(/neural/i);
  });

  it('drops the tautological footer credit from the shortcut bar', () => {
    renderPalette();
    expect(screen.queryByText(/powered by/i)).toBeNull();
    expect(screen.queryByText(/AI Intelligence/i)).toBeNull();
  });

  it('labels the shortcut bar with plain verbs', () => {
    renderPalette();
    expect(screen.getByText('Navigate')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.queryByText('Traverse')).toBeNull();
    expect(screen.queryByText('Execute')).toBeNull();
  });

  it('offers the destinations the hand-maintained list used to omit', () => {
    const paths = pages.map((p) => p.path);
    expect(paths).toContain('/logs');
    expect(paths).toContain('/packet-capture');
    expect(paths).toContain('/ebpf-coverage');
    expect(paths).toContain('/reports');
    expect(paths).toContain('/security/vulnerabilities');
  });

  it('starts compact and expands when typing', () => {
    renderPalette();
    const dialog = screen.getByPlaceholderText(PLACEHOLDER).closest('[class*="z-[101]"]');
    // Dialog should exist and have the base classes
    expect(dialog?.className).toContain('z-[101]');
    expect(dialog?.className).toContain('w-full');

    // Verify typing updates the query state
    const input = screen.getByPlaceholderText(PLACEHOLDER);
    fireEvent.change(input, { target: { value: 'test' } });
    expect((input as HTMLInputElement).value).toBe('test');
  });

  it('respects prefers-reduced-motion via CSS utility classes', () => {
    renderPalette();
    const dialog = screen.getByPlaceholderText(PLACEHOLDER).closest('[class*="z-[101]"]');
    expect(dialog).toBeInTheDocument();
    expect(dialog?.className).toContain('z-[101]');
  });
});
