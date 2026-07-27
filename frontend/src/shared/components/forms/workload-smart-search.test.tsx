import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Container } from '@/features/containers/hooks/use-containers';

const mockMutate = vi.fn();
const mockNavigate = vi.fn();

vi.mock('@/features/ai-intelligence/hooks/use-nl-query', () => ({
  useNlQuery: () => ({
    mutate: mockMutate,
    isPending: false,
  }),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

import { WorkloadSmartSearch } from './workload-smart-search';

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'c1',
    name: 'nginx-proxy-1',
    image: 'nginx:latest',
    state: 'running',
    status: 'Up 1 hour',
    endpointId: 1,
    endpointName: 'local',
    ports: [],
    created: 1700000000,
    labels: {},
    networks: [],
    ...overrides,
  };
}

const containers: Container[] = [
  makeContainer({ id: 'c1', name: 'nginx-proxy-1', image: 'nginx:latest', state: 'running' }),
  makeContainer({ id: 'c2', name: 'postgres-db-1', image: 'postgres:15', state: 'stopped' }),
  makeContainer({ id: 'c3', name: 'redis-cache-1', image: 'redis:alpine', state: 'running' }),
];

function renderComponent(props: Partial<React.ComponentProps<typeof WorkloadSmartSearch>> = {}) {
  const onFiltered = vi.fn();
  const utils = render(
    <MemoryRouter>
      <WorkloadSmartSearch
        containers={containers}
        knownStackNames={[]}
        onFiltered={onFiltered}
        totalCount={containers.length}
        {...props}
      />
    </MemoryRouter>,
  );
  return { onFiltered, ...utils };
}

describe('WorkloadSmartSearch', () => {
  beforeEach(() => {
    mockMutate.mockReset();
    mockNavigate.mockReset();
  });

  it('renders with default placeholder', () => {
    renderComponent();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/filter by name/i)).toBeInTheDocument();
  });

  it('focuses the search input on mount when autoFocus is set', () => {
    renderComponent({ autoFocus: true });
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });

  it('does not focus the search input on mount by default', () => {
    renderComponent();
    expect(document.activeElement).not.toBe(screen.getByRole('textbox'));
  });

  it('renders with custom placeholder', () => {
    renderComponent({ placeholder: 'Custom placeholder' });
    expect(screen.getByPlaceholderText('Custom placeholder')).toBeInTheDocument();
  });

  it('derives every suggested chip from the loaded containers', () => {
    renderComponent();
    const group = screen.getByRole('group', { name: 'Suggested filters' });
    const labels = Array.from(group.querySelectorAll('button')).map((b) => b.textContent);
    expect(labels.length).toBeGreaterThan(0);
    // 2 running / 1 stopped — the rarest state is the one worth suggesting.
    expect(labels).toContain('state:stopped');
    // Fixture images are nginx / postgres / redis, so `image:nginx` is real here.
    expect(labels).toContain('image:nginx');
    // The literals that used to ship: none of them exist in this fixture.
    expect(labels).not.toContain('stack:traefik');
    expect(labels).not.toContain('endpoint:prod');
  });

  it('every suggested chip returns rows — none empties the table', () => {
    const { onFiltered } = renderComponent();
    const group = screen.getByRole('group', { name: 'Suggested filters' });
    const buttons = Array.from(group.querySelectorAll('button'));

    for (const button of buttons) {
      fireEvent.click(button);
      const last = onFiltered.mock.calls[onFiltered.mock.calls.length - 1][0] as Container[];
      expect(last.length).toBeGreaterThan(0);
      expect(last.length).toBeLessThan(containers.length);
    }
  });

  it('shows no chips for an empty fleet', () => {
    renderComponent({ containers: [], totalCount: 0 });
    expect(screen.queryByRole('group', { name: 'Suggested filters' })).not.toBeInTheDocument();
  });

  it('no suggested chip spends an LLM call', () => {
    renderComponent();
    const group = screen.getByRole('group', { name: 'Suggested filters' });
    for (const button of Array.from(group.querySelectorAll('button'))) {
      fireEvent.click(button);
    }
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('names every supported field prefix, including label:, in the syntax hint', () => {
    renderComponent();
    const hint = screen.getByText(/prefix a term to target one field/i);
    for (const field of ['name', 'image', 'state', 'status', 'stack', 'endpoint', 'port', 'label']) {
      expect(hint.textContent).toContain(field);
    }
    // The AI path is stated in visible copy, not only in the placeholder.
    expect(hint.textContent).toMatch(/press\s*Enter\s*for AI search/i);
  });

  it('does not render the redundant container-count label (issue #1309)', () => {
    renderComponent();
    // Cover all three branches of the deleted label, with arbitrary totals:
    // - `N container(s)` (no filter)
    // - `Showing N of M container(s)` (text filter)
    // - `AI found N of M container(s)` would only render via the AI-filter
    //   card, which is preserved — we explicitly do NOT assert it absent.
    expect(screen.queryByText(/^\d+ containers?$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Showing \d+ of \d+ containers?$/)).not.toBeInTheDocument();
  });

  it('typing calls onFiltered and stays in filter mode (no AI mutate)', () => {
    const { onFiltered } = renderComponent();
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'nginx' } });

    expect(mockMutate).not.toHaveBeenCalled();
    // nginx should match c1 (name) and c3 (image starts with redis but not nginx)
    // actually c1 has name nginx-proxy-1 and image nginx:latest — matches
    // c2 postgres — no match
    // c3 redis — no match
    expect(onFiltered).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 'c1' })]),
    );
    const lastCall = onFiltered.mock.calls[onFiltered.mock.calls.length - 1][0] as Container[];
    expect(lastCall).toHaveLength(1);
  });

  it('shows hint text when typing in filter mode', () => {
    renderComponent();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'nginx' } });
    expect(screen.getByText(/filtering locally/i)).toBeInTheDocument();
  });

  it('hides chips when input has value', () => {
    renderComponent();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'nginx' } });
    expect(screen.queryByRole('group', { name: 'Suggested filters' })).not.toBeInTheDocument();
  });

  it('keeps the chips mounted while the empty field is focused (keyboard reachability)', () => {
    renderComponent();
    const input = screen.getByRole('textbox');
    expect(screen.getByRole('group', { name: 'Suggested filters' })).toBeInTheDocument();

    fireEvent.focus(input);
    expect(screen.getByRole('group', { name: 'Suggested filters' })).toBeInTheDocument();
  });

  it('never hides the placeholder behind the chips', () => {
    renderComponent();
    const input = screen.getByRole('textbox');
    // `placeholder:text-transparent` used to blank the only instruction the
    // empty field carried, precisely when the field was empty.
    expect(input.className).not.toContain('placeholder:text-transparent');
  });

  it('renders the chips below the field, not overlaid inside it', () => {
    renderComponent();
    const input = screen.getByRole('textbox');
    const group = screen.getByRole('group', { name: 'Suggested filters' });
    // Overlaying meant absolute positioning inside the input's wrapper; on a
    // phone the chips then consumed the whole field.
    expect(group.className).not.toContain('absolute');
    expect(group.className).toContain('flex-wrap');
    expect(input.parentElement?.contains(group)).toBe(false);
    expect(
      input.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('pressing Enter calls mutate (AI mode) and shows AI badge', async () => {
    renderComponent();
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'running containers' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockMutate).toHaveBeenCalledWith('running containers', expect.any(Object));

    // Simulate success
    const onSuccess = mockMutate.mock.calls[0][1].onSuccess;
    onSuccess({ action: 'answer', text: 'Found 2 running containers' });

    await waitFor(() => {
      expect(screen.getByText('AI')).toBeInTheDocument();
    });
  });

  it('editing after AI result clears aiResult and goes back to filter mode', async () => {
    renderComponent();
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'some query' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const onSuccess = mockMutate.mock.calls[0][1].onSuccess;
    onSuccess({ action: 'answer', text: 'AI result text' });

    await waitFor(() => expect(screen.getByText('AI result text')).toBeInTheDocument());

    // Now edit the input
    fireEvent.change(input, { target: { value: 'some query edited' } });

    expect(screen.queryByText('AI result text')).not.toBeInTheDocument();
    expect(screen.queryByText('AI')).not.toBeInTheDocument();
  });

  it('clear button resets all state', async () => {
    const { onFiltered } = renderComponent();
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'nginx' } });
    expect(screen.getByRole('button', { name: /clear search/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /clear search/i }));

    expect((input as HTMLInputElement).value).toBe('');
    expect(screen.queryByText(/filtering locally/i)).not.toBeInTheDocument();
    // onFiltered called with all containers after clear
    const lastCall = onFiltered.mock.calls[onFiltered.mock.calls.length - 1][0] as Container[];
    expect(lastCall).toHaveLength(3);
  });

  it('Escape key resets all state', () => {
    const { onFiltered } = renderComponent();
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: 'postgres' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect((input as HTMLInputElement).value).toBe('');
    const lastCall = onFiltered.mock.calls[onFiltered.mock.calls.length - 1][0] as Container[];
    expect(lastCall).toHaveLength(3);
  });

  it('Escape exits the field (blurs the input)', () => {
    renderComponent();
    const input = screen.getByRole('textbox');

    input.focus();
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(document.activeElement).not.toBe(input);
  });

  it('clicking a filter chip sets query and filters', () => {
    const { onFiltered } = renderComponent();
    fireEvent.click(screen.getByRole('button', { name: 'state:stopped' }));

    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('state:stopped');
    const lastCall = onFiltered.mock.calls[onFiltered.mock.calls.length - 1][0] as Container[];
    expect(lastCall).toHaveLength(1); // only c2 is stopped
  });

  it('shows answer result card after AI search', async () => {
    renderComponent();
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'high memory' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const onSuccess = mockMutate.mock.calls[0][1].onSuccess;
    onSuccess({ action: 'answer', text: 'No containers exceed memory limits', description: 'All healthy' });

    await waitFor(() => {
      expect(screen.getByText('No containers exceed memory limits')).toBeInTheDocument();
      expect(screen.getByText('All healthy')).toBeInTheDocument();
    });
  });

  it('shows error result card on failure', async () => {
    renderComponent();
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'error query' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const onError = mockMutate.mock.calls[0][1].onError;
    onError(new Error('LLM down'));

    await waitFor(() => {
      expect(screen.getByText(/failed to process query/i)).toBeInTheDocument();
    });
  });

  it('shows navigate result with button', async () => {
    renderComponent();
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'go to logs' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const onSuccess = mockMutate.mock.calls[0][1].onSuccess;
    onSuccess({ action: 'navigate', page: '/logs', description: 'View container logs' });

    await waitFor(() => {
      expect(screen.getByText('View container logs')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('View container logs'));
    expect(mockNavigate).toHaveBeenCalledWith('/logs');
  });

  describe('filter action (AI search filtering)', () => {
    it('applies AI filter and calls onFiltered with matching containers', async () => {
      const { onFiltered } = renderComponent();
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'find nginx' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      const onSuccess = mockMutate.mock.calls[0][1].onSuccess;
      onSuccess({
        action: 'filter',
        text: 'Found 1 nginx container',
        description: 'Filtered by image',
        filters: { image: 'nginx' },
        containerNames: ['nginx-proxy-1'],
      });

      await waitFor(() => {
        expect(screen.getByText('AI filter active')).toBeInTheDocument();
        expect(screen.getByText('Found 1 nginx container')).toBeInTheDocument();
        expect(screen.getByText('Filtered by image')).toBeInTheDocument();
      });

      // onFiltered should have been called with only the matching container
      const filterCalls = onFiltered.mock.calls;
      const lastFilteredList = filterCalls[filterCalls.length - 1][0] as Container[];
      expect(lastFilteredList).toHaveLength(1);
      expect(lastFilteredList[0].name).toBe('nginx-proxy-1');
    });

    it('shows AI found count in status text', async () => {
      renderComponent();
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'running containers' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      const onSuccess = mockMutate.mock.calls[0][1].onSuccess;
      onSuccess({
        action: 'filter',
        text: 'Found 2 running containers',
        description: 'Filtered by state',
        filters: { state: 'running' },
        containerNames: ['nginx-proxy-1', 'redis-cache-1'],
      });

      await waitFor(() => {
        // The count text now only appears inside the AI result card badge
        // (the footer count label was removed in #1309).
        expect(screen.getByText('AI found 2 of 3 containers')).toBeInTheDocument();
      });
    });

    it('performs case-insensitive name matching', async () => {
      const { onFiltered } = renderComponent();
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'find nginx' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      const onSuccess = mockMutate.mock.calls[0][1].onSuccess;
      onSuccess({
        action: 'filter',
        text: 'Found 1 container',
        filters: {},
        containerNames: ['NGINX-PROXY-1'], // uppercase
      });

      await waitFor(() => {
        const filterCalls = onFiltered.mock.calls;
        const lastFilteredList = filterCalls[filterCalls.length - 1][0] as Container[];
        expect(lastFilteredList).toHaveLength(1);
        expect(lastFilteredList[0].name).toBe('nginx-proxy-1');
      });
    });

    it('answer action does not change table filtering', async () => {
      const { onFiltered } = renderComponent();
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'how many running?' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      const onSuccess = mockMutate.mock.calls[0][1].onSuccess;
      onSuccess({
        action: 'answer',
        text: '2 containers are running',
        description: 'Based on current data',
      });

      await waitFor(() => {
        expect(screen.getByText('2 containers are running')).toBeInTheDocument();
      });

      // The last call to onFiltered should have been the local filter, not an AI filter override
      // The count display should NOT show "AI found" text
      expect(screen.queryByText('AI filter active')).not.toBeInTheDocument();
      expect(screen.queryByText(/AI found/)).not.toBeInTheDocument();
    });

    it('clears AI filter when clear button is clicked', async () => {
      const { onFiltered } = renderComponent();
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'find nginx' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      const onSuccess = mockMutate.mock.calls[0][1].onSuccess;
      onSuccess({
        action: 'filter',
        text: 'Found 1 container',
        filters: { image: 'nginx' },
        containerNames: ['nginx-proxy-1'],
      });

      await waitFor(() => {
        expect(screen.getByText('AI filter active')).toBeInTheDocument();
      });

      // Click clear
      fireEvent.click(screen.getByRole('button', { name: /clear search/i }));

      expect(screen.queryByText('AI filter active')).not.toBeInTheDocument();
      const filterCalls = onFiltered.mock.calls;
      const lastFilteredList = filterCalls[filterCalls.length - 1][0] as Container[];
      expect(lastFilteredList).toHaveLength(3); // all containers restored
    });

    it('clears AI filter when user types in input', async () => {
      renderComponent();
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'find nginx' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      const onSuccess = mockMutate.mock.calls[0][1].onSuccess;
      onSuccess({
        action: 'filter',
        text: 'Found 1 container',
        filters: { image: 'nginx' },
        containerNames: ['nginx-proxy-1'],
      });

      await waitFor(() => {
        expect(screen.getByText('AI filter active')).toBeInTheDocument();
      });

      // Type in input to go back to local filter mode
      fireEvent.change(input, { target: { value: 'redis' } });

      expect(screen.queryByText('AI filter active')).not.toBeInTheDocument();
    });

    it('handles filter action with empty containerNames (no matches)', async () => {
      const { onFiltered } = renderComponent();
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'find nonexistent' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      const onSuccess = mockMutate.mock.calls[0][1].onSuccess;
      onSuccess({
        action: 'filter',
        text: 'No matching containers',
        filters: { name: 'nonexistent' },
        containerNames: [],
      });

      await waitFor(() => {
        // With empty containerNames, the filter should not be applied (no AI filter active)
        expect(screen.queryByText('AI filter active')).not.toBeInTheDocument();
        expect(screen.getByText('No matching containers')).toBeInTheDocument();
      });
    });
  });
});
