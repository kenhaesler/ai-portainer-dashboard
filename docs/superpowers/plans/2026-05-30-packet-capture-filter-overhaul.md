# Packet Capture Filter Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Packet Capture page's forced Endpoint → Stack → Container cascade with a search-first, cross-endpoint container picker (type a name, or `stack:`/`endpoint:`), add capture-history search, and add BPF filter presets.

**Architecture:** Reuse the existing `filterContainers()` parser and `cmdk` to build a small `CaptureTargetPicker` that filters the full cross-endpoint running-container list client-side, grouped by endpoint, with edge-async endpoints disabled. Extract `BpfFilterInput` for the presets and a `CaptureBrowseFallback` for the optional dropdown path. Add an optional `search` param to the captures list API (parameterized SQL). The 667-line page becomes an orchestrator composing these focused, independently tested components.

**Tech Stack:** React 19 + TypeScript, `cmdk`, TanStack Query, Tailwind, Vitest + Testing Library (frontend, jsdom); Fastify 5 + Zod + PostgreSQL, Vitest (backend — pcap suites mock the store/service, no live DB).

**Spec:** `docs/superpowers/specs/2026-05-30-packet-capture-filter-overhaul-design.md`

**Working directory:** worktree `.claude/worktrees/feature+packet-capture-filter-overhaul` on branch `worktree-feature+packet-capture-filter-overhaul`. Run all commands from the worktree root.

### Ground-truth facts (verified against the code — do not "fix" these)
- `CaptureListQuerySchema` is **already exported** from `packages/security/src/models/pcap.ts` (line ~88) and **already imported** by `packages/security/src/routes/pcap.ts` (line 7). There is **no inline duplicate** to remove.
- `packages/security/src/services/pcap-store.ts` `getCaptures` uses **`?` placeholders** (a `db()` wrapper translates them), e.g. `conditions.push('status = ?')`. The DB is PostgreSQL (so `ILIKE` is available), but **never** use `$1`/`$n` here.
- `pcap-service.test.ts` **mocks `pcap-store`**; `pcap-route.test.ts` **mocks `pcap-service`**. Follow that: test plumbing with mocks, not a live DB.
- `useCaptures` (`frontend/src/features/security/hooks/use-pcap.ts`, lines 46–74) calls `api.get<CapturesResponse>('/api/pcap/captures', { params })` with a `params` **object** (not a query string in the path), and contains a dead first `useQuery` plus a returned second one. Add `search` to the params object(s).
- The page test (`packet-capture.test.tsx`) mocks `useContainers` with container objects that are **missing** `image`, `status`, `endpointName`, `ports`, `networks` — `filterContainers` reads those, so the mock data must be enriched (Task 7).

---

## Task 0: Verify clean baseline

**Files:** none

- [ ] **Step 1: Run the existing security + packet-capture tests to confirm green start**

Run:
```bash
cd packages/security && npx vitest run src/__tests__/pcap-route.test.ts src/__tests__/pcap-model.test.ts src/__tests__/pcap-service.test.ts
cd ../../frontend && npx vitest run src/features/security/pages/packet-capture.test.tsx
```
Expected: PASS. If anything fails before changes, stop and report — do not proceed.

---

## Task 1: Add `search` to the captures-list query schema (backend)

**Files:**
- Modify: `packages/security/src/models/pcap.ts` (add `search` to the existing exported `CaptureListQuerySchema`)
- Test: `packages/security/src/__tests__/pcap-model.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/security/src/__tests__/pcap-model.test.ts` (the file already imports from `../models/pcap.js`; reuse that import style):
```ts
import { CaptureListQuerySchema } from '../models/pcap.js';

describe('CaptureListQuerySchema search', () => {
  it('accepts an optional search string', () => {
    expect(CaptureListQuerySchema.parse({ search: 'web' }).search).toBe('web');
  });
  it('defaults search to undefined when absent', () => {
    expect(CaptureListQuerySchema.parse({}).search).toBeUndefined();
  });
  it('rejects an over-long search string', () => {
    expect(() => CaptureListQuerySchema.parse({ search: 'x'.repeat(201) })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/security && npx vitest run src/__tests__/pcap-model.test.ts -t "search"`
Expected: FAIL — `search` is stripped/undefined (and over-long does not throw).

- [ ] **Step 3: Add the field**

In `packages/security/src/models/pcap.ts`, inside the existing `export const CaptureListQuerySchema = z.object({ ... })`, add the `search` line after `containerId`:
```ts
export const CaptureListQuerySchema = z.object({
  status: CaptureStatusSchema.optional(),
  containerId: z.string().optional(),
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/security && npx vitest run src/__tests__/pcap-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/security/src/models/pcap.ts packages/security/src/__tests__/pcap-model.test.ts
git commit -m "feat(pcap): add optional search to capture list query schema"
```

---

## Task 2: Apply `search` as a parameterized SQL filter (backend store + service)

**Files:**
- Modify: `packages/security/src/services/pcap-store.ts` (`GetCapturesOptions` + `getCaptures`)
- Modify: `packages/security/src/services/pcap-service.ts` (`listCaptures` options type)
- Test: `packages/security/src/__tests__/pcap-service.test.ts` (mocks the store — assert passthrough)

- [ ] **Step 1: Write the failing test**

Add to the `describe('listCaptures', ...)` block in `packages/security/src/__tests__/pcap-service.test.ts`:
```ts
it('passes search through to getCaptures', async () => {
  vi.mocked(store.getCaptures).mockResolvedValue([]);
  await listCaptures({ search: 'web' });
  expect(store.getCaptures).toHaveBeenCalledWith({ search: 'web' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/security && npx vitest run src/__tests__/pcap-service.test.ts -t "search"`
Expected: FAIL — TypeScript error / `listCaptures` rejects `search` (its options type lacks it).

- [ ] **Step 3: Add `search` to the service options type**

In `packages/security/src/services/pcap-service.ts`, update `listCaptures`:
```ts
export async function listCaptures(options?: {
  status?: CaptureStatus;
  containerId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<Capture[]> {
  return getCaptures(options);
}
```

- [ ] **Step 4: Add `search` to the store options + SQL (parameterized, `?` placeholders)**

In `packages/security/src/services/pcap-store.ts`:
1. Extend the options interface:
```ts
export interface GetCapturesOptions {
  status?: CaptureStatus;
  containerId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}
```
2. In `getCaptures`, after the `containerId` condition block (before `const where = ...`), add:
```ts
  if (options.search) {
    conditions.push("(container_name ILIKE ? OR COALESCE(filter, '') ILIKE ?)");
    params.push(`%${options.search}%`, `%${options.search}%`);
  }
```
(Use `?` placeholders to match the existing style — two `?`, so push the pattern twice. No string concatenation of user input.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/security && npx vitest run src/__tests__/pcap-service.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/security/src/services/pcap-store.ts packages/security/src/services/pcap-service.ts packages/security/src/__tests__/pcap-service.test.ts
git commit -m "feat(pcap): filter captures by parameterized search (name + filter text)"
```

---

## Task 3: Route passes `search` through (backend route test)

The route test mocks `pcap-service`. Verify the Zod schema accepts `?search=` and the parsed value reaches `listCaptures`.

**Files:**
- Test: `packages/security/src/__tests__/pcap-route.test.ts`

- [ ] **Step 1: Write the failing test**

Add an `it()` mirroring the existing `'lists captures'` test (which uses the file's `buildApp()` helper and `vi.mocked(pcapService.listCaptures)`):
```ts
it('passes search from the query string to listCaptures', async () => {
  vi.mocked(pcapService.listCaptures).mockResolvedValue([]);
  const app = await buildApp('admin');
  const res = await app.inject({ method: 'GET', url: '/api/pcap/captures?search=web' });
  expect(res.statusCode).toBe(200);
  expect(pcapService.listCaptures).toHaveBeenCalledWith(expect.objectContaining({ search: 'web' }));
  await app.close();
});
```
> Match the exact app-build/inject idiom used by the existing tests in this file (e.g. whether they `await buildApp()` per test or share one). Keep `expect.objectContaining({ search: 'web' })`.

- [ ] **Step 2: Run the test**

Run: `cd packages/security && npx vitest run src/__tests__/pcap-route.test.ts -t "search"`
Expected: with Tasks 1–2 merged this should PASS (schema + plumbing already done). If it FAILS, the message pinpoints a gap. Value = regression cover for the end-to-end query path + admin gate.

- [ ] **Step 3: Commit**

```bash
git add packages/security/src/__tests__/pcap-route.test.ts
git commit -m "test(pcap): cover captures list search at the route level"
```

---

## Task 4: `useCaptures` accepts a `search` param (frontend hook)

**Files:**
- Modify: `frontend/src/features/security/hooks/use-pcap.ts`
- Test: `frontend/src/features/security/hooks/use-pcap.test.ts` (create if absent, following the repo's hook-test pattern: `renderHook` + a `QueryClientProvider` wrapper + `api` spied/mocked)

- [ ] **Step 1: Write the failing test**

Open `use-pcap.test.ts` and add (matching the file's existing `api` mock + `wrapper`):
```ts
it('useCaptures forwards search in the request params', async () => {
  const getSpy = vi.spyOn(api, 'get').mockResolvedValue({ captures: [] });
  renderHook(() => useCaptures({ search: 'web' }), { wrapper });
  await waitFor(() => expect(getSpy).toHaveBeenCalled());
  expect(getSpy).toHaveBeenCalledWith(
    '/api/pcap/captures',
    { params: expect.objectContaining({ search: 'web' }) },
  );
});
```
> If the file does not exist, create it with the same provider wrapper used by other hook tests under `frontend/src/features/**/hooks/*.test.ts`. The key assertion is the `{ params: { search } }` shape — `useCaptures` calls `api.get(path, { params })`, NOT a query string.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/security/hooks/use-pcap.test.ts -t "search"`
Expected: FAIL — `search` absent from params.

- [ ] **Step 3: Implement**

In `frontend/src/features/security/hooks/use-pcap.ts`:
1. Widen the `useCaptures` parameter type:
```ts
export function useCaptures(filters?: { status?: string; containerId?: string; search?: string }) {
```
2. Add `search: filters?.search` to **both** `params` objects (the dead first `useQuery` at ~line 50 and the returned one at ~line 66):
```ts
      const params: Record<string, string | undefined> = {
        status: filters?.status,
        containerId: filters?.containerId,
        search: filters?.search,
      };
```
The `queryKey` is already `['pcap', 'captures', filters]`, so `search` is included automatically. Leave `refetchInterval` logic unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/features/security/hooks/use-pcap.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/security/hooks/use-pcap.ts frontend/src/features/security/hooks/use-pcap.test.ts
git commit -m "feat(pcap): useCaptures supports search param"
```

---

## Task 5: `BpfFilterInput` component (free-text + presets)

**Files:**
- Create: `frontend/src/features/security/components/bpf-filter-input.tsx`
- Test: `frontend/src/features/security/components/bpf-filter-input.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/features/security/components/bpf-filter-input.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BpfFilterInput } from './bpf-filter-input';

describe('BpfFilterInput', () => {
  it('renders the current value', () => {
    render(<BpfFilterInput value="port 80" onChange={() => {}} />);
    expect(screen.getByLabelText('BPF filter')).toHaveValue('port 80');
  });
  it('sets the value to the preset when empty', () => {
    const onChange = vi.fn();
    render(<BpfFilterInput value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'tcp' }));
    expect(onChange).toHaveBeenCalledWith('tcp');
  });
  it('appends the preset to an existing value', () => {
    const onChange = vi.fn();
    render(<BpfFilterInput value="port 80" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'udp' }));
    expect(onChange).toHaveBeenCalledWith('port 80 udp');
  });
  it('edits via free text', () => {
    const onChange = vi.fn();
    render(<BpfFilterInput value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('BPF filter'), { target: { value: 'icmp' } });
    expect(onChange).toHaveBeenCalledWith('icmp');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/security/components/bpf-filter-input.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the component**

Create `frontend/src/features/security/components/bpf-filter-input.tsx`:
```tsx
import { Filter } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

const BPF_PRESETS = ['tcp', 'udp', 'icmp', 'port 80', 'port 443', 'port 53', 'not port 22'];

export interface BpfFilterInputProps {
  value: string;
  onChange: (value: string) => void;
}

export function BpfFilterInput({ value, onChange }: BpfFilterInputProps) {
  const addPreset = (preset: string) => {
    const trimmed = value.trim();
    onChange(trimmed ? `${trimmed} ${preset}` : preset);
  };

  return (
    <div>
      <label className="mb-1 block text-sm font-medium" htmlFor="bpf-filter">
        <Filter className="mr-1 inline h-3.5 w-3.5" />
        BPF Filter
      </label>
      <input
        id="bpf-filter"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. port 80 or tcp"
        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        aria-label="BPF filter"
      />
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {BPF_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => addPreset(preset)}
            className={cn(
              'rounded-md border border-border/60 bg-card/80 px-2 py-0.5 text-xs font-medium text-muted-foreground',
              'transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-primary',
            )}
          >
            {preset}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/features/security/components/bpf-filter-input.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/security/components/bpf-filter-input.tsx frontend/src/features/security/components/bpf-filter-input.test.tsx
git commit -m "feat(pcap): BpfFilterInput with quick presets"
```

---

## Task 6: `CaptureTargetPicker` component (cross-endpoint cmdk search)

**Files:**
- Create: `frontend/src/features/security/components/capture-target-picker.tsx`
- Test: `frontend/src/features/security/components/capture-target-picker.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/features/security/components/capture-target-picker.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CaptureTargetPicker, type CaptureTarget } from './capture-target-picker';
import type { Container } from '@/features/containers/hooks/use-containers';
import type { Stack } from '@/features/containers/hooks/use-stacks';

const containers = [
  { id: 'c1', name: 'nginx-prod', image: 'nginx', state: 'running', status: 'Up', endpointId: 1, endpointName: 'prod', ports: [], created: 0, labels: { 'com.docker.compose.project': 'web' }, networks: [] },
  { id: 'c2', name: 'nginx-stage', image: 'nginx', state: 'running', status: 'Up', endpointId: 2, endpointName: 'staging', ports: [], created: 0, labels: {}, networks: [] },
  { id: 'c3', name: 'postgres', image: 'postgres', state: 'running', status: 'Up', endpointId: 2, endpointName: 'staging', ports: [], created: 0, labels: {}, networks: [] },
] as unknown as Container[];
const stacks = [{ id: 1, name: 'web', endpointId: 1 }] as unknown as Stack[];

function setup(props: Partial<React.ComponentProps<typeof CaptureTargetPicker>> = {}) {
  const onChange = vi.fn();
  render(
    <CaptureTargetPicker
      containers={containers}
      stacks={stacks}
      edgeAsyncEndpointIds={new Set()}
      value={null}
      onChange={onChange}
      {...props}
    />,
  );
  return { onChange };
}

describe('CaptureTargetPicker', () => {
  it('finds matching containers across endpoints with no endpoint pre-selection', () => {
    setup();
    const input = screen.getByLabelText('Search capture target container');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'nginx' } });
    expect(screen.getByText('prod')).toBeInTheDocument();
    expect(screen.getByText('staging')).toBeInTheDocument();
    expect(screen.getByText('nginx-prod')).toBeInTheDocument();
    expect(screen.getByText('nginx-stage')).toBeInTheDocument();
    expect(screen.queryByText('postgres')).not.toBeInTheDocument();
  });

  it('selecting a container emits a CaptureTarget', () => {
    const { onChange } = setup();
    const input = screen.getByLabelText('Search capture target container');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'postgres' } });
    fireEvent.click(screen.getByText('postgres'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining<Partial<CaptureTarget>>({
        endpointId: 2, containerId: 'c3', containerName: 'postgres', endpointName: 'staging',
      }),
    );
  });

  it('renders the selected target as a clearable chip', () => {
    const onChange = vi.fn();
    render(
      <CaptureTargetPicker
        containers={containers}
        stacks={stacks}
        edgeAsyncEndpointIds={new Set()}
        value={{ endpointId: 1, containerId: 'c1', containerName: 'nginx-prod', endpointName: 'prod', stackName: 'web' }}
        onChange={onChange}
      />,
    );
    expect(screen.getByText('nginx-prod')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Clear selected container'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('disables containers on edge-async endpoints', () => {
    setup({ edgeAsyncEndpointIds: new Set([2]) });
    const input = screen.getByLabelText('Search capture target container');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'nginx' } });
    const stageItem = screen.getByText('nginx-stage').closest('[data-disabled]') as HTMLElement;
    expect(stageItem).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/security/components/capture-target-picker.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the component**

Create `frontend/src/features/security/components/capture-target-picker.tsx`:
```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { Command } from 'cmdk';
import { Search, X, Box, Server } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import type { Container } from '@/features/containers/hooks/use-containers';
import type { Stack } from '@/features/containers/hooks/use-stacks';
import { filterContainers } from '@/features/containers/lib/workload-search-filter';
import { resolveContainerStackName, NO_STACK_LABEL } from '@/features/containers/lib/container-stack-grouping';

export interface CaptureTarget {
  endpointId: number;
  containerId: string;
  containerName: string;
  endpointName: string;
  stackName: string;
}

export interface CaptureTargetPickerProps {
  containers: Container[];
  stacks: Stack[];
  edgeAsyncEndpointIds: Set<number>;
  value: CaptureTarget | null;
  onChange: (target: CaptureTarget | null) => void;
  autoFocus?: boolean;
}

export function CaptureTargetPicker({
  containers, stacks, edgeAsyncEndpointIds, value, onChange, autoFocus,
}: CaptureTargetPickerProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const knownStackNames = useMemo(() => stacks.map((s) => s.name), [stacks]);
  const matches = useMemo(
    () => filterContainers(containers, query, knownStackNames),
    [containers, query, knownStackNames],
  );
  const grouped = useMemo(() => {
    const map = new Map<string, Container[]>();
    for (const c of matches) {
      const arr = map.get(c.endpointName) ?? [];
      arr.push(c);
      map.set(c.endpointName, arr);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [matches]);
  const matchingStacks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || q.includes(':')) return [];
    return [...new Set(knownStackNames)].filter((n) => n.toLowerCase().includes(q)).slice(0, 4);
  }, [knownStackNames, query]);

  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm">
        <Box className="h-4 w-4 shrink-0 text-primary" />
        <span className="font-medium">{value.containerName}</span>
        <span className="truncate text-muted-foreground">· {value.endpointName} · {value.stackName}</span>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="ml-auto rounded p-0.5 text-muted-foreground hover:text-foreground"
          aria-label="Clear selected container"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <Command shouldFilter={false} className="relative">
      <div className="flex items-center gap-2 rounded-md border bg-background px-3">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Command.Input
          ref={inputRef}
          value={query}
          onValueChange={setQuery}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder="Search containers — name, stack:web, endpoint:prod…"
          className="w-full bg-transparent py-2 text-sm focus:outline-none"
          aria-label="Search capture target container"
        />
      </div>
      {open && query.trim() && (
        <Command.List className="scrollbar-themed absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
          <Command.Empty className="px-3 py-2 text-sm text-muted-foreground">
            No running containers match.
          </Command.Empty>

          {matchingStacks.length > 0 && (
            <Command.Group heading="Stacks" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground">
              {matchingStacks.map((name) => (
                <Command.Item
                  key={`stack-${name}`}
                  value={`stack:${name}`}
                  onSelect={() => setQuery(`stack:${name}`)}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm aria-selected:bg-accent"
                >
                  <Server className="h-3.5 w-3.5" /> Stack: {name}
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {grouped.map(([endpointName, conts]) => (
            <Command.Group
              key={endpointName}
              heading={endpointName}
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-muted-foreground"
            >
              {conts.map((c) => {
                const disabled = edgeAsyncEndpointIds.has(c.endpointId);
                const stackName = resolveContainerStackName(c, knownStackNames) ?? NO_STACK_LABEL;
                return (
                  <Command.Item
                    key={c.id}
                    value={c.id}
                    disabled={disabled}
                    onSelect={() => {
                      if (disabled) return;
                      onChange({
                        endpointId: c.endpointId,
                        containerId: c.id,
                        containerName: c.name,
                        endpointName: c.endpointName,
                        stackName,
                      });
                      setQuery('');
                      setOpen(false);
                    }}
                    title={disabled ? 'Capture unavailable — Edge Async endpoint (no docker exec)' : undefined}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm aria-selected:bg-accent',
                      disabled && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <Box className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-medium">{c.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{c.image}</span>
                    <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{stackName}</span>
                  </Command.Item>
                );
              })}
            </Command.Group>
          ))}
        </Command.List>
      )}
    </Command>
  );
}
```
> cmdk sets `data-disabled` on disabled items (the edge-async test relies on it). `shouldFilter={false}` makes cmdk render exactly the items we pass — our `filterContainers` does the filtering.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/features/security/components/capture-target-picker.test.tsx`
Expected: PASS. If cmdk's `onValueChange` doesn't fire under `fireEvent.change` in jsdom, switch the typing lines to `@testing-library/user-event`: `const user = userEvent.setup(); await user.type(input, 'nginx');`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/security/components/capture-target-picker.tsx frontend/src/features/security/components/capture-target-picker.test.tsx
git commit -m "feat(pcap): cross-endpoint CaptureTargetPicker (cmdk + filterContainers)"
```

---

## Task 7: Wire the picker + BPF input into the page; drop the forced cascade

**Files:**
- Modify: `frontend/src/features/security/pages/packet-capture.tsx`
- Modify: `frontend/src/features/security/pages/packet-capture.test.tsx`

- [ ] **Step 1: Update the page test for the new flow**

In `frontend/src/features/security/pages/packet-capture.test.tsx`:

1. **Enrich the `useContainers` mock** so `filterContainers` works (it reads `image`, `status`, `endpointName`, `ports`, `state`, `labels`, `name`). Replace the mocked container array with objects that include every field, spanning two endpoints, e.g.:
```ts
{ id: 'c1', name: 'api-1', image: 'api:1', state: 'running', status: 'Up', endpointId: 1, endpointName: 'local', ports: [], created: 0, networks: [], labels: { 'com.docker.compose.project': 'alpha' } },
{ id: 'c2', name: 'worker-1', image: 'worker:1', state: 'running', status: 'Up', endpointId: 1, endpointName: 'local', ports: [], created: 0, networks: [], labels: { 'com.docker.compose.project': 'alpha' } },
{ id: 'c4', name: 'beta-api-1', image: 'beta:1', state: 'running', status: 'Up', endpointId: 1, endpointName: 'local', ports: [], created: 0, networks: [], labels: { 'com.docker.compose.project': 'beta' } },
{ id: 'c3', name: 'standalone-1', image: 'std:1', state: 'running', status: 'Up', endpointId: 1, endpointName: 'local', ports: [], created: 0, networks: [], labels: {} },
```

2. **Remove the two cascade-based tests** — `'groups running container options by stack and no-stack bucket'` and `'filters container options by selected stack'`. Their coverage moves to `capture-browse-fallback.test.tsx` (Task 9). Keep `'shows the empty state when there are no captures'` and `'renders the capture history in a DataTable...'`.

3. **Add new tests:**
```ts
it('shows capture targets without selecting an endpoint first', () => {
  render(<PacketCapture />);
  const input = screen.getByLabelText('Search capture target container');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: 'api-1' } });
  expect(screen.getByText('api-1')).toBeInTheDocument();
});

it('disables Start until a target is selected', () => {
  render(<PacketCapture />);
  expect(screen.getByRole('button', { name: /start capture/i })).toBeDisabled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/security/pages/packet-capture.test.tsx -t "without selecting"`
Expected: FAIL — picker not present yet.

- [ ] **Step 3: Implement the page changes**

In `frontend/src/features/security/pages/packet-capture.tsx`:

1. Add imports:
```tsx
import { CaptureTargetPicker, type CaptureTarget } from '@/features/security/components/capture-target-picker';
import { BpfFilterInput } from '@/features/security/components/bpf-filter-input';
```

2. Replace the four target-selection state vars (`selectedEndpoint`, `selectedStack`, `selectedContainer`, `selectedContainerName`) with one:
```tsx
const [target, setTarget] = useState<CaptureTarget | null>(null);
```

3. Fetch running containers across all endpoints:
```tsx
const { data: containers } = useContainers({ state: 'running' });
```

4. Replace the per-endpoint capability/grouping derivations with:
```tsx
const edgeAsyncEndpointIds = useMemo(
  () => new Set((endpoints ?? []).filter((e) => e.edgeMode === 'async').map((e) => e.id)),
  [endpoints],
);
const endpointNameById = useMemo(
  () => new Map((endpoints ?? []).map((e) => [e.id, e.name])),
  [endpoints],
);
const runningContainers = useMemo(
  () => (containers ?? []).filter((c) => c.state === 'running'),
  [containers],
);
const targetIsEdgeAsync = target ? edgeAsyncEndpointIds.has(target.endpointId) : false;
```
Delete the now-dead code: the `useEndpointCapabilities(selectedEndpoint)` call and `isEdgeAsync`, `stackNamesForEndpoint`, `stackOptions`, `filteredRunningContainers`, `groupedContainerOptions`, `handleContainerChange`, and the old `runningContainers` line. Keep `useStacks()`.

5. Update `handleStartCapture`:
```tsx
const handleStartCapture = () => {
  if (!target || targetIsEdgeAsync) return;
  startCapture.mutate({
    endpointId: target.endpointId,
    containerId: target.containerId,
    containerName: target.containerName,
    filter: bpfFilter || undefined,
    durationSeconds: duration ? parseInt(duration, 10) : undefined,
    maxPackets: maxPackets ? parseInt(maxPackets, 10) : undefined,
  });
};
```

6. In the New Capture form, **replace** the three `ThemedSelect` blocks (Endpoint / Stack / Container) and the inline BPF `<input>` with the target picker, the BPF component, and a contextual edge-async note. Keep Duration / Max Packets / Start in the grid; update the Start `disabled`:
```tsx
<div className="mb-4">
  <label className="mb-1 block text-sm font-medium">Target container</label>
  <CaptureTargetPicker
    containers={runningContainers}
    stacks={stacks ?? []}
    edgeAsyncEndpointIds={edgeAsyncEndpointIds}
    value={target}
    onChange={setTarget}
  />
  {targetIsEdgeAsync && (
    <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
      This container's endpoint is Edge Async — packet capture requires docker exec and is unavailable.
    </p>
  )}
</div>

<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
  <BpfFilterInput value={bpfFilter} onChange={setBpfFilter} />
  {/* keep the existing Duration block */}
  {/* keep the existing Max Packets block */}
  <div className="flex items-end">
    <button
      onClick={handleStartCapture}
      disabled={!target || targetIsEdgeAsync || startCapture.isPending}
      className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
    >
      <Play className="h-4 w-4" />
      {startCapture.isPending ? 'Starting...' : 'Start Capture'}
    </button>
  </div>
</div>
```
7. Remove the old top-level `{isEdgeAsync && (...)}` warning banner block (now contextual). Remove now-unused imports (`ThemedSelect`, `buildStackGroupedContainerOptions`, `NO_STACK_LABEL`, `resolveContainerStackName`, `useEndpointCapabilities`); the Task 11 typecheck will flag any stragglers.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/security/pages/packet-capture.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/security/pages/packet-capture.tsx frontend/src/features/security/pages/packet-capture.test.tsx
git commit -m "feat(pcap): search-first cross-endpoint target picker on the capture page"
```

---

## Task 8: Capture history search + Endpoint column

**Files:**
- Modify: `frontend/src/features/security/pages/packet-capture.tsx`
- Modify: `frontend/src/features/security/pages/packet-capture.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `packet-capture.test.tsx` (import `useCaptures` is already mocked at top via `vi.mock('@/features/security/hooks/use-pcap', ...)`; `mockUseCaptures = vi.mocked(useCaptures)` already exists):
```ts
it('passes the history search term to useCaptures', async () => {
  render(<PacketCapture />);
  fireEvent.change(screen.getByLabelText('Search capture history'), { target: { value: 'web' } });
  await waitFor(() =>
    expect(mockUseCaptures).toHaveBeenCalledWith(expect.objectContaining({ search: 'web' })),
  );
});

it('shows the endpoint name in the history table', () => {
  mockUseCaptures.mockReturnValue({
    data: { captures: [makeCapture({ endpoint_id: 1, container_name: 'web-1' })] },
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useCaptures>);
  render(<PacketCapture />);
  expect(screen.getByText('local')).toBeInTheDocument(); // endpoint_id 1 -> 'local'
});
```
> `waitFor` is imported from `@testing-library/react`; add it to the existing import if not present.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/security/pages/packet-capture.test.tsx -t "history search"`
Expected: FAIL — no search input / endpoint column.

- [ ] **Step 3: Implement**

In `packet-capture.tsx`:

1. Add debounced history-search state (ensure `useEffect` is imported):
```tsx
const [historySearch, setHistorySearch] = useState('');
const [debouncedSearch, setDebouncedSearch] = useState('');
useEffect(() => {
  const t = setTimeout(() => setDebouncedSearch(historySearch), 300);
  return () => clearTimeout(t);
}, [historySearch]);
```

2. Pass it to the hook:
```tsx
const { data: capturesData, refetch, isFetching } = useCaptures({
  status: statusFilter,
  search: debouncedSearch || undefined,
});
```

3. Add the search input in the "Capture History" header row, before the status-tabs block:
```tsx
<input
  type="text"
  value={historySearch}
  onChange={(e) => setHistorySearch(e.target.value)}
  placeholder="Search history…"
  aria-label="Search capture history"
  className="rounded-md border bg-background px-3 py-1.5 text-xs"
/>
```

4. Add an Endpoint column to the `columns` `useMemo` (insert right after the `container_name` column object) and add `endpointNameById` to that `useMemo`'s dependency array:
```tsx
{
  accessorKey: 'endpoint_id',
  header: 'Endpoint',
  cell: ({ row }) => (
    <span className="text-muted-foreground">
      {endpointNameById.get(row.original.endpoint_id) ?? `#${row.original.endpoint_id}`}
    </span>
  ),
},
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/security/pages/packet-capture.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/security/pages/packet-capture.tsx frontend/src/features/security/pages/packet-capture.test.tsx
git commit -m "feat(pcap): search capture history + show endpoint column"
```

---

## Task 9: Collapsible "Browse by endpoint" fallback

Keeps the familiar Endpoint → Stack → Container dropdowns as an optional path, sourced from the same cross-endpoint `runningContainers` list and producing the same `CaptureTarget`. This is also where the old stack-grouping assertions live now.

**Files:**
- Create: `frontend/src/features/security/components/capture-browse-fallback.tsx`
- Modify: `frontend/src/features/security/pages/packet-capture.tsx`
- Test: `frontend/src/features/security/components/capture-browse-fallback.test.tsx`

- [ ] **Step 1: Write the failing test**

First read `frontend/src/shared/components/ui/themed-select.tsx` to confirm the option/group shape and how a `ThemedSelect` renders options (Radix `combobox` role + `option` role, as the old page test used). Then create `frontend/src/features/security/components/capture-browse-fallback.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CaptureBrowseFallback } from './capture-browse-fallback';
import type { Container } from '@/features/containers/hooks/use-containers';
import type { Stack } from '@/features/containers/hooks/use-stacks';

const containers = [
  { id: 'c1', name: 'api-1', image: 'a', state: 'running', status: 'Up', endpointId: 1, endpointName: 'local', ports: [], created: 0, networks: [], labels: { 'com.docker.compose.project': 'alpha' } },
  { id: 'c4', name: 'beta-api-1', image: 'b', state: 'running', status: 'Up', endpointId: 1, endpointName: 'local', ports: [], created: 0, networks: [], labels: { 'com.docker.compose.project': 'beta' } },
  { id: 'c3', name: 'standalone-1', image: 's', state: 'running', status: 'Up', endpointId: 1, endpointName: 'local', ports: [], created: 0, networks: [], labels: {} },
] as unknown as Container[];
const stacks = [{ id: 1, name: 'alpha', endpointId: 1 }, { id: 2, name: 'beta', endpointId: 1 }] as unknown as Stack[];
const endpoints = [{ id: 1, name: 'local' }];

function open() {
  fireEvent.click(screen.getByText(/browse by endpoint/i));
}

describe('CaptureBrowseFallback', () => {
  it('groups containers by stack once an endpoint is chosen', () => {
    render(<CaptureBrowseFallback containers={containers} stacks={stacks} endpoints={endpoints} edgeAsyncEndpointIds={new Set()} onChange={() => {}} />);
    open();
    fireEvent.click(screen.getAllByRole('combobox')[0]); // endpoint
    fireEvent.click(screen.getByRole('option', { name: 'local' }));
    fireEvent.click(screen.getAllByRole('combobox')[2]); // container
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
    expect(screen.getByText('No Stack')).toBeInTheDocument();
  }, 20000);

  it('emits a CaptureTarget when a container is chosen', () => {
    const onChange = vi.fn();
    render(<CaptureBrowseFallback containers={containers} stacks={stacks} endpoints={endpoints} edgeAsyncEndpointIds={new Set()} onChange={onChange} />);
    open();
    fireEvent.click(screen.getAllByRole('combobox')[0]);
    fireEvent.click(screen.getByRole('option', { name: 'local' }));
    fireEvent.click(screen.getAllByRole('combobox')[2]);
    fireEvent.click(screen.getByRole('option', { name: 'api-1' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ endpointId: 1, containerId: 'c1', containerName: 'api-1', endpointName: 'local' }),
    );
  }, 20000);
});
```
> If `ThemedSelect`'s interaction differs from Radix `combobox`/`option` roles, adapt the queries to its actual API (the old page test used `getAllByRole('combobox')` + `getByRole('option', { name })`, so this should hold).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/security/components/capture-browse-fallback.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the fallback component**

Create `frontend/src/features/security/components/capture-browse-fallback.tsx`:
```tsx
import { useMemo, useState } from 'react';
import { ThemedSelect } from '@/shared/components/ui/themed-select';
import type { Container } from '@/features/containers/hooks/use-containers';
import type { Stack } from '@/features/containers/hooks/use-stacks';
import {
  buildStackGroupedContainerOptions,
  resolveContainerStackName,
  NO_STACK_LABEL,
} from '@/features/containers/lib/container-stack-grouping';
import type { CaptureTarget } from './capture-target-picker';

export interface CaptureBrowseFallbackProps {
  containers: Container[];
  stacks: Stack[];
  endpoints: { id: number; name: string }[];
  edgeAsyncEndpointIds: Set<number>;
  onChange: (target: CaptureTarget) => void;
}

export function CaptureBrowseFallback({
  containers, stacks, endpoints, edgeAsyncEndpointIds, onChange,
}: CaptureBrowseFallbackProps) {
  const [endpointId, setEndpointId] = useState<number | undefined>();
  const [stackName, setStackName] = useState<string | undefined>();

  const knownStackNames = useMemo(
    () => stacks.filter((s) => s.endpointId === endpointId).map((s) => s.name),
    [stacks, endpointId],
  );
  const endpointContainers = useMemo(
    () => containers.filter((c) => c.endpointId === endpointId),
    [containers, endpointId],
  );
  const stackOptions = useMemo(() => {
    const set = new Set<string>(knownStackNames);
    for (const c of endpointContainers) {
      set.add(resolveContainerStackName(c, knownStackNames) ?? NO_STACK_LABEL);
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
  }, [endpointContainers, knownStackNames]);
  const filtered = useMemo(
    () => (stackName
      ? endpointContainers.filter((c) => (resolveContainerStackName(c, knownStackNames) ?? NO_STACK_LABEL) === stackName)
      : endpointContainers),
    [endpointContainers, stackName, knownStackNames],
  );
  const containerOptions = useMemo(
    () => buildStackGroupedContainerOptions(filtered, knownStackNames),
    [filtered, knownStackNames],
  );

  const handleContainer = (id: string) => {
    const c = filtered.find((x) => x.id === id);
    if (!c || edgeAsyncEndpointIds.has(c.endpointId)) return;
    onChange({
      endpointId: c.endpointId,
      containerId: c.id,
      containerName: c.name,
      endpointName: c.endpointName,
      stackName: resolveContainerStackName(c, knownStackNames) ?? NO_STACK_LABEL,
    });
  };

  return (
    <details className="mt-3 rounded-md border bg-card/50 p-3 text-sm">
      <summary className="cursor-pointer select-none font-medium text-muted-foreground">
        Browse by endpoint
      </summary>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ThemedSelect
          value={endpointId != null ? String(endpointId) : '__all__'}
          onValueChange={(v) => { setEndpointId(v === '__all__' ? undefined : Number(v)); setStackName(undefined); }}
          placeholder="Select endpoint..."
          options={[{ value: '__all__', label: 'Select endpoint...' }, ...endpoints.map((e) => ({ value: String(e.id), label: e.name }))]}
          className="w-full text-sm"
        />
        <ThemedSelect
          value={stackName ?? '__all__'}
          onValueChange={(v) => setStackName(v === '__all__' ? undefined : v)}
          disabled={endpointId == null}
          placeholder="All stacks"
          options={[{ value: '__all__', label: 'All stacks' }, ...stackOptions.map((s) => ({ value: s, label: s }))]}
          className="w-full text-sm"
        />
        <ThemedSelect
          value="__all__"
          onValueChange={(v) => v !== '__all__' && handleContainer(v)}
          disabled={endpointId == null}
          placeholder="Select container..."
          options={[{ value: '__all__', label: 'Select container...' }, ...containerOptions]}
          className="w-full text-sm"
        />
      </div>
    </details>
  );
}
```

- [ ] **Step 4: Mount it in the page under the picker**

In `packet-capture.tsx`, import and render directly below the `CaptureTargetPicker` block (inside the same `<div className="mb-4">` or just after it):
```tsx
import { CaptureBrowseFallback } from '@/features/security/components/capture-browse-fallback';
// ...
<CaptureBrowseFallback
  containers={runningContainers}
  stacks={stacks ?? []}
  endpoints={endpoints ?? []}
  edgeAsyncEndpointIds={edgeAsyncEndpointIds}
  onChange={setTarget}
/>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/security/components/capture-browse-fallback.test.tsx src/features/security/pages/packet-capture.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/security/components/capture-browse-fallback.tsx frontend/src/features/security/components/capture-browse-fallback.test.tsx frontend/src/features/security/pages/packet-capture.tsx
git commit -m "feat(pcap): collapsible browse-by-endpoint fallback picker"
```

---

## Task 10: Docs update

**Files:**
- Modify: `docs/architecture.md`

- [ ] **Step 1: Document the change**

Add a short note under the packet-capture / security section of `docs/architecture.md`: the capture target picker now searches running containers across all endpoints (no endpoint pre-selection) via the shared `filterContainers` parser and `cmdk`, with a collapsible browse-by-endpoint fallback; the captures list API accepts an optional `search` param (parameterized match on `container_name`/`filter`). No new env vars.

- [ ] **Step 2: Commit**

```bash
git add docs/architecture.md
git commit -m "docs(pcap): note cross-endpoint capture search + history search param"
```

---

## Task 11: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck + lint**

Run:
```bash
npm run typecheck
npm run lint
```
Expected: no errors. Fix unused-import / type errors from the page refactor (removed `ThemedSelect`/`useEndpointCapabilities`/grouping imports) before continuing.

- [ ] **Step 2: Run the affected suites**

Run:
```bash
cd packages/security && npx vitest run src/__tests__/pcap-model.test.ts src/__tests__/pcap-service.test.ts src/__tests__/pcap-route.test.ts
cd ../../frontend && npx vitest run src/features/security
```
Expected: all PASS.

- [ ] **Step 3: Final fixups commit (only if something changed)**

```bash
git add -A
git commit -m "chore(pcap): typecheck/lint fixups for filter overhaul"
```

---

## Self-review notes (coverage map)

- **Type container name directly** → Task 6 (`filterContainers` free-text), Task 7 (page wiring).
- **Search stacks + containers without selecting an endpoint** → Task 6 (cross-endpoint list + `stack:` quick-filters), Task 7 (`useContainers({ state: 'running' })`, no endpoint gate).
- **Dropdowns as fallback** → Task 9.
- **History search** → Tasks 1–4 (schema/store/service/route/hook), Task 8 (UI + endpoint column).
- **BPF presets** → Task 5 + Task 7 wiring.
- **Chip with endpoint/stack context** → Task 6 (selected-state chip).
- **Edge-async safety** → Task 6 (disabled items) + Task 7 (contextual warning + Start gating) + Task 9 (fallback guards).
- **Parameterized SQL / Zod boundary** → Tasks 1–2.
- **Tests for every change** → each task is TDD.
- **Docs** → Task 10.

Type consistency: `CaptureTarget` is defined once in Task 6 and imported by Tasks 7 & 9; `GetCapturesOptions.search`, `listCaptures({search})`, `CaptureListQuerySchema.search`, and `useCaptures({search})` all use the same `search` name and shapes verified against the current code.
```
