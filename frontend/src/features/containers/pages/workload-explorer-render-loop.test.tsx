import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { Profiler, type ProfilerOnRenderCallback } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Container } from '@/features/containers/hooks/use-containers';
import WorkloadExplorerPage from './workload-explorer';

/**
 * Render-loop regression guard for /workloads (#1706).
 *
 * The 2026-08-29 critique saw "Maximum update depth exceeded" here, with the
 * console count rising on mount and again on every sort. workload-explorer.test.tsx
 * could never catch it: it replaces both DataTable and WorkloadSmartSearch with
 * stubs, and the loop lived in the real DataTable's selection notifier feeding
 * the page's real `setSelectedContainers`.
 *
 * This file mounts the real page, the real DataTable and the real smart search,
 * and mocks only the HTTP boundary (`fetch`), per CLAUDE.md "Testing & Mocks".
 */

const containers: Container[] = [
  {
    id: 'c-1',
    name: 'workers-api-1',
    image: 'workers:latest',
    state: 'running',
    status: 'Up',
    endpointId: 1,
    endpointName: 'local',
    ports: [],
    created: 1700000000,
    labels: { 'com.docker.compose.project': 'workers' },
    networks: [],
  },
  {
    id: 'c-2',
    name: 'billing-api-1',
    image: 'billing:latest',
    state: 'stopped',
    status: 'Exited (0)',
    endpointId: 1,
    endpointName: 'local',
    ports: [],
    created: 1700000100,
    labels: { 'com.docker.compose.project': 'billing' },
    networks: [],
  },
  {
    id: 'c-3',
    name: 'alpha-proxy',
    image: 'nginx:1.27',
    state: 'running',
    status: 'Up',
    endpointId: 1,
    endpointName: 'local',
    ports: [],
    created: 1700000200,
    labels: {},
    networks: [],
  },
];

const endpoints = [{ id: 1, name: 'local', type: 1, url: 'tcp://local', status: 'up' }];
const stacks = [
  { id: 10, name: 'workers', endpointId: 1, type: 2, status: 'active', envCount: 0 },
  { id: 11, name: 'billing', endpointId: 1, type: 2, status: 'active', envCount: 0 },
];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function routeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.pathname === '/api/containers') return Promise.resolve(jsonResponse(containers));
  if (url.pathname === '/api/endpoints') return Promise.resolve(jsonResponse(endpoints));
  if (url.pathname === '/api/stacks') return Promise.resolve(jsonResponse(stacks));
  return Promise.resolve(jsonResponse([]));
}

/** Commits allowed for one interaction; a loop runs to hundreds. */
const RENDER_BUDGET = 15;

describe('WorkloadExplorerPage — render-loop guard (#1706)', () => {
  let errorSpy: MockInstance<typeof console.error>;
  let commits = 0;
  const onRender: ProfilerOnRenderCallback = () => {
    commits += 1;
  };

  function updateDepthErrors() {
    return errorSpy.mock.calls.filter((args) =>
      args.some((a) => String(a).includes('Maximum update depth exceeded')),
    );
  }

  async function mountPage(initialEntry = '/workloads') {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Profiler id="workloads" onRender={onRender}>
            <WorkloadExplorerPage />
          </Profiler>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    // Wait for the real table to render its rows from the mocked HTTP payload.
    const table = await screen.findByRole('table');
    await within(table).findByText('workers-api-1');
    // Let any trailing effects settle before the caller samples the counter.
    await act(async () => {});
    return table;
  }

  beforeEach(() => {
    commits = 0;
    const originalError = console.error;
    errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      // React only *logs* a passive-effect update loop and then keeps going, so
      // a regression would hang this file rather than fail it. React logs from
      // inside the looping setState call; throwing there aborts the effect,
      // unmounts the tree and ends the loop, and the assertions below report it.
      if (args.some((a) => String(a).includes('Maximum update depth exceeded'))) {
        throw new Error('Render loop detected: Maximum update depth exceeded (#1706)');
      }
      originalError(...args);
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(routeFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mounts without an update-depth loop', async () => {
    await mountPage();

    expect(updateDepthErrors()).toHaveLength(0);
    // Mount includes the loading skeleton and three query resolutions.
    expect(commits).toBeLessThanOrEqual(RENDER_BUDGET * 2);
  });

  it('sorting the table stays within a small render budget', async () => {
    const table = await mountPage();
    const before = commits;

    await act(async () => {
      fireEvent.click(within(table).getByRole('button', { name: /^name/i }));
    });

    expect(commits - before).toBeLessThanOrEqual(RENDER_BUDGET);
    expect(updateDepthErrors()).toHaveLength(0);
  });

  it('typing into the smart search stays within a small render budget and filters the table', async () => {
    const table = await mountPage();
    const before = commits;

    await act(async () => {
      fireEvent.change(screen.getByRole('textbox', { name: /workload smart search/i }), {
        target: { value: 'billing' },
      });
    });

    expect(commits - before).toBeLessThanOrEqual(RENDER_BUDGET);
    expect(updateDepthErrors()).toHaveLength(0);
    await waitFor(() => {
      expect(within(table).queryByText('workers-api-1')).not.toBeInTheDocument();
    });
    expect(within(table).getByText('billing-api-1')).toBeInTheDocument();
  });

  it('changing a dropdown-level filter (state cell) stays within a small render budget', async () => {
    const table = await mountPage();
    const before = commits;

    await act(async () => {
      // The State cell is a filter shortcut that rewrites the URL's `state` param.
      fireEvent.click(within(table).getAllByTitle('Filter by state: running')[0]);
    });

    expect(commits - before).toBeLessThanOrEqual(RENDER_BUDGET);
    expect(updateDepthErrors()).toHaveLength(0);
    await waitFor(() => {
      expect(within(table).queryByText('billing-api-1')).not.toBeInTheDocument();
    });
  });

  it('selecting rows stays within a small render budget and enables Compare', async () => {
    const table = await mountPage();
    const before = commits;

    await act(async () => {
      fireEvent.click(within(table).getByTestId('row-checkbox-1:c-1'));
    });
    await act(async () => {
      fireEvent.click(within(table).getByTestId('row-checkbox-1:c-2'));
    });

    expect(commits - before).toBeLessThanOrEqual(RENDER_BUDGET * 2);
    expect(updateDepthErrors()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Compare 2' })).toBeEnabled();
  });
});
