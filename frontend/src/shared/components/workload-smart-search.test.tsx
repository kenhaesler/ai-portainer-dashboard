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
  makeContainer({ id: 'c2', name: 'postgres-db-1', image: 'postgres:15', state: 'exited' }),
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

  it('renders with custom placeholder', () => {
    renderComponent({ placeholder: 'Custom placeholder' });
    expect(screen.getByPlaceholderText('Custom placeholder')).toBeInTheDocument();
  });

  it('shows filter chips and AI chips when input empty', () => {
    renderComponent();
    expect(screen.getByRole('button', { name: /state:running/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /image:nginx/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /stopped containers using high memory/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /all nginx containers on prod/i })).toBeInTheDocument();
  });

  it('shows container count when empty', () => {
    renderComponent();
    expect(screen.getByText('3 containers')).toBeInTheDocument();
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
    expect(screen.queryByRole('button', { name: /state:running/i })).not.toBeInTheDocument();
  });

  it('shows "Showing X of Y" count when filtered', () => {
    renderComponent();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'nginx' } });
    expect(screen.getByText('Showing 1 of 3 containers')).toBeInTheDocument();
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
    expect(screen.getByText('3 containers')).toBeInTheDocument();
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

  it('clicking a filter chip sets query and filters', () => {
    const { onFiltered } = renderComponent();
    fireEvent.click(screen.getByRole('button', { name: 'state:running' }));

    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('state:running');
    const lastCall = onFiltered.mock.calls[onFiltered.mock.calls.length - 1][0] as Container[];
    expect(lastCall).toHaveLength(2); // c1 and c3 are running
  });

  it('clicking an AI chip triggers mutate', () => {
    renderComponent();
    fireEvent.click(screen.getByRole('button', { name: /stopped containers using high memory/i }));

    expect(mockMutate).toHaveBeenCalledWith('stopped containers using high memory', expect.any(Object));
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

  it('shows singular "container" for totalCount=1', () => {
    renderComponent({ containers: [containers[0]], totalCount: 1 });
    expect(screen.getByText('1 container')).toBeInTheDocument();
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
        // The count text appears in the card badge area and the footer count display
        const matches = screen.getAllByText('AI found 2 of 3 containers');
        expect(matches.length).toBeGreaterThanOrEqual(1);
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
