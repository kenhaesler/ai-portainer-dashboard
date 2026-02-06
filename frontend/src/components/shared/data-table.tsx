import { useState, useRef, useCallback, useEffect } from 'react';
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
  type Row,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';
import { ArrowUpDown, ChevronLeft, ChevronRight, ArrowUp } from 'lucide-react';

const ROW_HEIGHT = 48;
const OVERSCAN = 10;
const VIRTUAL_THRESHOLD = 50;
const SCROLL_CONTAINER_HEIGHT = 600;
const SCROLL_TO_TOP_THRESHOLD = 20;

interface DataTableProps<T> {
  columns: ColumnDef<T, any>[];
  data: T[];
  searchKey?: string;
  searchPlaceholder?: string;
  pageSize?: number;
  onRowClick?: (row: T) => void;
  virtualScrolling?: boolean;
}

export function DataTable<T>({
  columns,
  data,
  searchKey,
  searchPlaceholder = 'Filter...',
  pageSize = 10,
  onRowClick,
  virtualScrolling,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const useVirtual = virtualScrolling ?? data.length > VIRTUAL_THRESHOLD;

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    ...(useVirtual ? {} : { getPaginationRowModel: getPaginationRowModel() }),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    state: { sorting, columnFilters },
    ...(useVirtual ? {} : { initialState: { pagination: { pageSize } } }),
  });

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

  const renderRow = (row: Row<T>) => (
    <tr
      key={row.id}
      className={cn(
        'border-b transition-colors duration-200 hover:bg-muted/30',
        onRowClick && 'cursor-pointer'
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
          {headerGroup.headers.map((header) => (
            <th
              key={header.id}
              style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
              className={cn(
                'h-10 px-4 text-left align-middle font-medium text-muted-foreground',
                header.column.getCanSort() && 'cursor-pointer select-none'
              )}
              onClick={header.column.getToggleSortingHandler()}
            >
              <div className="flex items-center gap-2">
                {header.isPlaceholder
                  ? null
                  : flexRender(header.column.columnDef.header, header.getContext())}
                {header.column.getCanSort() && (
                  <ArrowUpDown className="h-4 w-4" />
                )}
              </div>
            </th>
          ))}
        </tr>
      ))}
    </thead>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        {searchKey && (
          <input
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

      {useVirtual ? (
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
            <table className="w-full caption-bottom text-sm">
              {renderHeader()}
              <tbody className="[&_tr:last-child]:border-0">
                {rows.length ? (
                  <>
                    {virtualizer.getVirtualItems().length > 0 && (
                      <tr>
                        <td
                          colSpan={columns.length}
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
                          colSpan={columns.length}
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
                    <td colSpan={columns.length} className="h-24 text-center text-muted-foreground">
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
          <div className="rounded-md border">
            <table className="w-full caption-bottom text-sm">
              {renderHeader()}
              <tbody className="[&_tr:last-child]:border-0">
                {table.getRowModel().rows.length ? (
                  table.getRowModel().rows.map((row) => renderRow(row))
                ) : (
                  <tr>
                    <td colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                      No results.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {table.getPageCount() > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
                {' '}({data.length} total)
              </p>
              <div className="flex items-center gap-2">
                <button
                  className="inline-flex items-center justify-center rounded-md border border-input bg-background p-2 text-sm hover:bg-accent disabled:opacity-50"
                  onClick={() => table.previousPage()}
                  disabled={!table.getCanPreviousPage()}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  className="inline-flex items-center justify-center rounded-md border border-input bg-background p-2 text-sm hover:bg-accent disabled:opacity-50"
                  onClick={() => table.nextPage()}
                  disabled={!table.getCanNextPage()}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
