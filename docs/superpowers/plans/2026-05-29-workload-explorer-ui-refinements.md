# Workload Explorer UI Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the Workload Explorer list — auto-fit pagination, search above filters, horizontal scroll on narrow widths, a compact Group icon, a bigger checkbox hit-box, and a sort-direction indicator.

**Architecture:** Two reusable-component changes in `data-table.tsx` (auto-fit pagination + horizontal scroll, sort indicator, enlarged selection hit-box) and two page changes in `workload-explorer.tsx` (search-above-filters reorder, Group-column icon + wiring to `autoFit`). The page's test suite mocks `DataTable`, so the scroll→pagination switch is isolated to `data-table.test.tsx` plus one mock/prop update in the page suite.

**Tech Stack:** React 19, TanStack Table v8 (`getPaginationRowModel`), Tailwind CSS, lucide-react icons, Vitest + @testing-library/react (jsdom).

**Spec:** `docs/superpowers/specs/2026-05-29-workload-explorer-ui-refinements-design.md`

**Branch:** `feature/workload-explorer-ui-refinements` (already created off `dev`).

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `frontend/src/shared/components/tables/data-table.tsx` | Reusable table | Add `autoFit` + `minTableWidth` props, controlled auto-fit pagination, directional sort indicator, enlarged selection hit-box, `overflow-x-auto` wrappers |
| `frontend/src/shared/components/tables/data-table.test.tsx` | Table tests | New tests for sort indicator, hit-box, auto-fit, horizontal scroll |
| `frontend/src/features/containers/pages/workload-explorer.tsx` | Explorer page | Reorder search above filters; Group column → icon; switch `windowScroll`→`autoFit` + `minTableWidth` |
| `frontend/src/features/containers/pages/workload-explorer.test.tsx` | Page tests | Update `DataTable` mock + `windowScroll` test; add search-order, Group-icon, `autoFit`/`minTableWidth` tests |

All commands run from the repo root unless noted. Single-file test command pattern:
`cd frontend && npx vitest run <path>`

---

## Task 1: Sort-direction indicator (data-table)

**Files:**
- Modify: `frontend/src/shared/components/tables/data-table.tsx` (import line 18; `renderHeader`, lines 258-285)
- Test: `frontend/src/shared/components/tables/data-table.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add this `describe` block inside the top-level `describe('DataTable', …)` in `data-table.test.tsx` (e.g. right after the existing `describe('sorting', …)` block, before `describe('server-side pagination mode', …)`):

```tsx
  describe('sort direction indicator', () => {
    it('marks sortable headers aria-sort="none" before any sort', () => {
      render(<DataTable columns={testColumns} data={makeRows(5)} />);
      const nameHeader = screen.getByText('Name').closest('th');
      expect(nameHeader).toHaveAttribute('aria-sort', 'none');
    });

    it('sets aria-sort ascending then descending when toggling a header', () => {
      render(<DataTable columns={testColumns} data={makeRows(5)} />);
      const nameHeader = screen.getByText('Name').closest('th')!;
      fireEvent.click(nameHeader);
      expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');
      fireEvent.click(nameHeader);
      expect(nameHeader).toHaveAttribute('aria-sort', 'descending');
    });

    it('swaps the neutral icon for a directional arrow on the active column', () => {
      render(<DataTable columns={testColumns} data={makeRows(5)} />);
      const nameHeader = screen.getByText('Name').closest('th')!;
      // inactive → neutral up/down icon
      expect(nameHeader.querySelector('svg.lucide-arrow-up-down')).toBeInTheDocument();
      fireEvent.click(nameHeader);
      // ascending → arrow-up, neutral icon gone
      expect(nameHeader.querySelector('svg.lucide-arrow-up')).toBeInTheDocument();
      expect(nameHeader.querySelector('svg.lucide-arrow-up-down')).not.toBeInTheDocument();
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/shared/components/tables/data-table.test.tsx -t "sort direction indicator"`
Expected: FAIL — `aria-sort` attribute absent; `lucide-arrow-up` not found (header always renders `ArrowUpDown`).

- [ ] **Step 3: Implement the directional indicator**

In `data-table.tsx`, add `ArrowDown` to the lucide import (line 18):

```tsx
import { ArrowUpDown, ChevronLeft, ChevronRight, ArrowUp, ArrowDown } from 'lucide-react';
```

Replace the entire `renderHeader` function (lines 258-285) with:

```tsx
  const renderHeader = () => (
    <thead className={cn('[&_tr]:border-b', useVirtual && 'sticky top-0 z-10 bg-card')}>
      {table.getHeaderGroups().map((headerGroup) => (
        <tr key={headerGroup.id} className="border-b transition-colors hover:bg-muted/50">
          {headerGroup.headers.map((header) => {
            const canSort = header.column.getCanSort();
            const sorted = header.column.getIsSorted(); // 'asc' | 'desc' | false
            return (
              <th
                key={header.id}
                style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                aria-sort={
                  !canSort
                    ? undefined
                    : sorted === 'asc'
                      ? 'ascending'
                      : sorted === 'desc'
                        ? 'descending'
                        : 'none'
                }
                className={cn(
                  'h-10 px-4 text-left align-middle font-medium',
                  canSort && 'cursor-pointer select-none',
                  sorted ? 'text-foreground' : 'text-muted-foreground',
                )}
                onClick={header.column.getToggleSortingHandler()}
              >
                <div className="flex items-center gap-2">
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                  {canSort &&
                    (sorted === 'asc' ? (
                      <ArrowUp className="h-4 w-4 text-foreground" />
                    ) : sorted === 'desc' ? (
                      <ArrowDown className="h-4 w-4 text-foreground" />
                    ) : (
                      <ArrowUpDown className="h-4 w-4 text-muted-foreground/40" />
                    ))}
                </div>
              </th>
            );
          })}
        </tr>
      ))}
    </thead>
  );
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/shared/components/tables/data-table.test.tsx`
Expected: PASS — the new `sort direction indicator` tests pass and all existing `data-table` tests (including `describe('sorting')`, which only checks an svg exists per sortable header) still pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/components/tables/data-table.tsx frontend/src/shared/components/tables/data-table.test.tsx
git commit -m "$(cat <<'EOF'
feat(data-table): show active sort column and direction

Sortable headers now render an up/down arrow for the active column
(emphasized) and a faint neutral icon when inactive, and expose
aria-sort for assistive tech.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Bigger checkbox hit-box (data-table selection cell)

**Files:**
- Modify: `frontend/src/shared/components/tables/data-table.tsx` (`selectionColumn`, lines 97-133)
- Test: `frontend/src/shared/components/tables/data-table.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add this `describe` block inside the top-level `describe('DataTable', …)` (e.g. after `describe('row selection', …)`):

```tsx
  describe('selection hit-box', () => {
    it('wraps the row checkbox in a padded label to enlarge the click target', () => {
      render(<DataTable columns={testColumns} data={makeRows(2)} enableRowSelection />);
      const input = screen.getByTestId('row-checkbox-0');
      const label = input.closest('label');
      expect(label).not.toBeNull();
      expect(label?.className).toContain('p-2.5');
      expect(label?.className).toContain('cursor-pointer');
    });

    it('toggles selection when the padded label is clicked, without firing onRowClick', () => {
      const onRowClick = vi.fn();
      const onSelectionChange = vi.fn();
      const data = makeRows(2);
      render(
        <DataTable
          columns={testColumns}
          data={data}
          enableRowSelection
          onRowClick={onRowClick}
          onSelectionChange={onSelectionChange}
        />,
      );
      const label = screen.getByTestId('row-checkbox-0').closest('label')!;
      fireEvent.click(label);
      expect(onSelectionChange).toHaveBeenCalledWith([data[0]]);
      expect(onRowClick).not.toHaveBeenCalled();
    });
  });
```

> Note: jsdom forwards a click on a `<label>` to the checkbox it wraps, so `fireEvent.click(label)` toggles the input. If this jsdom version does not forward, change that line to `await userEvent.click(label)` (`import userEvent from '@testing-library/user-event'`) and make the test `async`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/shared/components/tables/data-table.test.tsx -t "selection hit-box"`
Expected: FAIL — the checkbox has no wrapping `<label>` (`input.closest('label')` is null).

- [ ] **Step 3: Implement the padded label wrapper**

In `data-table.tsx`, replace the `selectionColumn` `useMemo` (lines 97-133) with:

```tsx
  // Build the checkbox column when row selection is enabled
  const selectionColumn = useMemo<ColumnDef<T, any> | null>(() => {
    if (!enableRowSelection) return null;
    return {
      id: '_selection',
      size: 52,
      enableSorting: false,
      header: ({ table: tbl }) => {
        const allPageSelected = tbl.getIsAllPageRowsSelected();
        const somePageSelected = tbl.getIsSomePageRowsSelected();
        return (
          <label
            className="-m-2.5 inline-flex cursor-pointer items-center justify-center p-2.5"
            onClick={(e) => e.stopPropagation()}
          >
            <Checkbox
              data-testid="select-all-checkbox"
              aria-label="Select all on page"
              checked={allPageSelected}
              indeterminate={somePageSelected && !allPageSelected}
              onChange={tbl.getToggleAllPageRowsSelectedHandler()}
            />
          </label>
        );
      },
      cell: ({ row }) => {
        const selectedCount = Object.keys(rowSelection).filter((k) => rowSelection[k]).length;
        const isSelected = row.getIsSelected();
        const isDisabled = !isSelected && maxSelection !== undefined && selectedCount >= maxSelection;
        return (
          <label
            className="-m-2.5 inline-flex cursor-pointer items-center justify-center p-2.5"
            onClick={(e) => e.stopPropagation()}
          >
            <Checkbox
              data-testid={`row-checkbox-${row.id}`}
              aria-label={`Select row ${row.id}`}
              checked={isSelected}
              disabled={isDisabled}
              title={isDisabled ? `Maximum of ${maxSelection} containers can be compared at once` : undefined}
              onChange={row.getToggleSelectedHandler()}
              onClick={(e) => e.stopPropagation()}
            />
          </label>
        );
      },
    };
  }, [enableRowSelection, maxSelection, rowSelection]);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/shared/components/tables/data-table.test.tsx`
Expected: PASS — new hit-box tests pass; existing `row selection` and `themed checkbox` tests still pass (the input's immediate parent is still the Checkbox `<span>`, so the `selectAll.parentElement.tagName === 'SPAN'` assertion holds).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/components/tables/data-table.tsx frontend/src/shared/components/tables/data-table.test.tsx
git commit -m "$(cat <<'EOF'
feat(data-table): enlarge row-selection checkbox hit target

Wrap the selection checkbox in a padded label (~36px target) so the
column is easy to click without changing the visible box; stop click
propagation so it never triggers row navigation.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Auto-fit pagination + horizontal scroll (data-table)

**Files:**
- Modify: `frontend/src/shared/components/tables/data-table.tsx` (imports, constants, props, mode flags, table options, effects, render)
- Test: `frontend/src/shared/components/tables/data-table.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add these two `describe` blocks inside the top-level `describe('DataTable', …)` (e.g. after the `describe('windowScroll mode (#1288)', …)` block):

```tsx
  describe('autoFit mode', () => {
    let rectSpy: ReturnType<typeof vi.spyOn> | undefined;

    const setViewport = (innerHeight: number, top: number) => {
      Object.defineProperty(window, 'innerHeight', { value: innerHeight, configurable: true });
      rectSpy = vi
        .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
        .mockReturnValue({
          top,
          bottom: 0,
          left: 0,
          right: 0,
          width: 0,
          height: 0,
          x: 0,
          y: top,
          toJSON: () => ({}),
        } as DOMRect);
    };

    afterEach(() => {
      rectSpy?.mockRestore();
      rectSpy = undefined;
      Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });
    });

    it('computes page size from the available viewport height', () => {
      // available = 1000 - 200 - 40 - 56 - 24 = 680 → floor(680 / 48) = 14 rows/page
      setViewport(1000, 200);
      render(<DataTable columns={testColumns} data={makeRows(30)} autoFit />);
      expect(screen.getByTestId('auto-fit-container')).toBeInTheDocument();
      expect(screen.getByText('container-14')).toBeInTheDocument();
      expect(screen.queryByText('container-15')).not.toBeInTheDocument();
      expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument(); // ceil(30/14) = 3
    });

    it('paginates to the next page of rows', () => {
      setViewport(1000, 200); // 14 rows/page
      render(<DataTable columns={testColumns} data={makeRows(30)} autoFit />);
      const buttons = screen.getAllByRole('button');
      fireEvent.click(buttons[buttons.length - 1]); // next page
      expect(screen.getByText('container-15')).toBeInTheDocument();
      expect(screen.queryByText('container-14')).not.toBeInTheDocument();
      expect(screen.getByText(/Page 2 of 3/)).toBeInTheDocument();
    });

    it('floors page size to a minimum of 5 rows on very short viewports', () => {
      // available = 200 - 180 - 40 - 56 - 24 = -100 → max(5, floor(-100/48)) = 5
      setViewport(200, 180);
      render(<DataTable columns={testColumns} data={makeRows(12)} autoFit />);
      expect(screen.getByText('container-5')).toBeInTheDocument();
      expect(screen.queryByText('container-6')).not.toBeInTheDocument();
      expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument(); // ceil(12/5) = 3
    });

    it('does not virtualize or window-scroll in autoFit mode', () => {
      setViewport(1000, 200);
      render(<DataTable columns={testColumns} data={makeRows(100)} autoFit />);
      expect(screen.queryByTestId('virtual-scroll-container')).not.toBeInTheDocument();
      expect(screen.queryByTestId('window-scroll-container')).not.toBeInTheDocument();
      expect(screen.getByTestId('auto-fit-container')).toBeInTheDocument();
    });
  });

  describe('horizontal scroll (minTableWidth)', () => {
    let rectSpy: ReturnType<typeof vi.spyOn> | undefined;

    afterEach(() => {
      rectSpy?.mockRestore();
      rectSpy = undefined;
      Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });
    });

    it('applies overflow-x-auto and a min-width on the table when minTableWidth is set', () => {
      Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true });
      rectSpy = vi
        .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
        .mockReturnValue({ top: 100, toJSON: () => ({}) } as DOMRect);
      render(<DataTable columns={testColumns} data={makeRows(5)} autoFit minTableWidth={860} />);
      const container = screen.getByTestId('auto-fit-container');
      expect(container.className).toContain('overflow-x-auto');
      const table = container.querySelector('table');
      expect(table?.style.minWidth).toBe('860px');
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/shared/components/tables/data-table.test.tsx -t "autoFit mode"`
Expected: FAIL — `autoFit` prop is unknown; no `auto-fit-container` testid.

- [ ] **Step 3a: Update imports and add constants**

In `data-table.tsx`, update the React import (line 1) to add `useLayoutEffect`:

```tsx
import { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
```

Update the `@tanstack/react-table` import (lines 2-14) to add `PaginationState` and `Updater` types — add these two lines inside the import block:

```tsx
  type PaginationState,
  type Updater,
```

Add these constants after `const SCROLL_TO_TOP_THRESHOLD = 20;` (line 24):

```tsx
const AUTO_FIT_HEADER_PX = 40; // sticky header row (h-10)
const AUTO_FIT_FOOTER_PX = 56; // pagination footer reserve
const AUTO_FIT_MARGIN_PX = 24; // breathing room above the viewport bottom
const MIN_AUTO_ROWS = 5; // never page smaller than this
```

- [ ] **Step 3b: Add the props**

In the `DataTableProps<T>` interface, add after `windowScroll?: boolean;` (line 55):

```tsx
  /**
   * Paginate with a page size computed to fill the available viewport
   * height. Recomputes on resize and when `data` changes. Mutually
   * exclusive with `windowScroll`, virtualization, and `serverPagination`.
   */
  autoFit?: boolean;
  /**
   * Minimum table width in px. When the container is narrower the table
   * overflows horizontally (themed scrollbar) instead of squashing columns.
   */
  minTableWidth?: number;
```

In the destructured props (lines 58-75), add `autoFit,` and `minTableWidth,` (e.g. after `windowScroll,`).

- [ ] **Step 3c: Add state and the mode flags**

After `const [rowSelection, setRowSelection] = useState<RowSelectionState>({});` (line 78), add:

```tsx
  const [pageIndex, setPageIndex] = useState(0);
  const [autoPageSize, setAutoPageSize] = useState(MIN_AUTO_ROWS);
  const autoFitWrapperRef = useRef<HTMLDivElement>(null);
```

Replace the mode-flag block (lines 90-94) with:

```tsx
  const isServerPaginated = !!serverPagination;
  const useAutoFit = !!autoFit && !isServerPaginated;
  const useWindowScroll = !!windowScroll && !isServerPaginated && !useAutoFit;
  const useVirtual = !useWindowScroll
    && !useAutoFit
    && !isServerPaginated
    && (virtualScrolling ?? data.length > VIRTUAL_THRESHOLD);
  const useClientPagination = !useVirtual && !useWindowScroll && !isServerPaginated;
```

- [ ] **Step 3d: Wire pagination into the table options**

In the `useReactTable` call:

Replace line 146:
```tsx
    ...(useVirtual || isServerPaginated || useWindowScroll ? {} : { getPaginationRowModel: getPaginationRowModel() }),
```
with:
```tsx
    ...(useClientPagination ? { getPaginationRowModel: getPaginationRowModel() } : {}),
```

Immediately after `onColumnFiltersChange: setColumnFilters,` (line 148), add:
```tsx
    ...(useAutoFit
      ? {
          onPaginationChange: (updater: Updater<PaginationState>) => {
            setPageIndex((prev) => {
              const next =
                typeof updater === 'function'
                  ? updater({ pageIndex: prev, pageSize: autoPageSize })
                  : updater;
              return next.pageIndex;
            });
          },
        }
      : {}),
```

Replace the `state` object (lines 159-163) with:
```tsx
    state: {
      sorting,
      columnFilters,
      ...(enableRowSelection ? { rowSelection } : {}),
      ...(useAutoFit ? { pagination: { pageIndex, pageSize: autoPageSize } } : {}),
    },
```

Replace line 164:
```tsx
    ...(useVirtual || isServerPaginated || useWindowScroll ? {} : { initialState: { pagination: { pageSize } } }),
```
with:
```tsx
    ...(useClientPagination && !useAutoFit ? { initialState: { pagination: { pageSize } } } : {}),
```

- [ ] **Step 3e: Add the measurement + clamp effects**

After the "Sync external search value into column filter" effect (ends line 180), add:

```tsx
  // Auto-fit: compute a page size that fills the available viewport height.
  const recomputeAutoPageSize = useCallback(() => {
    if (!useAutoFit) return;
    const el = autoFitWrapperRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    const available =
      window.innerHeight - top - AUTO_FIT_HEADER_PX - AUTO_FIT_FOOTER_PX - AUTO_FIT_MARGIN_PX;
    const size = Math.max(MIN_AUTO_ROWS, Math.floor(available / ROW_HEIGHT));
    setAutoPageSize((prev) => (prev === size ? prev : size));
  }, [useAutoFit]);

  useLayoutEffect(() => {
    recomputeAutoPageSize();
  }, [recomputeAutoPageSize, data]);

  useEffect(() => {
    if (!useAutoFit) return;
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(recomputeAutoPageSize);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(raf);
    };
  }, [useAutoFit, recomputeAutoPageSize]);

  // Keep pageIndex in range when the page size or data shrinks.
  useEffect(() => {
    if (!useAutoFit) return;
    const pageCount = table.getPageCount();
    if (pageCount > 0 && pageIndex > pageCount - 1) {
      setPageIndex(pageCount - 1);
    }
  }, [useAutoFit, autoPageSize, data, pageIndex, table]);
```

- [ ] **Step 3f: Add `tableStyle` and `renderClientPagination`**

After `const serverPageCount = …` / `const canServerNext = …` block (ends ~line 233), add:

```tsx
  const tableStyle = minTableWidth ? { minWidth: minTableWidth } : undefined;

  const renderClientPagination = () => {
    if (table.getPageCount() <= 1) return null;
    return (
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()} ({data.length} total)
        </p>
        <div className="flex items-center gap-2">
          <button
            className="inline-flex items-center justify-center rounded-md border border-input bg-background p-2 text-sm hover:bg-accent disabled:opacity-50"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            className="inline-flex items-center justify-center rounded-md border border-input bg-background p-2 text-sm hover:bg-accent disabled:opacity-50"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  };
```

- [ ] **Step 3g: Replace the render return**

Replace the entire `return (…)` block (lines 318-474) with:

```tsx
  return (
    <div data-testid="data-table" className="space-y-4">
      {!hideSearch && (
        <div className="flex items-center justify-between gap-4">
          {searchKey && (
            <input
              data-testid="data-table-search"
              type="text"
              placeholder={searchPlaceholder}
              value={searchValue}
              onChange={(e) => table.getColumn(searchKey)?.setFilterValue(e.target.value)}
              className="w-full max-w-sm rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          )}
          {useVirtual && (
            <p className="shrink-0 text-sm text-muted-foreground" data-testid="virtual-row-count">
              {isFiltered
                ? `${filteredCount} of ${totalCount} match${filteredCount !== 1 ? '' : 'es'}`
                : `${totalCount} total`}
            </p>
          )}
        </div>
      )}

      {useAutoFit ? (
        <>
          <div
            ref={autoFitWrapperRef}
            className="overflow-x-auto rounded-md border"
            data-testid="auto-fit-container"
          >
            <table className="w-full caption-bottom text-sm" style={tableStyle}>
              {renderHeader()}
              <tbody className="[&_tr:last-child]:border-0">
                {table.getRowModel().rows.length ? (
                  table.getRowModel().rows.map((row) => renderRow(row))
                ) : (
                  <tr>
                    <td colSpan={allColumns.length} className="h-24 text-center text-muted-foreground">
                      No results.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {renderClientPagination()}
        </>
      ) : useWindowScroll ? (
        <div className="overflow-x-auto rounded-md border" data-testid="window-scroll-container">
          <table className="w-full caption-bottom text-sm" style={tableStyle}>
            {renderHeader()}
            <tbody className="[&_tr:last-child]:border-0">
              {rows.length ? (
                rows.map((row) => renderRow(row))
              ) : (
                <tr>
                  <td colSpan={allColumns.length} className="h-24 text-center text-muted-foreground">
                    No results.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : useVirtual ? (
        <div className="relative rounded-md border">
          <div
            ref={scrollContainerRef}
            className="overflow-auto"
            style={{ maxHeight: SCROLL_CONTAINER_HEIGHT }}
            tabIndex={0}
            onKeyDown={handleKeyDown}
            role="grid"
            aria-label="Data table with virtual scrolling"
            data-testid="virtual-scroll-container"
          >
            <table className="w-full caption-bottom text-sm" style={tableStyle}>
              {renderHeader()}
              <tbody className="[&_tr:last-child]:border-0">
                {rows.length ? (
                  <>
                    {virtualizer.getVirtualItems().length > 0 && (
                      <tr>
                        <td
                          colSpan={allColumns.length}
                          style={{ height: virtualizer.getVirtualItems()[0]?.start ?? 0, padding: 0 }}
                        />
                      </tr>
                    )}
                    {virtualizer.getVirtualItems().map((virtualRow) => {
                      const row = rows[virtualRow.index];
                      return renderRow(row);
                    })}
                    {virtualizer.getVirtualItems().length > 0 && (
                      <tr>
                        <td
                          colSpan={allColumns.length}
                          style={{
                            height:
                              virtualizer.getTotalSize() -
                              (virtualizer.getVirtualItems().at(-1)?.end ?? 0),
                            padding: 0,
                          }}
                        />
                      </tr>
                    )}
                  </>
                ) : (
                  <tr>
                    <td colSpan={allColumns.length} className="h-24 text-center text-muted-foreground">
                      No results.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {showScrollTop && (
            <button
              onClick={scrollToTop}
              className="absolute bottom-4 right-4 inline-flex h-8 w-8 items-center justify-center rounded-full border bg-background shadow-md transition-opacity hover:bg-accent"
              aria-label="Scroll to top"
              data-testid="scroll-to-top"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full caption-bottom text-sm" style={tableStyle}>
              {renderHeader()}
              <tbody className="[&_tr:last-child]:border-0">
                {table.getRowModel().rows.length ? (
                  table.getRowModel().rows.map((row) => renderRow(row))
                ) : (
                  <tr>
                    <td colSpan={allColumns.length} className="h-24 text-center text-muted-foreground">
                      No results.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {isServerPaginated ? renderServerPagination() : renderClientPagination()}
        </>
      )}
    </div>
  );
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/shared/components/tables/data-table.test.tsx`
Expected: PASS — all `autoFit mode`, `horizontal scroll`, and pre-existing tests pass. (The default-mode pagination tests still see `Page 1 of 3` / `25 total` from `renderClientPagination`.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/components/tables/data-table.tsx frontend/src/shared/components/tables/data-table.test.tsx
git commit -m "$(cat <<'EOF'
feat(data-table): add autoFit pagination and horizontal scroll

autoFit computes a page size that fills the viewport height
(recomputed on resize/data change, min 5 rows) and paginates
client-side. minTableWidth lets narrow viewports scroll the table
horizontally instead of squashing columns.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Search above filters (workload-explorer)

**Files:**
- Modify: `frontend/src/features/containers/pages/workload-explorer.tsx` (lines 566-694)
- Test: `frontend/src/features/containers/pages/workload-explorer.test.tsx`

- [ ] **Step 1: Write the failing test**

Add this test inside the top-level `describe('WorkloadExplorerPage', …)` (e.g. after the `'merges filter dropdowns and table into a single pane (#1313)'` test):

```tsx
  it('renders the search bar above the filter dropdowns', () => {
    mockQueryString = 'endpoint=1';
    render(<WorkloadExplorerPage />);
    const search = screen.getByTestId('workload-smart-search');
    const endpointSelect = screen.getByTestId('endpoint-select');
    // endpoint dropdown follows the search bar in document order
    expect(
      search.compareDocumentPosition(endpointSelect) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/features/containers/pages/workload-explorer.test.tsx -t "search bar above"`
Expected: FAIL — search currently renders after the dropdowns, so `endpointSelect` precedes `search`.

- [ ] **Step 3: Move the search block above the dropdowns**

In `workload-explorer.tsx`:

1. Update the comment on line 566 from:
```tsx
          {/* Merged filter + table pane (#1313): dropdowns → chips → search → table */}
```
to:
```tsx
          {/* Merged filter + table pane: search → dropdowns → chips → table */}
```

2. Delete the entire `{/* Smart search */}` block (lines 688-694):
```tsx
              {/* Smart search */}
              <WorkloadSmartSearch
                containers={filteredContainers}
                knownStackNames={knownStackNames}
                onFiltered={setSearchFilteredContainers}
                totalCount={filteredContainers.length}
              />
```

3. Re-insert it immediately after the opening `<div data-testid="workload-pane" …>` (i.e. directly before the `<div className="flex items-center gap-4 flex-wrap">` dropdown row at line 575):

```tsx
              {/* Smart search */}
              <WorkloadSmartSearch
                containers={filteredContainers}
                knownStackNames={knownStackNames}
                onFiltered={setSearchFilteredContainers}
                totalCount={filteredContainers.length}
              />

              <div className="flex items-center gap-4 flex-wrap">
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/features/containers/pages/workload-explorer.test.tsx`
Expected: PASS — the new ordering test passes; the `'merges filter dropdowns and table into a single pane'` test still passes (both the state select and table remain inside `workload-pane`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/containers/pages/workload-explorer.tsx frontend/src/features/containers/pages/workload-explorer.test.tsx
git commit -m "$(cat <<'EOF'
feat(workload-explorer): move search bar above filter dropdowns

Order is now search -> dropdowns -> chips -> table.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Group column → compact icon (workload-explorer)

**Files:**
- Modify: `frontend/src/features/containers/pages/workload-explorer.tsx` (lucide import line 5; group column lines 370-388)
- Test: `frontend/src/features/containers/pages/workload-explorer.test.tsx`

- [ ] **Step 1: Write the failing test**

Add this test to the `describe('WorkloadExplorerPage — columns (#1288)', …)` block (bottom of the file):

```tsx
  it('renders the Group cell as a labelled icon (System=Cog, Workload=Box)', () => {
    render(<WorkloadExplorerPage />);
    const groupCol = mockColumns?.find((c) => c.id === 'group');
    expect(groupCol).toBeDefined();

    // System container (beyla → grafana/beyla image)
    const systemCell = groupCol.cell({ row: { original: defaultContainersMock.data[1] } });
    const { container: sysC } = render(systemCell);
    const sysWrap = sysC.querySelector('span[aria-label="System"]');
    expect(sysWrap).not.toBeNull();
    expect(sysWrap?.querySelector('svg.lucide-cog')).toBeInTheDocument();
    expect(sysWrap?.className).toContain('bg-amber-100');

    // Workload container (workers-api-1)
    const workloadCell = groupCol.cell({ row: { original: defaultContainersMock.data[0] } });
    const { container: wlC } = render(workloadCell);
    const wlWrap = wlC.querySelector('span[aria-label="Workload"]');
    expect(wlWrap).not.toBeNull();
    expect(wlWrap?.querySelector('svg.lucide-box')).toBeInTheDocument();
    expect(wlWrap?.className).toContain('bg-slate-100');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/features/containers/pages/workload-explorer.test.tsx -t "Group cell as a labelled icon"`
Expected: FAIL — the cell renders the text label, not an `aria-label`-ed icon span.

- [ ] **Step 3: Implement the icon cell**

In `workload-explorer.tsx`, add `Box` and `Cog` to the lucide import (line 5). New import line:

```tsx
import { AlertTriangle, Box, Boxes, Cog, Download, Eye, GitCompareArrows, ScrollText, X } from 'lucide-react';
```

Replace the `group` column definition (lines 370-388) with:

```tsx
    {
      id: 'group',
      header: 'Group',
      size: 72,
      cell: ({ row }) => {
        const label = getContainerGroupLabel(row.original);
        const isSystem = label === 'System';
        const Icon = isSystem ? Cog : Box;
        return (
          <span
            title={label}
            aria-label={label}
            className={
              isSystem
                ? 'inline-flex items-center justify-center rounded-md bg-amber-100 p-1 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300'
                : 'inline-flex items-center justify-center rounded-md bg-slate-100 p-1 text-slate-700 dark:bg-slate-900/30 dark:text-slate-300'
            }
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">{label}</span>
          </span>
        );
      },
    },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/features/containers/pages/workload-explorer.test.tsx`
Expected: PASS — new Group-icon test passes; column-order test (`group` present) and CSV-export test (`row.group === 'System'`, driven by `getContainerGroupLabel`, not the cell) still pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/containers/pages/workload-explorer.tsx frontend/src/features/containers/pages/workload-explorer.test.tsx
git commit -m "$(cat <<'EOF'
feat(workload-explorer): compact Group column with labelled icons

System -> amber cog, Workload -> slate box, in a narrower column.
Keeps title/aria-label/sr-only text for accessibility.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Wire explorer to autoFit + horizontal scroll

**Files:**
- Modify: `frontend/src/features/containers/pages/workload-explorer.tsx` (DataTable usage, lines 696-708)
- Test: `frontend/src/features/containers/pages/workload-explorer.test.tsx` (DataTable mock lines 117-152; `windowScroll` test lines 954-957)

- [ ] **Step 1: Update the DataTable mock and rewrite the failing test**

In `workload-explorer.test.tsx`, replace the `DataTable` mock (lines 117-152) with one that surfaces `autoFit`/`minTableWidth` instead of `windowScroll`:

```tsx
vi.mock('@/shared/components/tables/data-table', () => ({
  DataTable: ({
    columns,
    data,
    enableRowSelection,
    maxSelection,
    onSelectionChange,
    selectedRowIds,
    onRowClick,
    autoFit,
    minTableWidth,
  }: {
    columns?: any[];
    data: Array<{ name: string }>;
    enableRowSelection?: boolean;
    maxSelection?: number;
    onSelectionChange?: (rows: Array<{ id: string; name: string; endpointId: number }>) => void;
    selectedRowIds?: Record<string, boolean>;
    onRowClick?: (row: { id: string; name: string; endpointId: number }) => void;
    autoFit?: boolean;
    minTableWidth?: number;
  }) => {
    mockOnSelectionChange = onSelectionChange;
    mockColumns = columns;
    return (
      <div
        data-testid="workloads-table"
        data-enable-row-selection={enableRowSelection ? 'true' : undefined}
        data-max-selection={maxSelection}
        data-selected-row-ids={selectedRowIds !== undefined ? JSON.stringify(selectedRowIds) : undefined}
        data-has-row-click={onRowClick ? 'true' : undefined}
        data-auto-fit={autoFit ? 'true' : undefined}
        data-min-table-width={minTableWidth}
      >
        {data.map((container) => container.name).join(',')}
      </div>
    );
  },
}));
```

Then replace the test `'passes windowScroll to the DataTable'` (lines 954-957) with:

```tsx
  it('passes autoFit to the DataTable', () => {
    render(<WorkloadExplorerPage />);
    expect(screen.getByTestId('workloads-table')).toHaveAttribute('data-auto-fit', 'true');
  });

  it('passes minTableWidth to the DataTable for horizontal scrolling', () => {
    render(<WorkloadExplorerPage />);
    expect(screen.getByTestId('workloads-table')).toHaveAttribute('data-min-table-width', '860');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/features/containers/pages/workload-explorer.test.tsx -t "to the DataTable"`
Expected: FAIL — the page still passes `windowScroll` (so `data-auto-fit` / `data-min-table-width` are absent).

- [ ] **Step 3: Switch the page to autoFit + minTableWidth**

In `workload-explorer.tsx`, replace the `<DataTable …>` usage (lines 696-708) with:

```tsx
              <DataTable
                columns={columns}
                data={searchFilteredContainers ?? filteredContainers}
                hideSearch
                autoFit
                minTableWidth={860}
                enableRowSelection
                maxSelection={MAX_COMPARE}
                onSelectionChange={handleSelectionChange}
                getRowId={(row) => `${row.endpointId}:${row.id}`}
                selectedRowIds={controlledRowIds}
                onRowClick={(row) => navigate(`/containers/${row.endpointId}/${row.id}`)}
              />
```

(Removes `pageSize={15}` and `windowScroll`; adds `autoFit` and `minTableWidth={860}`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/features/containers/pages/workload-explorer.test.tsx`
Expected: PASS — `passes autoFit` and `passes minTableWidth` pass; no remaining reference to `data-window-scroll`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/containers/pages/workload-explorer.tsx frontend/src/features/containers/pages/workload-explorer.test.tsx
git commit -m "$(cat <<'EOF'
feat(workload-explorer): paginate the list to fit the screen

Switch the table from window-scroll to autoFit pagination and pass
minTableWidth so narrow windows scroll horizontally.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Full verification + docs

**Files:**
- Modify (if applicable): `docs/architecture.md`
- Verify: whole frontend workspace

- [ ] **Step 1: Check for other callers / e2e references that assume the old behavior**

Run:
```bash
grep -rn "windowScroll" frontend/src e2e 2>/dev/null
grep -rn "Workload" e2e 2>/dev/null
```
Expected: `windowScroll` still appears as a `DataTable` prop/definition and any *other* callers (those are unaffected — the prop still exists). If any e2e spec asserts the Workload Explorer scrolls, or asserts the visible Group text "System"/"Workload" in a table cell, update it to expect pagination / the icon `aria-label`. If none, note "no e2e changes needed".

- [ ] **Step 2: Typecheck, lint, and run the full frontend suite**

Run:
```bash
npm run typecheck
npm run lint
npm run test -w frontend
```
Expected: all pass. If lint flags import ordering on the lucide imports, apply the autofix (`npm run lint -- --fix` in the affected workspace) and re-run.

- [ ] **Step 3: Build the frontend**

Run: `npm run build -w frontend`
Expected: build succeeds (no TS or bundler errors from the new props/effects).

- [ ] **Step 4: Update docs**

- Open `docs/architecture.md`; if it documents the Workload Explorer list or the `DataTable` modes (window-scroll/virtual/pagination), add a one-line note that the explorer uses `autoFit` pagination and `minTableWidth` horizontal scroll. If no such section exists, add nothing and record that in the commit body.
- Update the spec status line in `docs/superpowers/specs/2026-05-29-workload-explorer-ui-refinements-design.md` from `Status: Approved (design)` to `Status: Implemented`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
docs(workload-explorer): note autoFit list behavior; mark spec implemented

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Manual verification (recommended)**

Use the `verify` or `run` skill to launch the app and confirm in a browser:
- The list pages instead of scrolling; the page fills the viewport and re-fits on window resize.
- The search bar sits above the four filter dropdowns.
- Narrowing the window shows a horizontal scrollbar on the table.
- The Group column is a small amber cog (System) / slate box (Workload) with a tooltip.
- The selection checkbox is easy to click (larger target).
- Clicking a header shows an up/down arrow and highlights the active column.

---

## Self-Review

**Spec coverage:**
- Search above filters → Task 4. ✅
- Auto-fit pagination → Task 3 + Task 6. ✅
- Horizontal scrollbar (narrow widths) → Task 3 (`minTableWidth` + `overflow-x-auto`) + Task 6. ✅
- Group column icon + smaller → Task 5 (`size: 72`, Cog/Box, sr-only/aria-label). ✅
- Bigger checkbox hit-box → Task 2. ✅
- Sort-direction visualization → Task 1. ✅
- Testing (data-table unit tests, group-icon a11y, hit-box, ordering, pagination accounting) → Tasks 1-6; full suite + build in Task 7. ✅
- Docs → Task 7. ✅

**Type consistency:** `autoFit`/`minTableWidth` prop names match between `DataTableProps`, the page usage (Task 6), and the page mock (Task 6). `recomputeAutoPageSize`, `autoPageSize`, `pageIndex`, `autoFitWrapperRef`, `tableStyle`, `renderClientPagination` are each defined once in Task 3 and referenced consistently. Constants (`AUTO_FIT_HEADER_PX=40`, `AUTO_FIT_FOOTER_PX=56`, `AUTO_FIT_MARGIN_PX=24`, `MIN_AUTO_ROWS=5`, `ROW_HEIGHT=48`) match the values used in the test arithmetic (Task 3 Step 1).

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands include expected output.

**Known fragilities (called out inline):** lucide `svg.lucide-*` class assertions (stable across current lucide-react; `aria-sort`/`aria-label` are the load-bearing assertions); jsdom label-click forwarding (fallback to `userEvent` noted in Task 2).
