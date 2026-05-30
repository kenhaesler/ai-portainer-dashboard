# Infrastructure page: unified smart search + per-tab filters

**Date:** 2026-05-30
**Branch:** `feature/infrastructure-smart-search` (off `dev`)
**Status:** Implemented

## Overview

The Infrastructure page (`frontend/src/features/containers/pages/fleet-overview.tsx`)
has three tabs — **Fleet Overview**, **Stack Overview**, **Kubernetes**. Today the
Fleet and Stacks tabs each render *two* search inputs in table view (a smart
`FleetSearch` bar plus the `DataTable`'s own built-in search box), and the
Kubernetes tab has no smart search or filter at all — just three tables, each with
its own built-in search.

This work consolidates each tab to a **single** Workload-Explorer-style smart
search bar (rounded, full-width, with clickable example chips), regroups the
existing filter dropdowns onto the same toolbar row as that search bar, and adds a
smart search bar to the Kubernetes tab that filters pods, deployments, and
services together.

## Goals

- One smart search bar per tab, styled like the Workload Explorer search
  (`WorkloadSmartSearch`): `rounded-xl`, full-width, left search icon, and an
  in-field row of clickable **example chips** shown while the field is empty.
- Remove the now-redundant `DataTable` built-in search box on every Infrastructure
  table (Fleet table, Stacks table, K8s pods/deployments/services tables).
- Regroup each tab's filter dropdowns + result count + view toggle onto a single
  toolbar row together with the smart search bar.
- Add a smart search bar to the Kubernetes tab that filters all three resource
  tables by name, `namespace:`, and `status:`.

## Non-Goals (out of scope)

- No changes to the Workload Explorer page or to `WorkloadSmartSearch` itself.
- No AI/LLM natural-language search mode on the Infrastructure page (the
  Workload Explorer's AI chips/mode are **not** ported here).
- No backend or API changes.
- No change to the URL-persisted dropdown filters' semantics (status/type/endpoint
  filters keep their existing URL params and behavior).

## Current state (verified on `dev`)

- `fleet-overview.tsx`
  - Fleet tab: filter row with status/type `ThemedSelect` dropdowns + count +
    grid/table view toggle (`:899`–`:957`); `FilterChipBar` (`:960`); `FleetSearch`
    endpoint search (`:969`–`:977`); table view `DataTable` with
    `searchKey="name"` + `searchPlaceholder="Search endpoints..."` (`:1040`–`:1047`).
  - Stacks tab: analogous layout; `FleetSearch` stack search (`:1144`–`:1152`);
    table view `DataTable` with built-in search (`:1206`–`:1213`).
  - K8s tab: counts summary bar (`:1224`–`:1247`) + three `DataTable`s for pods
    (`:1260`), deployments (`:1276`), services (`:1292`), each with its own
    `searchKey`/`searchPlaceholder`. No smart search, no dropdown filter.
- `components/fleet/fleet-search.tsx` — `FleetSearch`: local `query` state, 300ms
  debounce, clear button, Escape-to-clear, count badge. Props: `onSearch`,
  `totalCount`, `filteredCount`, `placeholder`, `label`. Used **only** by
  `fleet-overview.tsx` (two call sites).
- `lib/fleet-search-filter.ts` — smart filter for endpoints/stacks
  (`name:`, `status:`, `type:`, `endpoint:`, free text). Unchanged by this work.
- `shared/components/forms/workload-smart-search.tsx` — the visual reference for
  the chip overlay (in-field, right-aligned via `ml-auto` on the first chip,
  horizontally scrollable, hidden scrollbar) and Escape-to-blur behavior.

## Approach

**Chosen: upgrade the existing `FleetSearch`** to carry the Workload-Explorer look
and example chips, then reuse it on all three tabs. Rejected alternatives: building
a new shared `SmartSearchBar` primitive (larger blast radius, touches Workload
Explorer — out of scope) and reusing `WorkloadSmartSearch` directly (hard-coupled
to containers and an AI mode that does not apply here).

`FleetSearch` already owns query state, debounce, clear, count badge, and Escape
handling, so the upgrade is additive.

## Design

### 1. `FleetSearch` component upgrade (`components/fleet/fleet-search.tsx`)

New optional props:

```ts
export interface FleetSearchProps {
  onSearch: (query: string) => void;
  totalCount: number;
  filteredCount: number;
  placeholder?: string;
  label?: string;
  examples?: string[];     // NEW: chip labels shown in-field when empty
  autoFocus?: boolean;     // NEW: focus the input on mount
}
```

Behavior changes:

- **Styling:** input becomes `rounded-xl`, full-width (`w-full`), `bg-card/80`
  `backdrop-blur-sm`, `py-3`, `pl-11` (left search icon), right-side padding for the
  clear button / count badge — matching `WorkloadSmartSearch`'s input.
- **Example chips:** when `query` is empty and `examples` is non-empty, render a
  right-aligned, horizontally-scrollable chip row overlaid inside the input
  (absolute, `inset-y-0 left-11 right-3`, `ml-auto` on the first chip, hidden
  scrollbar) mirroring `WorkloadSmartSearch`. The chip row is a
  `role="group"` labelled "Example searches". Clicking the empty strip focuses the
  input. The placeholder text is hidden (`placeholder:text-transparent`) while
  chips are shown, but kept in the DOM for a11y.
- **Chip click:** sets the query to the chip label and immediately invokes
  `onSearch(label)` (no debounce wait), so the filter applies at once.
- **Escape:** clears the query **and** blurs the input (today it only clears).
- Existing debounce (300ms on typed input), clear button, and count badge are
  preserved.

`FleetSearch` remains presentation + query-state only; the actual filtering stays
in the page (via `fleet-search-filter.ts` for endpoints/stacks, and the new
`k8s-search-filter.ts` for K8s).

### 2. Fleet Overview tab

Regroup into a single responsive toolbar row:

```
[ smart search bar (flex-1) ] [ Status ▾ ] [ Type ▾ ] [ "N of M endpoints" ] [ grid/table toggle ]
```

- On large screens the search bar takes the remaining width and the dropdowns +
  count + view toggle sit to its right; on small screens they stack
  (`flex-col gap-2 lg:flex-row lg:items-center`).
- `FilterChipBar` (active-filter chips) stays on its own row directly below.
- Example chips: `name:prod`, `status:up`, `type:edge`.
- Table view: remove the `DataTable` built-in search (drop `searchKey` /
  `searchPlaceholder`, or pass an explicit disable prop — see §5). The table is
  already fed the smart-search-filtered `filteredEndpoints`.

### 3. Stack Overview tab

Same toolbar regrouping as Fleet:

```
[ smart search bar (flex-1) ] [ Status ▾ ] [ Endpoint ▾ ] [ "N of M stacks" ] [ grid/table toggle ]
```

- Example chips: `name:traefik`, `status:active`, `endpoint:prod`.
- Keep the existing standalone endpoint pill (`:1059`–`:1071`) and `FilterChipBar`.
- Table view: remove the `DataTable` built-in search; table is fed
  `filteredStacks`.

### 4. Kubernetes tab

Add one smart search bar between the counts summary bar and the first table.

- New page state `k8sSearchQuery` (local component state, consistent with how
  endpoint/stack search queries are held; not URL-persisted).
- New module `lib/k8s-search-filter.ts`:

  ```ts
  export interface K8sSearchableResource {
    name: string;
    namespace?: string;
    status?: string;   // pods: phase; deployments: derived status; absent for services
  }
  export function parseK8sQuery(q: string): { namespace?: string; status?: string; text?: string };
  export function filterK8sResources<T extends K8sSearchableResource>(items: T[], query: string): T[];
  ```

  - Supports `namespace:<ns>` and `status:<value>` field tokens plus free text
    matched against `name` (case-insensitive, substring). Empty/blank query
    returns all items. A `status:` token simply never matches resources without a
    `status` field (e.g. services), which is the intended behavior.
- Apply `filterK8sResources` to `k8sPods`, `k8sDeployments`, and `k8sServices`
  before passing each to its `DataTable`; remove all three `DataTable` built-in
  searches.
- Example chips: `namespace:kube-system`, `status:running`, `nginx`.
- Count display: the counts summary bar keeps showing per-type **totals** (an
  at-a-glance cluster overview, unaffected by the query). The search bar's own
  count badge shows the **combined** filtered total: pass `totalCount` = pods +
  deployments + services totals and `filteredCount` = the sum of the three
  filtered lengths, so the badge reads "N of M" when a query is active.

### 5. `DataTable` built-in search removal

The smart bar now owns search on every Infrastructure table, so the per-table
search box is redundant. Verify how `DataTable` toggles its search box:

- If omitting `searchKey`/`searchPlaceholder` already hides the search box, drop
  those props.
- If `DataTable` renders search whenever data has the key, add/confirm an explicit
  opt-out prop (e.g. `searchable={false}`) and use it.

This is the one implementation detail to confirm against `DataTable`'s API before
editing; the rest of the design does not depend on the outcome.

## Testing

- `components/fleet/fleet-search.test.tsx` (extend):
  - renders example chips when `examples` provided and field empty; hidden once a
    query is typed;
  - clicking a chip sets the query and calls `onSearch` with the chip label;
  - `autoFocus` focuses the input on mount;
  - Escape clears the query **and** blurs the input;
  - existing debounce/clear/count-badge tests still pass.
- `lib/k8s-search-filter.test.ts` (new):
  - `parseK8sQuery` extracts `namespace:` / `status:` tokens and free text;
  - `filterK8sResources` matches by name substring (case-insensitive), by
    namespace, by status; combines tokens (AND); returns all on empty query;
    `status:` token excludes status-less resources (services).
- `pages/fleet-overview.test.tsx` (update):
  - Fleet/Stacks toolbar renders the search bar and the filter dropdowns on the
    same toolbar (regrouped layout);
  - in table view there is exactly **one** search input per tab (no `DataTable`
    search box);
  - Kubernetes tab renders the smart search bar and typing a query filters the
    pods/deployments/services tables;
  - existing filter/pagination/tab tests still pass.

All work follows TDD (red → green → refactor). No `--no-verify`.

## Docs to update on completion

- This spec (source of truth for the change).
- `CLAUDE.md` / `docs/architecture.md` only if a public contract changes — this is
  an internal frontend refactor, so likely a brief note at most.
- No `.env.example` changes (no new config).
