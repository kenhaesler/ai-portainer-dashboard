# Metrics Dashboard Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/metrics` faster to navigate and harder to misread — add container search, clarify what CPU%/memory% mean, put charts 2-up, and move the container name into the global header.

**Architecture:** Frontend-only UI changes plus **one new read-only backend endpoint** (`GET /api/metrics/:endpointId/:containerId/meta`) that projects the already-cached Docker stats into `{ memoryLimitBytes, onlineCpus, usedBytes }`. No DB schema or migration changes; no container-mutating actions (observer-only). The container name is fed into the shared `Header` via a small ephemeral zustand slice that the metrics page sets on selection and clears on unmount.

**Tech Stack:** Fastify 5 + `fastify-type-provider-zod` (backend), React 19 + TanStack Query + zustand + Vitest/jsdom + Testing Library (frontend).

**Spec:** `docs/superpowers/specs/2026-06-04-metrics-dashboard-overhaul-design.md`

**Branch:** `feature/1429-metrics-dashboard-overhaul` (already created).

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `packages/observability/src/routes/metrics.ts` | Metrics HTTP routes | Add `/meta` route (Task 1) |
| `packages/observability/src/__tests__/metrics-route.test.ts` | Route tests | Add `/meta` tests (Task 1) |
| `frontend/src/stores/header-context-store.ts` | Ephemeral page→header context | **Create** (Task 2) |
| `frontend/src/features/core/components/layout/header.tsx` | Global header | Render container name from store (Task 2) |
| `frontend/src/features/core/components/layout/header.test.tsx` | Header tests | Add name tests (Task 2) |
| `frontend/src/features/observability/pages/metrics-dashboard.tsx` | Metrics page | Header wiring + remove Container card + 3-up KPI grid (Task 3); `/meta` hook + %-labels (Task 4); search (Task 5); 2-up charts (Task 6) |
| `frontend/src/features/observability/hooks/use-metrics.ts` | Metrics data hooks | Add `useContainerMetricsMeta` (Task 4) |
| `frontend/src/features/observability/pages/metrics-dashboard.test.tsx` | Page tests | Add tests (Tasks 3–6) |
| `docs/architecture.md`, `CLAUDE.md` | Docs | Document the new endpoint + UI (Task 7) |

---

## Task 1: Backend `/meta` endpoint (memory limit + online CPUs)

**Files:**
- Modify: `packages/observability/src/routes/metrics.ts`
- Test: `packages/observability/src/__tests__/metrics-route.test.ts`

- [ ] **Step 1: Add the test mocks + failing tests**

In `metrics-route.test.ts`, add these module mocks near the other `vi.mock` calls at the top (after the `metrics-rollup-selector` mock, before `import { getNetworkRates }`):

```ts
// Kept: portainer client/cache mocks — no Portainer in CI. cachedFetch runs the factory directly.
vi.mock('@dashboard/core/portainer/portainer-client.js', () => ({
  getContainerStats: vi.fn(),
}));
vi.mock('@dashboard/core/portainer/portainer-cache.js', () => ({
  cachedFetch: (_key: string, _ttl: number, fn: () => unknown) => fn(),
  getCacheKey: (...parts: unknown[]) => parts.join(':'),
  TTL: { STATS: 5 },
}));
```

Add the mocked import alongside `const mockGetNetworkRates = vi.mocked(getNetworkRates);`:

```ts
import { getContainerStats } from '@dashboard/core/portainer/portainer-client.js';
const mockGetContainerStats = vi.mocked(getContainerStats);
```

Add a new `describe` block (place it after the `GET /api/metrics/:endpointId/:containerId` describe block):

```ts
describe('GET /api/metrics/:endpointId/:containerId/meta', () => {
  it('returns memory limit, online CPUs, and used bytes', async () => {
    mockGetContainerStats.mockResolvedValue({
      cpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0, online_cpus: 4 },
      precpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
      memory_stats: { usage: 400 * 1024 * 1024, limit: 512 * 1024 * 1024, stats: { cache: 64 * 1024 * 1024 } },
    } as never);

    const response = await app.inject({ method: 'GET', url: '/api/metrics/1/abc123/meta' });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.memoryLimitBytes).toBe(512 * 1024 * 1024);
    expect(body.onlineCpus).toBe(4);
    expect(body.usedBytes).toBe(336 * 1024 * 1024); // 400MB usage − 64MB cache
    expect(mockGetContainerStats).toHaveBeenCalledWith(1, 'abc123');
  });

  it('degrades to nulls when stats are unavailable', async () => {
    mockGetContainerStats.mockRejectedValue(new Error('endpoint down'));

    const response = await app.inject({ method: 'GET', url: '/api/metrics/1/abc123/meta' });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toEqual({ memoryLimitBytes: null, onlineCpus: null, usedBytes: null });
  });

  it('requires authentication (preHandler wired)', async () => {
    const guarded = Fastify();
    guarded.setValidatorCompiler(validatorCompiler);
    guarded.setSerializerCompiler(serializerCompiler);
    guarded.decorate('authenticate', async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => void } }) => {
      reply.code(401).send({ error: 'Unauthorized' });
    });
    guarded.register(metricsRoutes, {});
    await guarded.ready();

    const response = await guarded.inject({ method: 'GET', url: '/api/metrics/1/abc123/meta' });
    expect(response.statusCode).toBe(401);
    await guarded.close();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /home/simon/Documents/ai-portainer-dashboard/packages/observability && npx vitest run src/__tests__/metrics-route.test.ts -t meta`
Expected: FAIL — the `/meta` route returns 404 (route not registered), so the body assertions fail.

- [ ] **Step 3: Add the imports to the route module**

At the top of `packages/observability/src/routes/metrics.ts`, add after the existing `import` lines (e.g. after the `network-rate-tracker.js` import):

```ts
import { getContainerStats } from '@dashboard/core/portainer/portainer-client.js';
import { cachedFetch, getCacheKey, TTL } from '@dashboard/core/portainer/portainer-cache.js';
```

- [ ] **Step 4: Register the route**

In `metrics.ts`, immediately after the first route block closes (the `fastify.get('/api/metrics/:endpointId/:containerId', …)` handler — i.e. right after its closing `});` near line 131), add:

```ts
  // Per-container resource ceilings for the dashboard's %-clarification labels.
  // Reuses the same cached Docker stats the collector fetches — no extra Portainer load,
  // no persisted data. Read-only (authenticate only), observer-safe.
  fastify.get('/api/metrics/:endpointId/:containerId/meta', {
    schema: {
      tags: ['Metrics'],
      summary: 'Get per-container memory limit and online CPU count (label denominators)',
      security: [{ bearerAuth: [] }],
      params: ContainerParamsSchema,
    },
    preHandler: [fastify.authenticate],
  }, async (request) => {
    const { endpointId, containerId } = request.params as { endpointId: number; containerId: string };
    try {
      const stats = await cachedFetch(
        getCacheKey('stats', endpointId, containerId),
        TTL.STATS,
        () => getContainerStats(endpointId, containerId),
      );
      const usage = stats.memory_stats.usage ?? 0;
      const cache =
        stats.memory_stats.stats?.cache ??
        stats.memory_stats.stats?.total_cache ??
        0;
      return {
        memoryLimitBytes: stats.memory_stats.limit ?? null,
        onlineCpus: stats.cpu_stats.online_cpus ?? null,
        usedBytes: Math.max(0, usage - cache),
      };
    } catch (err) {
      log.debug({ err, endpointId, containerId }, 'Container meta unavailable');
      return { memoryLimitBytes: null, onlineCpus: null, usedBytes: null };
    }
  });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /home/simon/Documents/ai-portainer-dashboard/packages/observability && npx vitest run src/__tests__/metrics-route.test.ts`
Expected: PASS — all existing tests plus the 3 new `/meta` tests.

- [ ] **Step 6: Commit**

```bash
git add packages/observability/src/routes/metrics.ts packages/observability/src/__tests__/metrics-route.test.ts
git commit -m "feat(metrics): read-only /meta endpoint for memory limit + online CPUs (#1429)"
```

---

## Task 2: Header context store + render container name in header

**Files:**
- Create: `frontend/src/stores/header-context-store.ts`
- Modify: `frontend/src/features/core/components/layout/header.tsx`
- Test: `frontend/src/features/core/components/layout/header.test.tsx`

- [ ] **Step 1: Create the store**

Create `frontend/src/stores/header-context-store.ts`:

```ts
import { create } from 'zustand';

/**
 * Ephemeral, per-session header context. The Metrics page sets the selected
 * container name here so the shared <Header> can show it in the breadcrumb,
 * and clears it on unmount. Not persisted — it is page state, not a preference.
 */
interface HeaderContextState {
  metricsContainerName: string | null;
  setMetricsContainerName: (name: string | null) => void;
  clearMetricsContainerName: () => void;
}

export const useHeaderContextStore = create<HeaderContextState>((set) => ({
  metricsContainerName: null,
  setMetricsContainerName: (name) => set({ metricsContainerName: name }),
  clearMetricsContainerName: () => set({ metricsContainerName: null }),
}));
```

- [ ] **Step 2: Write the failing header tests**

In `frontend/src/features/core/components/layout/header.test.tsx`, add the import near the top imports:

```ts
import { useHeaderContextStore } from '@/stores/header-context-store';
```

Inside the `describe('Header', …)` block, add a reset to `afterEach` (the block already has an `afterEach`; add this line to it):

```ts
    useHeaderContextStore.setState({ metricsContainerName: null });
```

Add two new tests inside the describe block:

```ts
  it('renders the metrics container name when set', () => {
    useHeaderContextStore.setState({ metricsContainerName: 'nginx-proxy' });
    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    );
    expect(screen.getByTestId('header-context-name')).toHaveTextContent('nginx-proxy');
  });

  it('renders no container name when unset', () => {
    useHeaderContextStore.setState({ metricsContainerName: null });
    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    );
    expect(screen.queryByTestId('header-context-name')).toBeNull();
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd /home/simon/Documents/ai-portainer-dashboard/frontend && npx vitest run src/features/core/components/layout/header.test.tsx -t "container name"`
Expected: FAIL — `header-context-name` testid not found (header doesn't render it yet).

- [ ] **Step 4: Wire the store into the header**

In `header.tsx`, add the import after the other store imports (e.g. after `import { useUiStore } from '@/stores/ui-store';`):

```ts
import { useHeaderContextStore } from '@/stores/header-context-store';
```

Inside the `Header` component, add near the other store reads (e.g. after `const setCommandPaletteOpen = useUiStore(...)`):

```ts
  const metricsContainerName = useHeaderContextStore((s) => s.metricsContainerName);
```

In the `<nav aria-label="Breadcrumb" …>` block, insert this **between** the closing `))}` of `breadcrumbs.map(...)` and the build-badge `{(appBuildRef || buildChannel) && (` block:

```tsx
        {metricsContainerName && (
          <span className="flex items-center gap-1.5">
            <span className="text-muted-foreground">/</span>
            <span className="font-medium text-foreground" data-testid="header-context-name">
              {metricsContainerName}
            </span>
          </span>
        )}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /home/simon/Documents/ai-portainer-dashboard/frontend && npx vitest run src/features/core/components/layout/header.test.tsx`
Expected: PASS — all existing header tests plus the 2 new ones.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/stores/header-context-store.ts frontend/src/features/core/components/layout/header.tsx frontend/src/features/core/components/layout/header.test.tsx
git commit -m "feat(header): show metrics container name via ephemeral context store (#1429)"
```

---

## Task 3: Page — set header name, remove Container KPI card, 3-up KPI grid

**Files:**
- Modify: `frontend/src/features/observability/pages/metrics-dashboard.tsx`
- Test: `frontend/src/features/observability/pages/metrics-dashboard.test.tsx`

- [ ] **Step 1: Write the failing page tests**

In `metrics-dashboard.test.tsx`, add the store import after the `import MetricsDashboardPage from './metrics-dashboard';` line:

```ts
import { useHeaderContextStore } from '@/stores/header-context-store';
```

In the `describe('MetricsDashboardPage', …)` `beforeEach`, add a store reset as the first line:

```ts
    useHeaderContextStore.setState({ metricsContainerName: null });
```

Add a `waitFor` to the testing-library import at the top of the file (change `import { fireEvent, render, screen } from '@testing-library/react';` to include `waitFor`):

```ts
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
```

Add these tests inside the describe block:

```ts
  it('removes the Container KPI card and keeps three metric cards', () => {
    renderPage();
    const endpointSelect = screen.getAllByRole('combobox')[0];
    fireEvent.click(endpointSelect);
    fireEvent.click(screen.getByRole('option', { name: 'local' }));
    const containerSelect = screen.getAllByRole('combobox')[2];
    fireEvent.click(containerSelect);
    fireEvent.click(screen.getByRole('option', { name: 'worker-1' }));

    expect(screen.queryByText('Container')).toBeNull();
    expect(screen.getByText('Avg CPU')).toBeInTheDocument();
    expect(screen.getByText('Avg Memory')).toBeInTheDocument();
    expect(screen.getByText('Peak Memory')).toBeInTheDocument();
    expect(screen.getByTestId('metrics-kpi-grid').className).toContain('md:grid-cols-3');
  });

  it('publishes the selected container name to the header store and clears on unmount', async () => {
    const { unmount } = renderPage();
    const endpointSelect = screen.getAllByRole('combobox')[0];
    fireEvent.click(endpointSelect);
    fireEvent.click(screen.getByRole('option', { name: 'local' }));
    const containerSelect = screen.getAllByRole('combobox')[2];
    fireEvent.click(containerSelect);
    fireEvent.click(screen.getByRole('option', { name: 'worker-1' }));

    await waitFor(() =>
      expect(useHeaderContextStore.getState().metricsContainerName).toBe('worker-1'),
    );

    unmount();
    expect(useHeaderContextStore.getState().metricsContainerName).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /home/simon/Documents/ai-portainer-dashboard/frontend && npx vitest run src/features/observability/pages/metrics-dashboard.test.tsx -t "Container KPI card"`
Expected: FAIL — "Container" text still present (card not removed) and `metrics-kpi-grid` testid missing.

- [ ] **Step 3: Wire the header store into the page**

In `metrics-dashboard.tsx`, add the import after the existing store/hook imports (e.g. after the `use-metrics` import line):

```ts
import { useHeaderContextStore } from '@/stores/header-context-store';
```

Inside `MetricsDashboardPage`, after `const selectedContainerData = useMemo(...)` (around line 190), add:

```ts
  const setMetricsContainerName = useHeaderContextStore((s) => s.setMetricsContainerName);
  const clearMetricsContainerName = useHeaderContextStore((s) => s.clearMetricsContainerName);

  // Feed the selected container name to the shared header; clear on deselect/unmount.
  useEffect(() => {
    if (selectedContainerData?.name) {
      setMetricsContainerName(selectedContainerData.name);
    } else {
      clearMetricsContainerName();
    }
  }, [selectedContainerData, setMetricsContainerName, clearMetricsContainerName]);

  useEffect(() => () => clearMetricsContainerName(), [clearMetricsContainerName]);
```

- [ ] **Step 4: Remove the Container KPI card and switch the grid to 3 columns**

In `metrics-dashboard.tsx`, change the KPI grid wrapper (around line 666) from:

```tsx
            <div className="grid gap-4 md:grid-cols-4">
              <SpotlightCard>
                <div className="rounded-lg border bg-card p-6 shadow-sm">
                  <p className="text-sm font-medium text-muted-foreground">Container</p>
                  <p className="mt-2 text-3xl font-bold tracking-tight truncate">{selectedContainerData.name}</p>
                </div>
              </SpotlightCard>
              <SpotlightCard>
```

to (drop the entire Container `SpotlightCard`, change `md:grid-cols-4` → `md:grid-cols-3`, add the testid):

```tsx
            <div className="grid gap-4 md:grid-cols-3" data-testid="metrics-kpi-grid">
              <SpotlightCard>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /home/simon/Documents/ai-portainer-dashboard/frontend && npx vitest run src/features/observability/pages/metrics-dashboard.test.tsx`
Expected: PASS — all existing page tests plus the 2 new ones.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/observability/pages/metrics-dashboard.tsx frontend/src/features/observability/pages/metrics-dashboard.test.tsx
git commit -m "feat(metrics): container name in header, drop Container KPI card, 3-up KPI grid (#1429)"
```

---

## Task 4: Page — `/meta` hook + CPU%/memory% clarification labels

**Files:**
- Modify: `frontend/src/features/observability/hooks/use-metrics.ts`
- Modify: `frontend/src/features/observability/pages/metrics-dashboard.tsx`
- Test: `frontend/src/features/observability/pages/metrics-dashboard.test.tsx`

- [ ] **Step 1: Add the `useContainerMetricsMeta` hook**

In `frontend/src/features/observability/hooks/use-metrics.ts`, add after the `useContainerMetrics` function (after line 87):

```ts
export interface ContainerMetricsMeta {
  memoryLimitBytes: number | null;
  onlineCpus: number | null;
  usedBytes: number | null;
}

export function useContainerMetricsMeta(
  endpointId: number | undefined,
  containerId: string | undefined,
) {
  return useQuery<ContainerMetricsMeta>({
    queryKey: ['metrics', 'meta', endpointId, containerId],
    queryFn: () =>
      api.get<ContainerMetricsMeta>(`/api/metrics/${endpointId}/${containerId}/meta`),
    enabled: Boolean(endpointId) && Boolean(containerId),
    staleTime: 60_000,
  });
}
```

- [ ] **Step 2: Write the failing label tests**

In `metrics-dashboard.test.tsx`, update the `use-metrics` mock to expose the new hook. Change the existing mock block:

```ts
vi.mock('@/features/observability/hooks/use-metrics', () => ({
  useContainerMetrics: vi.fn().mockReturnValue({ data: null, isLoading: false, isError: false }),
  useAnomalies: vi.fn().mockReturnValue({ data: null }),
  useNetworkRates: (...args: unknown[]) => mockUseNetworkRates(...args),
  useAnomalyExplanations: vi.fn().mockReturnValue({ data: null }),
}));
```

to add a `mockUseContainerMetricsMeta` and wire it (declare `const mockUseContainerMetricsMeta = vi.fn();` next to the other `mockUse*` declarations near the top of the file):

```ts
vi.mock('@/features/observability/hooks/use-metrics', () => ({
  useContainerMetrics: vi.fn().mockReturnValue({ data: null, isLoading: false, isError: false }),
  useContainerMetricsMeta: (...args: unknown[]) => mockUseContainerMetricsMeta(...args),
  useAnomalies: vi.fn().mockReturnValue({ data: null }),
  useNetworkRates: (...args: unknown[]) => mockUseNetworkRates(...args),
  useAnomalyExplanations: vi.fn().mockReturnValue({ data: null }),
}));
```

Update the `use-endpoints` mock to include host CPU/memory (the host-total comparison needs `totalMemory`). Change it to:

```ts
vi.mock('@/features/containers/hooks/use-endpoints', () => ({
  useEndpoints: vi.fn().mockReturnValue({
    data: [{ id: 1, name: 'local', totalCpu: 4, totalMemory: 34359738368 }], // 32 GiB
    isLoading: false,
  }),
}));
```

In `beforeEach`, set the default meta return (limit set — 512 MiB limit, ~322 MiB used):

```ts
    mockUseContainerMetricsMeta.mockReturnValue({
      data: { memoryLimitBytes: 536870912, onlineCpus: 4, usedBytes: 337641472 },
    });
```

Add these tests:

```ts
  it('shows the CPU core-count clarification sub-label', () => {
    renderPage();
    const endpointSelect = screen.getAllByRole('combobox')[0];
    fireEvent.click(endpointSelect);
    fireEvent.click(screen.getByRole('option', { name: 'local' }));
    const containerSelect = screen.getAllByRole('combobox')[2];
    fireEvent.click(containerSelect);
    fireEvent.click(screen.getByRole('option', { name: 'worker-1' }));

    expect(screen.getByText(/of 4 cores/)).toBeInTheDocument();
    expect(screen.getByText(/max 400%/)).toBeInTheDocument();
  });

  it('shows the memory denominator with the container limit', () => {
    renderPage();
    const endpointSelect = screen.getAllByRole('combobox')[0];
    fireEvent.click(endpointSelect);
    fireEvent.click(screen.getByRole('option', { name: 'local' }));
    const containerSelect = screen.getAllByRole('combobox')[2];
    fireEvent.click(containerSelect);
    fireEvent.click(screen.getByRole('option', { name: 'worker-1' }));

    expect(screen.getByText(/512 MB limit/)).toBeInTheDocument();
  });

  it('labels memory as host-total when no limit is set', () => {
    mockUseContainerMetricsMeta.mockReturnValue({
      data: { memoryLimitBytes: 34359738368, onlineCpus: 4, usedBytes: 2791728742 }, // limit == host RAM
    });
    renderPage();
    const endpointSelect = screen.getAllByRole('combobox')[0];
    fireEvent.click(endpointSelect);
    fireEvent.click(screen.getByRole('option', { name: 'local' }));
    const containerSelect = screen.getAllByRole('combobox')[2];
    fireEvent.click(containerSelect);
    fireEvent.click(screen.getByRole('option', { name: 'worker-1' }));

    expect(screen.getByText(/no limit set/)).toBeInTheDocument();
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd /home/simon/Documents/ai-portainer-dashboard/frontend && npx vitest run src/features/observability/pages/metrics-dashboard.test.tsx -t "sub-label"`
Expected: FAIL — sub-label text not found (labels not implemented yet).

- [ ] **Step 4: Add a memory-size formatter helper**

In `metrics-dashboard.tsx`, add next to the existing `formatBytes` helper (after line 82):

```ts
function formatMemSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}
```

- [ ] **Step 5: Compute the label data in the component**

In `metrics-dashboard.tsx`, add the meta hook call near the other metric hooks (e.g. after the `memoryBytesMetrics` hook around line 242):

```ts
  const { data: containerMeta } = useContainerMetricsMeta(
    selectedEndpoint ?? undefined,
    selectedContainer ?? undefined,
  );
```

Add `useContainerMetricsMeta` to the existing `use-metrics` import at the top of the file:

```ts
import { useContainerMetrics, useAnomalies, useNetworkRates, useAnomalyExplanations, useContainerMetricsMeta } from '@/features/observability/hooks/use-metrics';
```

After `const selectedContainerData = useMemo(...)` add the derived endpoint + labels (place after the existing `selectedContainerData`/`networkTrafficData` memos, before the `stats` memo):

```ts
  const selectedEndpointData = useMemo(
    () => endpoints?.find((ep) => ep.id === selectedEndpoint) ?? null,
    [endpoints, selectedEndpoint],
  );

  const cpuCoresLabel = useMemo(() => {
    const cores = containerMeta?.onlineCpus ?? selectedEndpointData?.totalCpu ?? null;
    if (!cores) return null;
    const used = stats.cpu.avg / 100;
    return `≈${used.toFixed(1)} of ${cores} core${cores === 1 ? '' : 's'} (max ${cores * 100}%)`;
  }, [containerMeta, selectedEndpointData, stats.cpu.avg]);

  const memoryDenominatorLabel = useMemo(() => {
    const limit = containerMeta?.memoryLimitBytes ?? null;
    const used = containerMeta?.usedBytes ?? null;
    const hostTotal = selectedEndpointData?.totalMemory ?? null;
    if (limit == null || used == null) return null;
    const isHostTotal = hostTotal != null && limit >= hostTotal * 0.99;
    return isHostTotal
      ? `${formatMemSize(used)} / ${formatMemSize(limit)} host (no limit set)`
      : `${formatMemSize(used)} / ${formatMemSize(limit)} limit`;
  }, [containerMeta, selectedEndpointData]);
```

> Note: `cpuCoresLabel` references `stats`, which is declared just below in the current file. Move these three `useMemo` blocks to **after** the `const stats = useMemo(...)` block (around line 329) so `stats` is defined first. (`selectedEndpointData` has no such dependency and may stay earlier, but keeping all three together after `stats` is simplest.)

- [ ] **Step 6: Render the sub-labels in the CPU and Memory KPI cards**

In the Avg CPU card, add the sub-label after the value `<p>` (after line 676 `…{stats.cpu.avg.toFixed(1)}%</p>`):

```tsx
                  {cpuCoresLabel && (
                    <p
                      className="text-xs text-muted-foreground mt-1"
                      title="Docker docker stats convention — 100% = one full CPU core, so this peaks at 100% × online cores."
                    >
                      {cpuCoresLabel}
                    </p>
                  )}
```

In the Avg Memory card, add the sub-label after its value `<p>` (after line 687 `…{stats.memory.avg.toFixed(1)}%</p>`):

```tsx
                  {memoryDenominatorLabel && (
                    <p
                      className="text-xs text-muted-foreground mt-1"
                      title="memory% = (usage − cache) ÷ limit. Unconstrained containers report the host's total RAM as the limit."
                    >
                      {memoryDenominatorLabel}
                    </p>
                  )}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd /home/simon/Documents/ai-portainer-dashboard/frontend && npx vitest run src/features/observability/pages/metrics-dashboard.test.tsx`
Expected: PASS — all page tests including the 3 new label tests.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/observability/hooks/use-metrics.ts frontend/src/features/observability/pages/metrics-dashboard.tsx frontend/src/features/observability/pages/metrics-dashboard.test.tsx
git commit -m "feat(metrics): clarify CPU%/memory% with core-count and limit sub-labels (#1429)"
```

---

## Task 5: Page — container search (augment the dropdown)

**Files:**
- Modify: `frontend/src/features/observability/pages/metrics-dashboard.tsx`
- Test: `frontend/src/features/observability/pages/metrics-dashboard.test.tsx`

- [ ] **Step 1: Write the failing search test**

In `metrics-dashboard.test.tsx`, add this test inside the describe block:

```ts
  it('filters the container dropdown options via the search box', async () => {
    renderPage();
    const endpointSelect = screen.getAllByRole('combobox')[0];
    fireEvent.click(endpointSelect);
    fireEvent.click(screen.getByRole('option', { name: 'local' }));

    const search = screen.getByLabelText('Search containers');
    fireEvent.change(search, { target: { value: 'worker' } });

    const containerSelect = screen.getAllByRole('combobox')[2];
    await waitFor(() => {
      fireEvent.click(containerSelect);
      expect(screen.getByRole('option', { name: 'worker-1' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('option', { name: 'api-1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'beta-api-1' })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/simon/Documents/ai-portainer-dashboard/frontend && npx vitest run src/features/observability/pages/metrics-dashboard.test.tsx -t "search box"`
Expected: FAIL — `getByLabelText('Search containers')` throws (no search input rendered).

- [ ] **Step 3: Add the FleetSearch import and query state**

In `metrics-dashboard.tsx`, add the import after the other component imports (e.g. after the `RefreshControls` import):

```ts
import { FleetSearch } from '@/features/containers/components/fleet/fleet-search';
```

Add state next to the other `useState` declarations (after `const [selectedContainer, setSelectedContainer] = useState<string | null>(null);`):

```ts
  const [containerQuery, setContainerQuery] = useState('');
```

- [ ] **Step 4: Filter the container options by the query**

In `metrics-dashboard.tsx`, replace the existing `groupedContainerOptions` memo (lines 182-185):

```ts
  const groupedContainerOptions = useMemo(
    () => buildStackGroupedContainerOptions(filteredContainers, stackNamesForEndpoint),
    [filteredContainers, stackNamesForEndpoint],
  );
```

with a query-filtered version:

```ts
  const searchedContainers = useMemo(() => {
    const q = containerQuery.trim().toLowerCase();
    if (!q) return filteredContainers;
    return filteredContainers.filter((container) => {
      const stack = resolveContainerStackName(container, stackNamesForEndpoint) ?? NO_STACK_LABEL;
      return container.name.toLowerCase().includes(q) || stack.toLowerCase().includes(q);
    });
  }, [filteredContainers, containerQuery, stackNamesForEndpoint]);
  const groupedContainerOptions = useMemo(
    () => buildStackGroupedContainerOptions(searchedContainers, stackNamesForEndpoint),
    [searchedContainers, stackNamesForEndpoint],
  );
```

- [ ] **Step 5: Render the FleetSearch above the container select**

In `metrics-dashboard.tsx`, in the Container Selector control group (the third `{/* Container Selector */}` block at lines 518-531), wrap it so the search sits above the dropdown. Replace:

```tsx
        {/* Container Selector */}
        <div className="flex items-center gap-2">
          <Box className="h-4 w-4 text-muted-foreground" />
          <ThemedSelect
            value={selectedContainer ?? '__placeholder__'}
            onValueChange={(val) => val !== '__placeholder__' && setSelectedContainer(val)}
            placeholder="Select container..."
            disabled={!selectedEndpoint || containersLoading}
            options={[
              { value: '__placeholder__', label: 'Select container...', disabled: true },
              ...groupedContainerOptions,
            ]}
          />
        </div>
```

with:

```tsx
        {/* Container Selector */}
        <div className="flex flex-col gap-2">
          <div className="min-w-[16rem]">
            <FleetSearch
              label="Search containers"
              placeholder="Search containers..."
              onSearch={setContainerQuery}
              totalCount={filteredContainers.length}
              filteredCount={searchedContainers.length}
            />
          </div>
          <div className="flex items-center gap-2">
            <Box className="h-4 w-4 text-muted-foreground" />
            <ThemedSelect
              value={selectedContainer ?? '__placeholder__'}
              onValueChange={(val) => val !== '__placeholder__' && setSelectedContainer(val)}
              placeholder="Select container..."
              disabled={!selectedEndpoint || containersLoading}
              options={[
                { value: '__placeholder__', label: 'Select container...', disabled: true },
                ...groupedContainerOptions,
              ]}
            />
          </div>
        </div>
```

Reset the query when the endpoint changes — in `handleEndpointChange` (line 358), add `setContainerQuery('');`:

```ts
  const handleEndpointChange = (endpointId: number) => {
    setSelectedEndpoint(endpointId);
    setSelectedStack(null);
    setSelectedContainer(null);
    setContainerQuery('');
  };
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd /home/simon/Documents/ai-portainer-dashboard/frontend && npx vitest run src/features/observability/pages/metrics-dashboard.test.tsx`
Expected: PASS — all page tests including the search filter test.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/observability/pages/metrics-dashboard.tsx frontend/src/features/observability/pages/metrics-dashboard.test.tsx
git commit -m "feat(metrics): add container search box above the selector (#1429)"
```

---

## Task 6: Page — charts 2 per row

**Files:**
- Modify: `frontend/src/features/observability/pages/metrics-dashboard.tsx`
- Test: `frontend/src/features/observability/pages/metrics-dashboard.test.tsx`

- [ ] **Step 1: Write the failing test**

In `metrics-dashboard.test.tsx`, add `within` to the testing-library import:

```ts
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
```

Add this test inside the describe block. It overrides `useContainerMetrics` to return data so the charts render (otherwise the page shows the "no metrics" empty state):

```ts
  it('renders the three metric charts in a 2-up grid', async () => {
    const { useContainerMetrics } = await import('@/features/observability/hooks/use-metrics');
    vi.mocked(useContainerMetrics).mockReturnValue({
      data: { data: [{ timestamp: '2024-01-01T00:00:00Z', value: 50 }] },
      isLoading: false,
      isError: false,
    } as never);

    renderPage();
    const endpointSelect = screen.getAllByRole('combobox')[0];
    fireEvent.click(endpointSelect);
    fireEvent.click(screen.getByRole('option', { name: 'local' }));
    const containerSelect = screen.getAllByRole('combobox')[2];
    fireEvent.click(containerSelect);
    fireEvent.click(screen.getByRole('option', { name: 'worker-1' }));

    const grid = screen.getByTestId('metrics-charts-grid');
    expect(grid.className).toContain('lg:grid-cols-2');
    expect(within(grid).getAllByTestId('metrics-chart')).toHaveLength(3);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/simon/Documents/ai-portainer-dashboard/frontend && npx vitest run src/features/observability/pages/metrics-dashboard.test.tsx -t "2-up grid"`
Expected: FAIL — `metrics-charts-grid` testid not found (charts still in a `space-y-6` stack).

- [ ] **Step 3: Switch the charts wrapper to a 2-column grid**

In `metrics-dashboard.tsx`, change the charts wrapper (line 733) from:

```tsx
            <div className="space-y-6">
              {/* CPU Chart */}
```

to:

```tsx
            <div className="grid gap-6 lg:grid-cols-2" data-testid="metrics-charts-grid">
              {/* CPU Chart */}
```

(The three `SpotlightCard` chart blocks inside it are unchanged; `height={300 * zoomLevel}` and zoom controls stay as-is.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /home/simon/Documents/ai-portainer-dashboard/frontend && npx vitest run src/features/observability/pages/metrics-dashboard.test.tsx`
Expected: PASS — all page tests including the 2-up grid test.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/observability/pages/metrics-dashboard.tsx frontend/src/features/observability/pages/metrics-dashboard.test.tsx
git commit -m "feat(metrics): render CPU/memory charts 2-up on large screens (#1429)"
```

---

## Task 7: Docs

**Files:**
- Modify: `docs/architecture.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Document the new endpoint in architecture.md**

Find the metrics/observability section in `docs/architecture.md` (search for `/api/metrics`). Add an entry describing the new route:

```markdown
- `GET /api/metrics/:endpointId/:containerId/meta` — read-only projection of the
  container's live (cached) Docker stats: `{ memoryLimitBytes, onlineCpus, usedBytes }`.
  Powers the Metrics Dashboard's CPU% (core count) and memory% (used/limit, host-total)
  clarification labels. Reuses the collector's cached stats (no extra Portainer load);
  no persisted data; `authenticate` only (observer-safe). Returns nulls when stats are
  unavailable so the UI degrades gracefully.
```

- [ ] **Step 2: Note the UI behavior in CLAUDE.md**

In `CLAUDE.md`, under the **Portainer data source** paragraph in the Architecture section, append:

```markdown

The Metrics Dashboard (`/metrics`) surfaces per-container CPU%/memory% **denominators** via a read-only `GET /api/metrics/:endpointId/:containerId/meta` endpoint (memory limit + online CPUs, projected from the cached Docker stats — no schema change). CPU% keeps the Docker convention (100% = one core) with a core-count sub-label; memory% shows `used / limit` and flags host-total when no limit is set. The selected container name is shown in the global header via the ephemeral `useHeaderContextStore` slice (`frontend/src/stores/header-context-store.ts`), set by the page and cleared on unmount.
```

- [ ] **Step 3: Commit**

```bash
git add docs/architecture.md CLAUDE.md
git commit -m "docs(metrics): document /meta endpoint and dashboard overhaul (#1429)"
```

---

## Task 8: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Lint**

Run: `cd /home/simon/Documents/ai-portainer-dashboard && npm run lint`
Expected: PASS (no errors).

- [ ] **Step 2: Typecheck**

Run: `cd /home/simon/Documents/ai-portainer-dashboard && npm run typecheck`
Expected: PASS (no type errors). If `useContainerMetricsMeta`, `useHeaderContextStore`, or `selectedEndpointData` raise errors, fix the referencing site before continuing.

- [ ] **Step 3: Run the full test suite**

Run: `cd /home/simon/Documents/ai-portainer-dashboard && npm test`
Expected: PASS. Backend metrics-route tests and frontend header + metrics-dashboard tests all green.

- [ ] **Step 4: Final commit (if lint/typecheck applied fixes)**

```bash
git add -A
git commit -m "chore(metrics): lint/typecheck fixes for dashboard overhaul (#1429)"
```

(Skip if Steps 1-3 produced no changes.)

---

## Self-Review

**1. Spec coverage:**
- §A backend `/meta` endpoint → Task 1 ✓
- §B CPU%/memory% labels + `useContainerMetricsMeta` hook → Task 4 ✓
- §C container search (augment dropdown) → Task 5 ✓
- §D charts 2-up → Task 6 ✓
- §E container name in header (store slice) + remove Container card + 3-up KPI grid → Tasks 2 & 3 ✓
- §F tests (search, labels both branches, 3-up KPI grid, header name on/off) → Tasks 1-6 ✓; docs → Task 7 ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases" — every code step has concrete code. ✓

**3. Type consistency:**
- `useContainerMetricsMeta(endpointId?, containerId?)` returns `ContainerMetricsMeta { memoryLimitBytes, onlineCpus, usedBytes }` — same field names used by the route (Task 1), the hook (Task 4), the page derivations (Task 4), and the test mocks (Task 4). ✓
- `useHeaderContextStore` exposes `metricsContainerName`, `setMetricsContainerName`, `clearMetricsContainerName` — consistent across store (Task 2), header (Task 2), page (Task 3), and tests. ✓
- `groupedContainerOptions` keeps its name and shape; `searchedContainers` is the new intermediate (Task 5). ✓
- Test data-testids: `header-context-name` (Task 2), `metrics-kpi-grid` (Task 3), `metrics-charts-grid` (Task 6) — each defined in the component before being asserted. ✓
