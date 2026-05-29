# Workload Explorer UI refinements — design

**Date:** 2026-05-29
**Status:** Approved (design)
**Scope:** Frontend only — `frontend/src/features/containers/pages/workload-explorer.tsx`, `frontend/src/shared/components/tables/data-table.tsx`, `frontend/src/shared/components/ui/checkbox.tsx` (and their tests).

## Problem

The Workload Explorer list has six rough edges the user wants smoothed:

1. The container list scrolls (window-scroll) instead of paging; it should be paginated with a page size that fills the screen.
2. The search bar sits *below* the filter dropdowns; it should be *above* them.
3. On narrow windows the table squashes instead of offering a horizontal scrollbar.
4. The Group column is wide and shows the words "System"/"Workload"; it should be a compact symbol.
5. The selection checkbox hit-box equals the 16px visible box, so it is hard to click.
6. Clicking a column header sorts, but nothing shows which column or which direction is active.

## Goals / non-goals

**Goals:** the six fixes above, with tests, matching the existing glassmorphic design system and the reusable `DataTable` contract.

**Non-goals:** no changes to container data fetching, compare mode, CSV export, filter semantics, or the grouping detection logic. No server-side pagination. No new dependencies.

## Design

### 1. Search above filters (page)

In `workload-explorer.tsx` the merged pane currently renders **dropdowns → chips → search → table** (commented `#1313`). Reorder to:

```
WorkloadSmartSearch          (search)
filter dropdowns row         (endpoint / stack / group / state)
active filter chips
DataTable
```

Pure JSX move of the `<WorkloadSmartSearch>` block above the dropdown `<div className="flex items-center gap-4 flex-wrap">`. Update the ordering comment. No logic changes — `WorkloadSmartSearch` keeps the same props.

### 2. Auto-fit pagination (DataTable `autoFit` mode)

Replace the explorer's `windowScroll` usage with a new `autoFit` mode on `DataTable`.

**Behavior:**
- `autoFit` implies client-side pagination via TanStack's `getPaginationRowModel` — **not** virtualized, **not** window-scroll, **not** server-paginated. These modes are mutually exclusive; `autoFit` wins if combined with `windowScroll`.
- `pageSize` is **controlled and computed** from available viewport height:
  - `top = wrapperRef.current.getBoundingClientRect().top` (top of the table region — independent of how many rows render, since everything above it is search/filters/chips).
  - `available = window.innerHeight - top - HEADER_ROW(40) - FOOTER_RESERVE(56) - BOTTOM_MARGIN(24)`.
  - `pageSize = max(MIN_AUTO_ROWS=5, floor(available / ROW_HEIGHT=48))`.
- Recompute on: mount (`useLayoutEffect`), `window` `resize`, and whenever the `data` prop reference changes (filter/search changes toggle the chips row, which shifts `top`; those same actions change `data`). A `requestAnimationFrame`-guarded handler avoids resize thrash.
- `pageIndex` is controlled; clamp to `[0, pageCount-1]` whenever `pageSize` or `data` changes so a shrinking list never strands the view on an empty page.
- Footer: reuse the existing client-pagination footer ("Page X of Y (N total)" + prev/next chevron buttons), rendered when `pageCount > 1`.

**Why in DataTable, not the page:** keeps the page declarative (`autoFit` instead of `windowScroll`), makes the behavior reusable, and keeps the measurement logic unit-testable in isolation.

**Loop safety:** `top` depends only on layout *above* the table, never on the rendered row count, so computing `pageSize` from `top` cannot feed back into `top`.

### 3. Horizontal scrollbar on narrow widths (DataTable)

- Wrap each table in a container with `overflow-x-auto` (harmless for existing callers — only scrolls when content overflows; inherits the global themed scrollbar from `index.css`).
- Add an optional `minTableWidth?: number` prop applied as an inline `min-width` style on the `<table>`. Only Workload Explorer passes it (`~860`). Callers that omit it never force overflow, so other tables are unaffected.

### 4. Group column → compact icon (page)

In the `group` column def:
- Render a small lucide icon inside a tinted chip instead of the text badge:
  - **System** → amber `Cog`.
  - **Workload** → slate `Box`.
- Preserve accessibility & tests: include an `sr-only` span with the label and set `title` + `aria-label` to "System"/"Workload".
- Set the column `size` to ~72 and center the icon.

Icon import added to the existing `lucide-react` import in `workload-explorer.tsx`.

### 5. Bigger checkbox hit-box (DataTable selection cell)

Keep the `Checkbox` visual size at `md` (16px). In `data-table.tsx`'s selection column, wrap both the header and row `<Checkbox>` in a padded `<label className="inline-flex items-center justify-center cursor-pointer p-2.5 -m-2.5">`:
- The native `<label>` makes the whole padded area (~36px) toggle the checkbox.
- `onClick={(e) => e.stopPropagation()}` on the label prevents the row-navigation click (mirrors the existing input `stopPropagation`).
- The negative margin keeps layout unchanged.
- Widen the selection column `size` from 40 to ~52 to fit the padded target.

No change to the generic `Checkbox` component API (the bigger target is a table-selection concern, scoped to where the row-click conflict exists).

### 6. Sort direction visualization (DataTable header)

In `renderHeader`, drive the indicator off `header.column.getIsSorted()` (`'asc' | 'desc' | false`):
- `asc` → `ArrowUp`, `desc` → `ArrowDown`, both `text-foreground` (emphasized).
- sortable but inactive → `ArrowUpDown` at `text-muted-foreground/40` (faint).
- Emphasize the active header: `text-foreground` (vs `text-muted-foreground`) on the `<th>`.
- Add `aria-sort` (`ascending`/`descending`/`none`) to the `<th>` for accessibility.

`ArrowDown` added to the existing `lucide-react` import in `data-table.tsx`.

## Testing

TDD throughout. New/updated tests:

- **`data-table.test.tsx`**
  - `autoFit`: with mocked `window.innerHeight` and `getBoundingClientRect().top`, asserts computed `pageSize`, that only one page of rows renders, that prev/next paginate, and the `MIN_AUTO_ROWS` floor on tiny viewports.
  - `minTableWidth`: asserts the inline `min-width` style is applied and the wrapper has `overflow-x-auto`.
  - Sort indicator: clicking a sortable header swaps the icon to up/down and sets `aria-sort`; inactive sortable headers show the faint neutral icon.
  - Selection hit-box: clicking the padded label area (not the input directly) toggles selection and does not trigger `onRowClick`.
- **`workload-explorer.test.tsx`**
  - Update for search-above-filters ordering if any test asserts DOM order.
  - Group cell: assert icon + `aria-label`/`sr-only` "System"/"Workload" instead of visible text.
  - Account for client pagination: jsdom (no layout) yields `top=0`, `innerHeight=768` → ~13 rows/page. Fixtures are expected to be ≤ one page; any test needing a row beyond page 1 navigates to its page first. Confirm fixture sizes during implementation and adjust the few affected assertions.
- **`checkbox.test.tsx`** unchanged (component API unchanged).

## Risks

- **Auto-fit measurement** is the only nuanced piece. jsdom performs no layout, so tests mock `innerHeight`/`getBoundingClientRect`. On very short viewports the `MIN_AUTO_ROWS=5` floor means the list keeps 5 rows and gains vertical scroll within the page rather than collapsing to one row.
- **Existing test churn** from the scroll→pagination switch is bounded to assertions that expect all rows in the DOM at once; mitigated by small fixtures and per-test page navigation where needed.
