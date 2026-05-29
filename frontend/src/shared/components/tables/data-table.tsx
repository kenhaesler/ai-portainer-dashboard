import { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type RowSelectionState,
  type Row,
  type PaginationState,
  type Updater,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/shared/lib/utils';
import { Checkbox } from '@/shared/components/ui/checkbox';
import { ArrowUpDown, ChevronLeft, ChevronRight, ArrowUp, ArrowDown } from 'lucide-react';

const ROW_HEIGHT = 48;
const OVERSCAN = 10;
const VIRTUAL_THRESHOLD = 50;
const SCROLL_CONTAINER_HEIGHT = 600;
const SCROLL_TO_TOP_THRESHOLD = 20;
const AUTO_FIT_HEADER_PX = 40; // sticky header row (h-10)
const AUTO_FIT_FOOTER_PX = 56; // pagination footer reserve
const AUTO_FIT_MARGIN_PX = 24; // breathing room above the viewport bottom
const MIN_AUTO_ROWS = 5; // never page smaller than this

export interface ServerPaginationProps {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

interface DataTableProps<T> {
  columns: ColumnDef<T, any>[];
  data: T[];
  searchKey?: string;
  searchPlaceholder?: string;
  pageSize?: number;
  onRowClick?: (row: T) => void;
  virtualScrolling?: boolean;
  serverPagination?: ServerPaginationProps;
  hideSearch?: boolean;
  externalSearchValue?: string;
  enableRowSelection?: boolean;
  maxSelection?: number;
  onSelectionChange?: (selectedRows: T[]) => void;
  getRowId?: (row: T) => string;
  /** Controlled selection state — pass an empty object to clear all checkboxes */
  selectedRowIds?: RowSelectionState;
  /**
   * Render the full list with the document as the scroll container (no inner
   * scrollbar, no pagination). Disables virtualization — use only when the
   * dataset is bounded to a few hundred rows.
   */
  windowScroll?: boolean;
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
}

export function DataTable<T>({
  columns,
  data,
  searchKey,
  searchPlaceholder = 'Filter...',
  pageSize = 10,
  onRowClick,
  virtualScrolling,
  serverPagination,
  hideSearch,
  externalSearchValue,
  enableRowSelection,
  maxSelection,
  onSelectionChange,
  getRowId: getRowIdProp,
  selectedRowIds,
  windowScroll,
  autoFit,
  minTableWidth,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [pageIndex, setPageIndex] = useState(0);
  const [autoPageSize, setAutoPageSize] = useState(MIN_AUTO_ROWS);
  const autoFitWrapperRef = useRef<HTMLDivElement>(null);

  // Sync controlled selection from parent (e.g. clear all checkboxes)
  useEffect(() => {
    if (selectedRowIds !== undefined) {
      setRowSelection(selectedRowIds);
    }
  }, [selectedRowIds]);

  const [showScrollTop, setShowScrollTop] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const isServerPaginated = !!serverPagination;
  const useAutoFit = !!autoFit && !isServerPaginated;
  const useWindowScroll = !!windowScroll && !isServerPaginated && !useAutoFit;
  const useVirtual = !useWindowScroll
    && !useAutoFit
    && !isServerPaginated
    && (virtualScrolling ?? data.length > VIRTUAL_THRESHOLD);
  const useClientPagination = !useVirtual && !useWindowScroll && !isServerPaginated;

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
            />
          </label>
        );
      },
    };
  }, [enableRowSelection, maxSelection, rowSelection]);

  const allColumns = useMemo<ColumnDef<T, any>[]>(() => {
    if (!selectionColumn) return columns;
    return [selectionColumn, ...columns];
  }, [selectionColumn, columns]);

  const table = useReactTable<T>({
    data,
    columns: allColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    ...(useClientPagination ? { getPaginationRowModel: getPaginationRowModel() } : {}),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
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
    ...(enableRowSelection
      ? {
          enableRowSelection: (row) => {
            if (maxSelection === undefined) return true;
            const selectedCount = Object.keys(rowSelection).filter((k) => rowSelection[k]).length;
            return row.getIsSelected() || selectedCount < maxSelection;
          },
          onRowSelectionChange: setRowSelection,
        }
      : {}),
    state: {
      sorting,
      columnFilters,
      ...(enableRowSelection ? { rowSelection } : {}),
      ...(useAutoFit ? { pagination: { pageIndex, pageSize: autoPageSize } } : {}),
    },
    ...(useClientPagination && !useAutoFit ? { initialState: { pagination: { pageSize } } } : {}),
    ...(getRowIdProp ? { getRowId: (row: T) => getRowIdProp(row) } : {}),
  });

  // Notify parent when selection changes
  useEffect(() => {
    if (!enableRowSelection || !onSelectionChange) return;
    const selectedRows = table.getSelectedRowModel().rows.map((r) => r.original);
    onSelectionChange(selectedRows);
  }, [rowSelection, enableRowSelection, onSelectionChange, table]);

  // Sync external search value into column filter
  useEffect(() => {
    if (searchKey && externalSearchValue !== undefined) {
      table.getColumn(searchKey)?.setFilterValue(externalSearchValue);
    }
  }, [externalSearchValue, searchKey, table]);

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

  const { rows } = table.getRowModel();

  const virtualizer = useVirtualizer({
    count: useVirtual ? rows.length : 0,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    enabled: useVirtual,
  });

  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current || !useVirtual) return;
    const scrollTop = scrollContainerRef.current.scrollTop;
    setShowScrollTop(scrollTop > ROW_HEIGHT * SCROLL_TO_TOP_THRESHOLD);
  }, [useVirtual]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || !useVirtual) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll, useVirtual]);

  const scrollToTop = useCallback(() => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!useVirtual || !scrollContainerRef.current) return;
      if (e.key === 'j') {
        scrollContainerRef.current.scrollBy({ top: ROW_HEIGHT, behavior: 'smooth' });
      } else if (e.key === 'k') {
        scrollContainerRef.current.scrollBy({ top: -ROW_HEIGHT, behavior: 'smooth' });
      }
    },
    [useVirtual]
  );

  const filteredCount = rows.length;
  const totalCount = data.length;
  const searchValue = searchKey
    ? (table.getColumn(searchKey)?.getFilterValue() as string) ?? ''
    : '';
  const isFiltered = searchValue.length > 0;

  // Server pagination helpers
  const serverPageCount = serverPagination
    ? Math.ceil(serverPagination.total / serverPagination.pageSize)
    : 0;
  const canServerPrev = serverPagination ? serverPagination.page > 1 : false;
  const canServerNext = serverPagination ? serverPagination.page < serverPageCount : false;

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

  const renderRow = (row: Row<T>) => (
    <tr
      key={row.id}
      data-testid={`table-row-${row.id}`}
      className={cn(
        'group/row border-b transition-colors duration-200 hover:bg-muted/30',
        onRowClick && 'cursor-pointer',
        enableRowSelection && row.getIsSelected() && 'bg-primary/5'
      )}
      onClick={() => onRowClick?.(row.original)}
    >
      {row.getVisibleCells().map((cell) => (
        <td
          key={cell.id}
          style={{ width: cell.column.getSize() !== 150 ? cell.column.getSize() : undefined }}
          className="px-4 py-3 align-middle"
        >
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      ))}
    </tr>
  );

  const renderHeader = () => (
    <thead className={cn('[&_tr]:border-b', useVirtual && 'sticky top-0 z-10 bg-card')}>
      {table.getHeaderGroups().map((headerGroup) => (
        <tr key={headerGroup.id} className="border-b transition-colors hover:bg-muted/50">
          {headerGroup.headers.map((header) => {
            const canSort = header.column.getCanSort();
            const sorted = header.column.getIsSorted(); // false when the column is not sorted
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

  const renderServerPagination = () => {
    if (!serverPagination || serverPageCount <= 1) return null;

    return (
      <div className="flex items-center justify-between" data-testid="server-pagination">
        <p className="text-sm text-muted-foreground">
          Page {serverPagination.page} of {serverPageCount}
          {' '}({serverPagination.total} total)
        </p>
        <div className="flex items-center gap-2">
          <button
            className="inline-flex items-center justify-center rounded-md border border-input bg-background p-2 text-sm hover:bg-accent disabled:opacity-50"
            onClick={() => serverPagination.onPageChange(serverPagination.page - 1)}
            disabled={!canServerPrev}
            data-testid="server-prev-page"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            className="inline-flex items-center justify-center rounded-md border border-input bg-background p-2 text-sm hover:bg-accent disabled:opacity-50"
            onClick={() => serverPagination.onPageChange(serverPagination.page + 1)}
            disabled={!canServerNext}
            data-testid="server-next-page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  };

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
            className="scrollbar-themed overflow-x-auto rounded-md border"
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
        <div className="scrollbar-themed overflow-x-auto rounded-md border" data-testid="window-scroll-container">
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
          <div className="scrollbar-themed overflow-x-auto rounded-md border">
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
}
