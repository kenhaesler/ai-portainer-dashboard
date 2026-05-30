# Infrastructure Smart Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Infrastructure page one Workload-Explorer-style smart search bar per tab (with clickable example chips), regroup each tab's filter dropdowns onto the search toolbar, remove the redundant per-table search boxes, and add a smart search bar to the Kubernetes tab.

**Architecture:** Upgrade the existing `FleetSearch` component (add `examples` + `autoFocus` props and the in-field chip overlay) and reuse it on all three tabs. Endpoints/stacks keep filtering through the existing `fleet-search-filter.ts`; a new `k8s-search-filter.ts` filters pods/deployments/services. Each `DataTable` gets `hideSearch` so the smart bar is the only search input.

**Tech Stack:** React 19, TypeScript (strict), Vitest + @testing-library/react (jsdom), Tailwind, `@tanstack/react-table` (DataTable), Radix Tabs.

**Spec:** `docs/superpowers/specs/2026-05-30-infrastructure-smart-search-design.md`

**Branch / worktree:** `worktree-feature+infrastructure-smart-search` at `.claude/worktrees/feature+infrastructure-smart-search` (off `origin/dev`). All `npx vitest`/`npm` commands run from the `frontend/` subdirectory of that worktree.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `frontend/src/features/containers/components/fleet/fleet-search.tsx` | Reusable smart search bar (query state, debounce, clear, count badge) + new example chips & autofocus | Modify |
| `frontend/src/features/containers/components/fleet/fleet-search.test.tsx` | Unit tests for `FleetSearch` | Modify |
| `frontend/src/features/containers/lib/k8s-search-filter.ts` | Parse `namespace:`/`status:`/free-text query; filter K8s resource lists | Create |
| `frontend/src/features/containers/lib/k8s-search-filter.test.ts` | Unit tests for the K8s filter | Create |
| `frontend/src/features/containers/pages/fleet-overview.tsx` | Infrastructure page: regroup toolbars, wire `examples`/`autoFocus`, add K8s search + filter, `hideSearch` on all tables | Modify |
| `frontend/src/features/containers/pages/fleet-overview.test.tsx` | Page integration tests | Modify |

No new dependencies. No backend/API changes.

---

## Task 1: Upgrade `FleetSearch` with example chips, autofocus, and Escape-to-blur

**Files:**
- Modify: `frontend/src/features/containers/components/fleet/fleet-search.tsx`
- Test: `frontend/src/features/containers/components/fleet/fleet-search.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append these tests inside the existing `describe('FleetSearch', ...)` block in `fleet-search.test.tsx` (before its closing `});`):

```tsx
  it('renders example chips when examples provided and field is empty', () => {
    renderSearch({ examples: ['name:prod', 'status:up'] });
    expect(screen.getByRole('group', { name: /example searches/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'name:prod' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'status:up' })).toBeInTheDocument();
  });

  it('hides example chips once a query is typed', () => {
    renderSearch({ examples: ['name:prod'] });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x' } });
    expect(screen.queryByRole('button', { name: 'name:prod' })).not.toBeInTheDocument();
  });

  it('does not render the example group when no examples are given', () => {
    renderSearch();
    expect(screen.queryByRole('group', { name: /example searches/i })).not.toBeInTheDocument();
  });

  it('clicking an example chip fills the query and calls onSearch immediately', () => {
    const { onSearch } = renderSearch({ examples: ['status:up'] });
    fireEvent.click(screen.getByRole('button', { name: 'status:up' }));
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('status:up');
    // Immediate (not debounced): assert before advancing timers.
    expect(onSearch).toHaveBeenCalledWith('status:up');
  });

  it('focuses the input on mount when autoFocus is set', () => {
    renderSearch({ autoFocus: true });
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });

  it('does not focus the input on mount by default', () => {
    renderSearch();
    expect(document.activeElement).not.toBe(screen.getByRole('textbox'));
  });

  it('Escape clears the query and blurs the input', () => {
    const { onSearch } = renderSearch();
    const input = screen.getByRole('textbox');
    input.focus();
    fireEvent.change(input, { target: { value: 'test' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect((input as HTMLInputElement).value).toBe('');
    expect(onSearch).toHaveBeenCalledWith('');
    expect(document.activeElement).not.toBe(input);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/containers/components/fleet/fleet-search.test.tsx`
Expected: FAIL — the new tests error (e.g. "Unable to find role group", `examples`/`autoFocus` have no effect, Escape does not blur).

- [ ] **Step 3: Replace the component implementation**

Replace the entire contents of `frontend/src/features/containers/components/fleet/fleet-search.tsx` with:

```tsx
import { useState, useCallback, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

export interface FleetSearchProps {
  onSearch: (query: string) => void;
  totalCount: number;
  filteredCount: number;
  placeholder?: string;
  label: string;
  /** Example query chips shown inside the field while it is empty. */
  examples?: string[];
  /** Focus the input on mount (e.g. when the page first opens). */
  autoFocus?: boolean;
}

export function FleetSearch({
  onSearch,
  totalCount,
  filteredCount,
  placeholder = 'Search...',
  label,
  examples,
  autoFocus = false,
}: FleetSearchProps) {
  const [query, setQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const dispatchSearch = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onSearch(value);
      }, 300);
    },
    [onSearch],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setQuery(value);
      dispatchSearch(value);
    },
    [dispatchSearch],
  );

  const handleClear = useCallback(() => {
    setQuery('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    onSearch('');
  }, [onSearch]);

  const handleExampleClick = useCallback(
    (value: string) => {
      setQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      onSearch(value);
      inputRef.current?.focus();
    },
    [onSearch],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        handleClear();
        // Exit the field on Escape so keyboard users can leave the search.
        inputRef.current?.blur();
      }
    },
    [handleClear],
  );

  const isFiltered = query.length > 0 && filteredCount !== totalCount;
  const showExamples = !query && !!examples && examples.length > 0;

  return (
    <div className="flex items-center gap-3">
      <div className="relative flex-1">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
          <Search className="h-4 w-4 text-muted-foreground" />
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={cn(
            'w-full rounded-xl border bg-card/80 py-3 pl-11 pr-9 text-sm backdrop-blur-sm',
            'placeholder:text-muted-foreground/50',
            'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50',
            'transition-all duration-200',
            // While example chips overlay the empty field, hide the placeholder
            // text (kept in the DOM for a11y/tests) so the two don't collide.
            showExamples && 'placeholder:text-transparent',
          )}
          aria-label={label}
        />
        {showExamples && (
          <div
            role="group"
            aria-label="Example searches"
            onClick={(e) => {
              // A click on the empty strip (not a chip) focuses the input.
              if (e.target === e.currentTarget) {
                inputRef.current?.focus();
              }
            }}
            className="absolute inset-y-0 left-11 right-3 flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {examples.map((ex, i) => (
              <button
                key={ex}
                type="button"
                onClick={() => handleExampleClick(ex)}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-border/60 bg-card/80 px-2 py-0.5 text-xs font-medium',
                  'text-muted-foreground backdrop-blur-sm transition-colors duration-200',
                  'hover:bg-primary/10 hover:text-primary hover:border-primary/30',
                  // Right-align the chip row: ml-auto on the first chip absorbs
                  // free space so chips sit right when they fit, and collapse to
                  // a left-aligned scrollable row when they overflow.
                  i === 0 && 'ml-auto',
                )}
              >
                {ex}
              </button>
            ))}
          </div>
        )}
        {query && (
          <button
            onClick={handleClear}
            className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {isFiltered && (
        <span className="shrink-0 text-sm text-muted-foreground" data-testid="fleet-search-count">
          {filteredCount} of {totalCount}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/containers/components/fleet/fleet-search.test.tsx`
Expected: PASS — all original + 7 new tests green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/containers/components/fleet/fleet-search.tsx frontend/src/features/containers/components/fleet/fleet-search.test.tsx
git commit -m "feat(fleet-search): add example chips, autoFocus, and Escape-to-blur"
```

---

## Task 2: K8s search filter module

**Files:**
- Create: `frontend/src/features/containers/lib/k8s-search-filter.ts`
- Test: `frontend/src/features/containers/lib/k8s-search-filter.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/features/containers/lib/k8s-search-filter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseK8sQuery, filterK8sResources } from './k8s-search-filter';

const items = [
  { name: 'nginx-abc', namespace: 'default', status: 'Running' },
  { name: 'redis-xyz', namespace: 'cache', status: 'Pending' },
  { name: 'nginx-old', namespace: 'kube-system', status: 'Running' },
  { name: 'api-svc', namespace: 'default' }, // no status (e.g. a service)
];

describe('parseK8sQuery', () => {
  it('returns an empty object for a blank query', () => {
    expect(parseK8sQuery('   ')).toEqual({});
  });

  it('extracts namespace and status tokens and free text', () => {
    expect(parseK8sQuery('namespace:default status:running nginx')).toEqual({
      namespace: 'default',
      status: 'running',
      text: 'nginx',
    });
  });

  it('treats bare words as free text (joined)', () => {
    expect(parseK8sQuery('nginx web')).toEqual({ text: 'nginx web' });
  });

  it('ignores field tokens with an empty value', () => {
    expect(parseK8sQuery('namespace: nginx')).toEqual({ text: 'nginx' });
  });
});

describe('filterK8sResources', () => {
  it('returns all items for a blank query', () => {
    expect(filterK8sResources(items, '  ')).toHaveLength(4);
  });

  it('matches free text against the name (case-insensitive substring)', () => {
    const r = filterK8sResources(items, 'NGINX');
    expect(r.map((i) => i.name)).toEqual(['nginx-abc', 'nginx-old']);
  });

  it('matches namespace exactly (case-insensitive)', () => {
    const r = filterK8sResources(items, 'namespace:DEFAULT');
    expect(r.map((i) => i.name)).toEqual(['nginx-abc', 'api-svc']);
  });

  it('matches status as a case-insensitive substring', () => {
    const r = filterK8sResources(items, 'status:running');
    expect(r.map((i) => i.name)).toEqual(['nginx-abc', 'nginx-old']);
  });

  it('excludes resources without a status when a status token is given', () => {
    const r = filterK8sResources(items, 'status:running');
    expect(r.some((i) => i.name === 'api-svc')).toBe(false);
  });

  it('combines tokens with AND', () => {
    const r = filterK8sResources(items, 'namespace:kube-system nginx');
    expect(r.map((i) => i.name)).toEqual(['nginx-old']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/features/containers/lib/k8s-search-filter.test.ts`
Expected: FAIL — cannot resolve `./k8s-search-filter`.

- [ ] **Step 3: Create the implementation**

Create `frontend/src/features/containers/lib/k8s-search-filter.ts`:

```ts
/**
 * Smart-search filter for Kubernetes resource lists (pods, deployments,
 * services) shown on the Infrastructure page. Supports `namespace:` and
 * `status:` field tokens plus free-text matched against the resource name.
 * Resources without a `status` field (e.g. services) never match a `status:`
 * token, which is the intended behavior.
 */
export interface K8sSearchableResource {
  name: string;
  namespace?: string;
  status?: string;
}

export interface ParsedK8sQuery {
  namespace?: string;
  status?: string;
  text?: string;
}

export function parseK8sQuery(query: string): ParsedK8sQuery {
  const parsed: ParsedK8sQuery = {};
  const freeText: string[] = [];

  for (const token of query.trim().split(/\s+/).filter(Boolean)) {
    const match = /^(namespace|status):(.*)$/i.exec(token);
    if (match) {
      const value = match[2].toLowerCase();
      if (!value) continue;
      if (match[1].toLowerCase() === 'namespace') parsed.namespace = value;
      else parsed.status = value;
    } else {
      freeText.push(token.toLowerCase());
    }
  }

  if (freeText.length > 0) parsed.text = freeText.join(' ');
  return parsed;
}

export function filterK8sResources<T extends K8sSearchableResource>(
  items: T[],
  query: string,
): T[] {
  const { namespace, status, text } = parseK8sQuery(query);
  if (!namespace && !status && !text) return items;

  return items.filter((item) => {
    if (namespace && (item.namespace ?? '').toLowerCase() !== namespace) return false;
    if (status) {
      if (item.status === undefined) return false;
      if (!item.status.toLowerCase().includes(status)) return false;
    }
    if (text && !item.name.toLowerCase().includes(text)) return false;
    return true;
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/features/containers/lib/k8s-search-filter.test.ts`
Expected: PASS — all 11 tests green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/containers/lib/k8s-search-filter.ts frontend/src/features/containers/lib/k8s-search-filter.test.ts
git commit -m "feat(infrastructure): add k8s resource search filter"
```

---

## Task 3: Fleet tab — regroup toolbar, wire examples + autoFocus, drop table search

**Files:**
- Modify: `frontend/src/features/containers/pages/fleet-overview.tsx` (Fleet tab JSX, ~`:894`–`:1050`)
- Test: `frontend/src/features/containers/pages/fleet-overview.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append a new describe block at the end of `fleet-overview.test.tsx` (before the file's final close). It reuses the existing `mockEndpoints`/`mockStacks`/`renderPage`/`makeEndpoint` helpers:

```tsx
describe('Infrastructure smart search — Fleet tab', () => {
  beforeEach(() => {
    useUiStore.setState({} as any, false); // no-op guard; keeps store import used
    mockStacks([]);
  });

  it('renders endpoint example chips inside the search bar', () => {
    mockEndpoints([makeEndpoint({ id: 1, name: 'prod-1' }), makeEndpoint({ id: 2, name: 'prod-2', status: 'down' })]);
    renderPage();
    expect(screen.getByRole('button', { name: 'name:prod' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'status:up' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'type:edge' })).toBeInTheDocument();
  });

  it('shows only one search input in Fleet table view (no DataTable search box)', () => {
    mockEndpoints([makeEndpoint({ id: 1, name: 'prod-1' }), makeEndpoint({ id: 2, name: 'prod-2' })]);
    renderPage();
    fireEvent.click(screen.getByTitle('Table view'));
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });
});
```

> Note: the existing top-of-file `beforeEach` already resets mocks; `useUiStore` is already imported at the top of the file. If a lint "unused import" arises, remove the no-op line and instead keep the existing default mock setup.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/containers/pages/fleet-overview.test.tsx -t "Fleet tab"`
Expected: FAIL — chip buttons not found; table view shows 2 textboxes (FleetSearch + DataTable search).

- [ ] **Step 3: Regroup the Fleet toolbar and wire the new props**

In `fleet-overview.tsx`, replace the Fleet tab block that currently spans the toolbar row, the filter-chip bar, and the standalone search (the JSX from the opening `<section aria-labelledby="fleet-heading" ...>` down to the end of the `{/* Endpoint search */}` block) with the following. Concretely, replace this current code:

```tsx
      <section aria-labelledby="fleet-heading" className="space-y-4">
        <h2 id="fleet-heading" className="sr-only">Fleet Overview</h2>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {!isLoading && endpoints && (
            <div className="flex flex-wrap items-center gap-3">
              {/* Endpoint status filter */}
              {endpointStatusOptions.length > 2 && (
```

…through the end of the endpoint-search block:

```tsx
        {/* Endpoint search */}
        {!isLoading && endpoints && endpoints.length > 0 && (
          <FleetSearch
            onSearch={handleEndpointSearch}
            totalCount={endpoints.length}
            filteredCount={filteredEndpoints.length}
            placeholder="Search endpoints... (name:prod status:up type:edge)"
            label="Search endpoints"
          />
        )}
```

with this new version (search bar moves into a shared toolbar row with the dropdowns/count/view-toggle; the filter-chip bar stays below):

```tsx
      <section aria-labelledby="fleet-heading" className="space-y-4">
        <h2 id="fleet-heading" className="sr-only">Fleet Overview</h2>
        {!isLoading && endpoints && endpoints.length > 0 && (
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
            <div className="lg:flex-1">
              <FleetSearch
                onSearch={handleEndpointSearch}
                totalCount={endpoints.length}
                filteredCount={filteredEndpoints.length}
                placeholder="Search endpoints... (name:prod status:up type:edge)"
                label="Search endpoints"
                examples={['name:prod', 'status:up', 'type:edge']}
                autoFocus
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {/* Endpoint status filter */}
              {endpointStatusOptions.length > 2 && (
                <div className="flex items-center gap-1.5">
                  <label htmlFor="endpoint-status-filter" className="text-xs text-muted-foreground">Status</label>
                  <ThemedSelect
                    id="endpoint-status-filter"
                    value={endpointStatusFilter}
                    onValueChange={setEndpointStatusFilter}
                    options={endpointStatusOptions}
                    className="w-[150px]"
                  />
                </div>
              )}
              {/* Endpoint type filter (only if multiple types) */}
              {endpointTypeOptions.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <label htmlFor="endpoint-type-filter" className="text-xs text-muted-foreground">Type</label>
                  <ThemedSelect
                    id="endpoint-type-filter"
                    value={endpointTypeFilter}
                    onValueChange={setEndpointTypeFilter}
                    options={endpointTypeOptions}
                    className="w-[170px]"
                  />
                </div>
              )}
              <span className="text-sm text-muted-foreground" data-testid="fleet-filtered-count">
                {filteredEndpoints.length}{filteredEndpoints.length !== (endpoints?.length ?? 0) ? ` of ${endpoints?.length}` : ''} endpoint{filteredEndpoints.length !== 1 ? 's' : ''}
              </span>
              <div className="flex items-center rounded-lg border p-1">
                <button
                  onClick={() => setFleetViewMode('grid')}
                  className={cn(
                    'inline-flex items-center justify-center rounded-md p-2 transition-colors',
                    fleetViewMode === 'grid'
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  title="Grid view"
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setFleetViewMode('table')}
                  className={cn(
                    'inline-flex items-center justify-center rounded-md p-2 transition-colors',
                    fleetViewMode === 'table'
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  title="Table view"
                >
                  <List className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Endpoint filter chips */}
        {!isLoading && hasActiveEndpointFilter && (
          <FilterChipBar
            filters={activeEndpointFilters}
            onRemove={handleRemoveEndpointFilter}
            onClearAll={handleClearAllEndpointFilters}
          />
        )}
```

- [ ] **Step 4: Drop the Fleet table's built-in search**

In the same file, in the Fleet `fleetViewMode === 'table'` branch, replace:

```tsx
            <DataTable
              columns={endpointColumns}
              data={filteredEndpoints}
              searchKey="name"
              searchPlaceholder="Search endpoints..."
              autoFit
              onRowClick={(row) => handleEndpointClick(row.id)}
            />
```

with:

```tsx
            <DataTable
              columns={endpointColumns}
              data={filteredEndpoints}
              hideSearch
              autoFit
              onRowClick={(row) => handleEndpointClick(row.id)}
            />
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/containers/pages/fleet-overview.test.tsx`
Expected: PASS — new Fleet-tab tests green AND all pre-existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/containers/pages/fleet-overview.tsx frontend/src/features/containers/pages/fleet-overview.test.tsx
git commit -m "feat(infrastructure): regroup Fleet toolbar with smart search, drop table search"
```

---

## Task 4: Stacks tab — regroup toolbar, wire examples, drop table search

**Files:**
- Modify: `frontend/src/features/containers/pages/fleet-overview.tsx` (Stacks tab JSX, ~`:1054`–`:1216`)
- Test: `frontend/src/features/containers/pages/fleet-overview.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append a new describe block at the end of `fleet-overview.test.tsx`:

```tsx
describe('Infrastructure smart search — Stacks tab', () => {
  beforeEach(() => {
    mockEndpoints([makeEndpoint({ id: 1, name: 'prod-1' })]);
    mockStacks([makeStack({ id: 1, name: 'traefik' }), makeStack({ id: 2, name: 'grafana' })]);
  });

  it('renders stack example chips inside the search bar', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('tab-stacks'));
    expect(screen.getByRole('button', { name: 'name:traefik' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'status:active' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'endpoint:prod' })).toBeInTheDocument();
  });

  it('shows only one search input in Stacks table view', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('tab-stacks'));
    fireEvent.click(screen.getByTitle('Table view'));
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/containers/pages/fleet-overview.test.tsx -t "Stacks tab"`
Expected: FAIL — chips not found; table view shows 2 textboxes.

- [ ] **Step 3: Regroup the Stacks toolbar and wire examples**

In `fleet-overview.tsx`, in the Stacks tab, replace the current toolbar wrapper, the controls block, and the standalone stack-search block. Replace this current code:

```tsx
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            {stackEndpointFilterParam !== ALL_FILTER && (
```

…down through the end of the stack-search block:

```tsx
        {/* Stack search */}
        {!isLoading && dropdownFilteredStacks.length > 0 && (
          <FleetSearch
            onSearch={setStackSearchQuery}
            totalCount={dropdownFilteredStacks.length}
            filteredCount={filteredStacks.length}
            placeholder="Search stacks... (name:traefik status:active endpoint:prod)"
            label="Search stacks"
          />
        )}
```

with this new version (the endpoint pill keeps its own row; the search bar joins the dropdowns/count/view-toggle in one toolbar row; the chip bar stays below):

```tsx
        <div className="flex items-center gap-2">
          {stackEndpointFilterParam !== ALL_FILTER && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
              {endpoints?.find(ep => ep.id === Number(stackEndpointFilterParam))?.name ?? `Endpoint ${stackEndpointFilterParam}`}
              <button
                onClick={() => setStackEndpointFilter(ALL_FILTER)}
                className="ml-0.5 rounded-full hover:bg-primary/20"
                aria-label="Clear endpoint filter"
                data-testid="clear-stack-filter"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
        </div>
        {!isLoading && stacksWithEndpoints.length > 0 && (
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
            {dropdownFilteredStacks.length > 0 && (
              <div className="lg:flex-1">
                <FleetSearch
                  onSearch={setStackSearchQuery}
                  totalCount={dropdownFilteredStacks.length}
                  filteredCount={filteredStacks.length}
                  placeholder="Search stacks... (name:traefik status:active endpoint:prod)"
                  label="Search stacks"
                  examples={['name:traefik', 'status:active', 'endpoint:prod']}
                />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              {/* Stack status filter */}
              {stackStatusOptions.length > 2 && (
                <div className="flex items-center gap-1.5">
                  <label htmlFor="stack-status-filter" className="text-xs text-muted-foreground">Status</label>
                  <ThemedSelect
                    id="stack-status-filter"
                    value={stackStatusFilter}
                    onValueChange={setStackStatusFilter}
                    options={stackStatusOptions}
                    className="w-[160px]"
                  />
                </div>
              )}
              {/* Stack endpoint filter (only if multiple endpoints have stacks) */}
              {stackEndpointOptions.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <label htmlFor="stack-endpoint-filter" className="text-xs text-muted-foreground">Endpoint</label>
                  <ThemedSelect
                    id="stack-endpoint-filter"
                    value={stackEndpointFilterParam}
                    onValueChange={setStackEndpointFilter}
                    options={stackEndpointOptions}
                    className="w-[180px]"
                  />
                </div>
              )}
              <span className="text-sm text-muted-foreground" data-testid="stacks-filtered-count">
                {filteredStacks.length}{hasActiveStackFilter ? ` of ${stacksWithEndpoints.length}` : ''} stack{filteredStacks.length !== 1 ? 's' : ''}
              </span>
              <div className="flex items-center rounded-lg border p-1">
                <button
                  onClick={() => setStacksViewMode('grid')}
                  className={cn(
                    'inline-flex items-center justify-center rounded-md p-2 transition-colors',
                    stacksViewMode === 'grid'
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  title="Grid view"
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setStacksViewMode('table')}
                  className={cn(
                    'inline-flex items-center justify-center rounded-md p-2 transition-colors',
                    stacksViewMode === 'table'
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  title="Table view"
                >
                  <List className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Stack filter chips */}
        {!isLoading && hasActiveStackFilter && (
          <FilterChipBar
            filters={activeStackFilters}
            onRemove={handleRemoveStackFilter}
            onClearAll={handleClearAllStackFilters}
          />
        )}
```

- [ ] **Step 4: Drop the Stacks table's built-in search**

In the Stacks `stacksViewMode` table branch, replace:

```tsx
            <DataTable
              columns={stackColumns}
              data={filteredStacks}
              searchKey="name"
              searchPlaceholder="Search stacks..."
              autoFit
              onRowClick={handleStackClick}
            />
```

with:

```tsx
            <DataTable
              columns={stackColumns}
              data={filteredStacks}
              hideSearch
              autoFit
              onRowClick={handleStackClick}
            />
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/containers/pages/fleet-overview.test.tsx`
Expected: PASS — Stacks-tab tests green, all prior tests still pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/containers/pages/fleet-overview.tsx frontend/src/features/containers/pages/fleet-overview.test.tsx
git commit -m "feat(infrastructure): regroup Stacks toolbar with smart search, drop table search"
```

---

## Task 5: Kubernetes tab — add smart search, wire filter, drop per-table search

**Files:**
- Modify: `frontend/src/features/containers/pages/fleet-overview.tsx` (imports, K8s state/memos near `:289`–`:328`, K8s tab JSX `:1220`–`:1301`)
- Test: `frontend/src/features/containers/pages/fleet-overview.test.tsx`

- [ ] **Step 1: Write the failing tests**

The page test does not yet mock the Kubernetes hooks. Add this mock alongside the other `vi.mock(...)` calls at the top of `fleet-overview.test.tsx` (after the `use-stacks` mock at line 19):

```tsx
vi.mock('@/features/kubernetes/hooks/use-kubernetes', () => ({
  useK8sPods: vi.fn(() => ({ data: [], isLoading: false, refetch: vi.fn(), isFetching: false })),
  useK8sDeployments: vi.fn(() => ({ data: [], isLoading: false })),
  useK8sServices: vi.fn(() => ({ data: [], isLoading: false })),
  useK8sNamespaces: vi.fn(() => ({ data: [] })),
}));
```

Add this import with the other hook imports near line 38:

```tsx
import { useK8sPods } from '@/features/kubernetes/hooks/use-kubernetes';
```

Then append a new describe block at the end of the file:

```tsx
describe('Infrastructure smart search — Kubernetes tab', () => {
  const pod = (name: string, namespace: string, status: string) => ({
    id: `${namespace}/${name}`, name, namespace, images: [], state: 'running',
    status, restarts: 0, created: 0, endpointId: 1, endpointName: 'prod-1',
    labels: {}, containers: [], resourceType: 'pod',
  });

  beforeEach(() => {
    mockEndpoints([makeEndpoint({ id: 1, name: 'prod-1' })]);
    mockStacks([]);
    vi.mocked(useK8sPods).mockReturnValue({
      data: [pod('nginx-1', 'default', 'Running'), pod('redis-1', 'cache', 'Pending')],
      isLoading: false, refetch: vi.fn(), isFetching: false,
    } as any);
  });

  it('renders a Kubernetes search bar with example chips', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('tab-kubernetes'));
    expect(screen.getByRole('textbox', { name: /search kubernetes resources/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'namespace:kube-system' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'status:running' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'nginx' })).toBeInTheDocument();
  });

  it('filters the pods table by the search query', async () => {
    renderPage();
    fireEvent.click(screen.getByTestId('tab-kubernetes'));
    expect(screen.getByText('nginx-1')).toBeInTheDocument();
    expect(screen.getByText('redis-1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'nginx' }));

    await waitFor(() => {
      expect(screen.queryByText('redis-1')).not.toBeInTheDocument();
    });
    expect(screen.getByText('nginx-1')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/containers/pages/fleet-overview.test.tsx -t "Kubernetes tab"`
Expected: FAIL — no K8s search textbox / chips; both pods still shown after clicking the chip.

- [ ] **Step 3: Add the filter import**

In `fleet-overview.tsx`, add this import near the other `lib` imports (top of file):

```tsx
import { filterK8sResources } from '@/features/containers/lib/k8s-search-filter';
```

- [ ] **Step 4: Add K8s search state and filtered memos**

In `fleet-overview.tsx`, just after the K8s hook destructuring (the `useK8sNamespaces()` block ending around line 328), add:

```tsx
  const [k8sSearchQuery, setK8sSearchQuery] = useState('');
  const filteredK8sPods = useMemo(
    () => filterK8sResources(k8sPods ?? [], k8sSearchQuery),
    [k8sPods, k8sSearchQuery],
  );
  const filteredK8sDeployments = useMemo(
    () => filterK8sResources(k8sDeployments ?? [], k8sSearchQuery),
    [k8sDeployments, k8sSearchQuery],
  );
  const filteredK8sServices = useMemo(
    () => filterK8sResources(k8sServices ?? [], k8sSearchQuery),
    [k8sServices, k8sSearchQuery],
  );
  const k8sTotalCount =
    (k8sPods?.length ?? 0) + (k8sDeployments?.length ?? 0) + (k8sServices?.length ?? 0);
  const k8sFilteredCount =
    filteredK8sPods.length + filteredK8sDeployments.length + filteredK8sServices.length;
```

- [ ] **Step 5: Insert the K8s search bar after the summary bar**

In the Kubernetes tab JSX, immediately after the closing of the `{/* K8s summary bar */}` `</SpotlightCard>` and before the `{/* Pods table */}` block, insert:

```tsx
        {/* K8s smart search */}
        {!k8sPodsLoading && k8sTotalCount > 0 && (
          <FleetSearch
            onSearch={setK8sSearchQuery}
            totalCount={k8sTotalCount}
            filteredCount={k8sFilteredCount}
            placeholder="Search resources... (namespace:kube-system status:running nginx)"
            label="Search Kubernetes resources"
            examples={['namespace:kube-system', 'status:running', 'nginx']}
          />
        )}
```

- [ ] **Step 6: Point the three tables at filtered data and hide their search**

In the Kubernetes tab, replace the Pods `DataTable`:

```tsx
            <DataTable
              columns={k8sPodColumns}
              data={k8sPods ?? []}
              searchKey="name"
              searchPlaceholder="Search pods..."
              pageSize={15}
            />
```

with:

```tsx
            <DataTable
              columns={k8sPodColumns}
              data={filteredK8sPods}
              hideSearch
              pageSize={15}
            />
```

Replace the Deployments `DataTable`:

```tsx
            <DataTable
              columns={k8sDeploymentColumns}
              data={k8sDeployments}
              searchKey="name"
              searchPlaceholder="Search deployments..."
              pageSize={15}
            />
```

with:

```tsx
            <DataTable
              columns={k8sDeploymentColumns}
              data={filteredK8sDeployments}
              hideSearch
              pageSize={15}
            />
```

Replace the Services `DataTable`:

```tsx
            <DataTable
              columns={k8sServiceColumns}
              data={k8sServices}
              searchKey="name"
              searchPlaceholder="Search services..."
              pageSize={15}
            />
```

with:

```tsx
            <DataTable
              columns={k8sServiceColumns}
              data={filteredK8sServices}
              hideSearch
              pageSize={15}
            />
```

> The deployments/services sections keep their existing `k8sDeployments && k8sDeployments.length > 0` (and services equivalent) render guards — those gate on the *unfiltered* presence of data so a section doesn't vanish mid-search; the filtered arrays only affect the rows shown.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/containers/pages/fleet-overview.test.tsx`
Expected: PASS — Kubernetes-tab tests green, all prior tests still pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/containers/pages/fleet-overview.tsx frontend/src/features/containers/pages/fleet-overview.test.tsx
git commit -m "feat(infrastructure): add smart search to Kubernetes tab"
```

---

## Task 6: Full verification and docs

**Files:**
- Modify: `docs/superpowers/specs/2026-05-30-infrastructure-smart-search-design.md` (mark status done) — optional

- [ ] **Step 1: Typecheck the frontend workspace**

Run: `npm run typecheck -w frontend`
Expected: no errors. (Common issue: `filterK8sResources(k8sDeployments ?? [], ...)` — `K8sDeployment` has no `status` field, which is fine because `K8sSearchableResource.status` is optional; if TS complains about excess/missing properties, confirm the generic constraint reads `status?: string`.)

- [ ] **Step 2: Lint the frontend workspace**

Run: `npm run lint -w frontend`
Expected: no errors for the changed files. Fix any unused-import or formatting issues inline.

- [ ] **Step 3: Run the full frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: all tests pass (baseline was green; the 4 touched files now include the new cases).

- [ ] **Step 4: Update the spec status (optional)**

Edit the `**Status:**` line of the spec to `Implemented`.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore(infrastructure): verify smart-search build, mark spec implemented"
```

- [ ] **Step 6: Hand back for review**

Report the diff summary and suggest the requesting-code-review skill / opening a PR (`feature/infrastructure-smart-search` → `dev`). Rename the branch from `worktree-feature+infrastructure-smart-search` to `feature/infrastructure-smart-search` before pushing if a PR is desired.

---

## Self-Review

**Spec coverage:**
- One smart bar per tab, WE-style + chips → Task 1 (component) + Tasks 3/4/5 (wiring `examples`).
- Remove redundant DataTable search → `hideSearch` in Tasks 3 (fleet), 4 (stacks), 5 (3× k8s).
- Regroup filters onto the search toolbar → Tasks 3 & 4 (single `lg:flex-row` toolbar).
- K8s smart search across pods/deployments/services → Task 2 (filter) + Task 5 (wiring, combined count).
- Autofocus like Workload Explorer → Task 1 (`autoFocus` prop) + Task 3 (applied to the default Fleet tab only, to avoid focus-steal on tab switches).
- Escape-to-blur → Task 1.
- Tests for all → Tasks 1, 2, 3, 4, 5; full-suite gate in Task 6.

**Placeholder scan:** No TBD/TODO; every code step shows full code; every run step shows the exact command and expected result.

**Type consistency:** `FleetSearchProps` adds `examples?: string[]` and `autoFocus?: boolean` (Task 1) and they're passed in Tasks 3/4/5. `filterK8sResources<T extends K8sSearchableResource>` / `parseK8sQuery` names match between Task 2 definition and Task 5 usage. `hideSearch` is the real `DataTableProps` prop (verified in `data-table.tsx:74`). K8s hook/type names (`useK8sPods`, `K8sPod`, fields `name`/`namespace`/`status`) match `use-kubernetes.ts`.
