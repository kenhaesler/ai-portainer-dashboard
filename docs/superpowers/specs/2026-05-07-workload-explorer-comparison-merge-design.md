# Workload Explorer + Container Comparison merge — Design

**Date:** 2026-05-07
**Status:** Approved (brainstorming complete, awaiting plan)
**Author:** simon (with Claude)

## Goal

Fold the standalone `/comparison` page into Workload Explorer (`/workloads`). Selection always lives on the table; the comparison view is reachable only after the user picks ≥2 containers there. The "Comparison" entry in the sidebar and mobile bottom nav goes away.

## Why

1. **Dead-end navigation.** Clicking "Comparison" in the sidebar lands on a page whose only useful state is post-selection. The page renders a Container Selector that duplicates what the table already does better.
2. **Sidebar real-estate.** One fewer top-level item; the existing "Compare N selected" bulk-action on Workload Explorer becomes the sole entry point.

## Routes and URL state machine

| URL | Renders |
|---|---|
| `/workloads` | Table view (current behaviour, unchanged). |
| `/workloads?mode=compare&containers=<eId>:<cId>,…` | Same component, comparison view instead of table. |
| `/comparison`, `/comparison?…` | `<Navigate replace>` → `/workloads?mode=compare&containers=…`. Kept for at least one release so external bookmarks land somewhere useful. Deletable later. |

State transitions inside Workload Explorer driven by `useSearchParams`:

- `mode` absent or unknown → table view.
- `mode === 'compare'` and ≥1 valid containers → comparison view.
- `mode === 'compare'` and 0 valid containers → empty state inside compare mode (see Edge Cases).

The existing bulk-action `handleCompare()` at `workload-explorer.tsx:224` switches its target from `/comparison?containers=…` to `/workloads?mode=compare&containers=…`. All of the table's filter params (endpoint, stack, group, state, search, q) remain in their own URL params and are preserved across the swap, so the back button restores the exact same filtered list.

Sidebar at `frontend/src/features/core/components/layout/sidebar.tsx:67` and mobile nav at `mobile-bottom-nav.tsx:38` drop the Comparison entry. The prefetch at `sidebar.tsx:199` is removed.

## Component refactor

**Today:** `frontend/src/features/containers/pages/container-comparison.tsx` is a 588-line page. Top: header + `ContainerSelector` + tab strip. Middle: 3 tab implementations (Metrics, Configuration, Summary). Bottom: page wiring (state, URL parsing, layout).

**After:**

| File | Status | Lines (target) |
|---|---|---|
| `frontend/src/features/containers/pages/workload-explorer.tsx` | Modify (add `mode === 'compare'` branch) | ~620 → ~660 |
| `frontend/src/features/containers/components/container-comparison-view.tsx` | New (rename + downsize from the page) | ~440 |
| `frontend/src/features/containers/pages/container-comparison.tsx` | Delete | 0 |
| `frontend/src/features/containers/pages/container-comparison-redirect.tsx` | New (5-line redirect component) | ~10 |

Changes the renamed view absorbs:

- **Drops** the `<h1>Container Comparison</h1>` header and the `Container Selector` markup. The selector lives only on Workload Explorer's table now; the comparison view does not own selection.
- **Drops** the `useSearchParams`/`containers=` URL parsing. Receives `containers: Container[]` as a prop.
- **Keeps** `tab`, `timeRange`, `interval` state. These move to URL params on `/workloads` (`?tab=metrics&range=1h&interval=30s`) so refreshing the comparison view doesn't reset the user's tab.
- **Keeps** the per-container "remove pill" affordance. Each currently-compared container shows as a pill with an `×` button at the top of the view; clicking the × calls `props.onRemove(containerId)` which mutates the `containers=` URL param on Workload Explorer.

Workload Explorer's render gains a small branch when `mode === 'compare'`:

- Header swap: title becomes `Comparing N containers` with a `← Back to list` button. The auto-refresh + refresh controls remain (they apply to both views).
- Renders `<ContainerComparisonView containers={selectedFromUrl} onRemove={…} onBack={…} />` instead of the table block.
- ~20-30 lines of wiring + the props-construction code.

Adding a NEW container while in compare mode is intentionally **not** supported. The user goes back to the table, ticks more rows, hits Compare again. This keeps the model "selection lives on the table" intact.

## Edge cases

1. **Deep-link arrives mid-load.** Comparison view renders a skeleton until `useContainers()` resolves, then maps URL ids to `Container` objects.
2. **Some IDs don't match any current container.** Missing ids are silently filtered out. If ≥2 valid remain, the view renders for those; otherwise → case 3 or 4.
3. **`?mode=compare` with empty / missing / 0-valid `containers`.** Empty state inside the view: heading "No containers to compare", body "Pick at least 2 containers from Workload Explorer to compare them.", single `← Back to list` button that strips both params.
4. **Drops to exactly 1 container after pill removal.** Same empty-state shape, body copy "Compare needs at least 2 containers."
5. **Drops to 0 via pill removal.** Stay in compare mode, render case-3 empty state. Do NOT auto-redirect — the click sequence shouldn't move the user without their consent.
6. **`?containers=` set without `?mode=compare`.** Ignore. Render the table.
7. **Compare-mode-only URL params** (`tab`, `range`, `interval`). Read only when `mode === 'compare'`. Stripped from the URL on transitions back to the table view so the back URL is clean.

## Testing

**Unit (`container-comparison-view.test.tsx`):**

- Adopts the existing tests in `pages/container-comparison.test.tsx`, dropping URL-parsing assertions and any selection-state assertions (selection is now external).
- New: pill-row renders one pill per container with an × button. Clicking × calls `onRemove(containerId)`.

**Integration (`workload-explorer.test.tsx`):**

- New describe block `Workload Explorer — compare mode`:
  - `?mode=compare&containers=…` renders the comparison view (assert by a comparison-only element, e.g. tab strip), table is NOT in the DOM.
  - `← Back to list` strips both params; table renders with the same filters.
  - Empty cases 3 and 4: render the empty state, click `Back to list` → URL clears.
- Existing tests stay green.

## Acceptance Criteria

- [ ] `/workloads` table view unchanged.
- [ ] `/workloads?mode=compare&containers=…` renders the comparison view in full viewport.
- [ ] "Compare N selected" bulk-action navigates to the new URL.
- [ ] "← Back to list" from compare view restores the table with filters preserved.
- [ ] `/comparison?…` redirects to `/workloads?mode=compare&…` via `<Navigate replace>`.
- [ ] Sidebar + mobile bottom nav drop the Comparison entry.
- [ ] Edge cases 1–7 behave as described.
- [ ] Existing tests green; new compare-mode tests added per Testing section.
- [ ] No new dependencies.

## Out of scope

- Adding containers to the comparison while inside compare mode (round-trip via the table is the supported flow).
- CSV export of the comparison view (Workload Explorer's table export is unchanged).
- Visual restyling of the comparison view's tabs / charts / config diff. The migration is structural — the view's content rendering is unchanged.
- Deleting `/comparison` route entirely. Kept as a redirect for at least one release.

## File touch summary

```
modify  frontend/src/features/containers/pages/workload-explorer.tsx     (+ ~40 lines)
modify  frontend/src/router.tsx                                          (replace ContainerComparison lazy import + route)
modify  frontend/src/features/core/components/layout/sidebar.tsx         (drop Comparison item + prefetch)
modify  frontend/src/features/core/components/layout/mobile-bottom-nav.tsx (drop Comparison item)
create  frontend/src/features/containers/components/container-comparison-view.tsx  (~440 lines, renamed/trimmed)
create  frontend/src/features/containers/pages/container-comparison-redirect.tsx   (~10 lines)
delete  frontend/src/features/containers/pages/container-comparison.tsx
modify  frontend/src/features/containers/pages/workload-explorer.test.tsx
create  frontend/src/features/containers/components/container-comparison-view.test.tsx (rewritten from container-comparison.test.tsx)
delete  frontend/src/features/containers/pages/container-comparison.test.tsx
```
