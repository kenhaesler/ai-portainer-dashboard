import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DataTable } from './data-table';
import type { ColumnDef } from '@tanstack/react-table';

// Mock @tanstack/react-virtual
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: Math.min(count, 30) }, (_, i) => ({
        index: i,
        start: i * 48,
        end: (i + 1) * 48,
        size: 48,
        key: i,
      })),
    getTotalSize: () => count * 48,
    measureElement: vi.fn(),
  })),
}));

interface TestRow {
  id: number;
  name: string;
  status: string;
}

const testColumns: ColumnDef<TestRow, any>[] = [
  { accessorKey: 'id', header: 'ID' },
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'status', header: 'Status' },
];

function makeRows(count: number): TestRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `container-${i + 1}`,
    status: i % 2 === 0 ? 'running' : 'stopped',
  }));
}

describe('DataTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('pagination mode (small datasets)', () => {
    it('renders table with data', () => {
      const data = makeRows(5);
      render(<DataTable columns={testColumns} data={data} />);

      expect(screen.getByText('ID')).toBeInTheDocument();
      expect(screen.getByText('Name')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
      expect(screen.getByText('container-1')).toBeInTheDocument();
      expect(screen.getByText('container-5')).toBeInTheDocument();
    });

    it('shows pagination when data exceeds page size', () => {
      const data = makeRows(25);
      render(<DataTable columns={testColumns} data={data} pageSize={10} />);

      expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument();
      expect(screen.getByText(/25 total/)).toBeInTheDocument();
    });

    it('hides pagination when data fits in one page', () => {
      const data = makeRows(5);
      render(<DataTable columns={testColumns} data={data} pageSize={10} />);

      expect(screen.queryByText(/Page/)).not.toBeInTheDocument();
    });

    it('navigates between pages', () => {
      const data = makeRows(25);
      render(<DataTable columns={testColumns} data={data} pageSize={10} />);

      expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument();

      const nextButton = screen.getAllByRole('button').find(
        (btn) => !btn.hasAttribute('disabled') && btn.querySelector('svg')
      );
      // Find the next page button (second pagination button)
      const buttons = screen.getAllByRole('button');
      const nextBtn = buttons[buttons.length - 1]; // last button is next
      fireEvent.click(nextBtn);

      expect(screen.getByText(/Page 2 of 3/)).toBeInTheDocument();
    });

    it('shows empty state when no data', () => {
      render(<DataTable columns={testColumns} data={[]} />);
      expect(screen.getByText('No results.')).toBeInTheDocument();
    });

    it('renders search input when searchKey provided', () => {
      render(
        <DataTable
          columns={testColumns}
          data={makeRows(5)}
          searchKey="name"
          searchPlaceholder="Search containers..."
        />
      );

      expect(screen.getByPlaceholderText('Search containers...')).toBeInTheDocument();
    });

    it('filters data with search', () => {
      const data = makeRows(5);
      render(
        <DataTable columns={testColumns} data={data} searchKey="name" />
      );

      const searchInput = screen.getByPlaceholderText('Filter...');
      fireEvent.change(searchInput, { target: { value: 'container-1' } });

      expect(screen.getByText('container-1')).toBeInTheDocument();
      expect(screen.queryByText('container-2')).not.toBeInTheDocument();
    });

    it('calls onRowClick when a row is clicked', () => {
      const onClick = vi.fn();
      const data = makeRows(3);
      render(
        <DataTable columns={testColumns} data={data} onRowClick={onClick} />
      );

      fireEvent.click(screen.getByText('container-2'));
      expect(onClick).toHaveBeenCalledWith(data[1]);
    });

    it('does not render virtual scroll container in pagination mode', () => {
      render(<DataTable columns={testColumns} data={makeRows(10)} />);
      expect(screen.queryByTestId('virtual-scroll-container')).not.toBeInTheDocument();
    });
  });

  describe('virtual scrolling mode (large datasets)', () => {
    it('auto-enables virtual scrolling for data > 50 rows', () => {
      render(<DataTable columns={testColumns} data={makeRows(100)} />);

      expect(screen.getByTestId('virtual-scroll-container')).toBeInTheDocument();
      expect(screen.queryByText(/Page/)).not.toBeInTheDocument();
    });

    it('shows total count in virtual mode', () => {
      render(<DataTable columns={testColumns} data={makeRows(100)} />);

      expect(screen.getByTestId('virtual-row-count')).toHaveTextContent('100 total');
    });

    it('shows filtered count when search is active', () => {
      render(
        <DataTable columns={testColumns} data={makeRows(100)} searchKey="name" />
      );

      const searchInput = screen.getByPlaceholderText('Filter...');
      fireEvent.change(searchInput, { target: { value: 'container-1' } });

      // Will show "X of 100 match" format
      expect(screen.getByTestId('virtual-row-count')).toHaveTextContent(/of 100/);
    });

    it('renders sticky header in virtual mode', () => {
      render(<DataTable columns={testColumns} data={makeRows(100)} />);

      const thead = screen.getByTestId('virtual-scroll-container').querySelector('thead');
      expect(thead?.className).toContain('sticky');
    });

    it('has keyboard navigation support', () => {
      render(<DataTable columns={testColumns} data={makeRows(100)} />);

      const scrollContainer = screen.getByTestId('virtual-scroll-container');
      expect(scrollContainer).toHaveAttribute('tabindex', '0');
    });

    it('has accessible role and label', () => {
      render(<DataTable columns={testColumns} data={makeRows(100)} />);

      const scrollContainer = screen.getByTestId('virtual-scroll-container');
      expect(scrollContainer).toHaveAttribute('role', 'grid');
      expect(scrollContainer).toHaveAttribute('aria-label', 'Data table with virtual scrolling');
    });

    it('can be forced with virtualScrolling prop', () => {
      render(
        <DataTable columns={testColumns} data={makeRows(5)} virtualScrolling={true} />
      );

      expect(screen.getByTestId('virtual-scroll-container')).toBeInTheDocument();
    });

    it('can be disabled with virtualScrolling=false', () => {
      render(
        <DataTable columns={testColumns} data={makeRows(100)} virtualScrolling={false} />
      );

      expect(screen.queryByTestId('virtual-scroll-container')).not.toBeInTheDocument();
    });

    it('renders rows from virtualizer', () => {
      render(<DataTable columns={testColumns} data={makeRows(100)} />);

      // Our mock virtualizer returns first 30 items
      expect(screen.getByText('container-1')).toBeInTheDocument();
      expect(screen.getByText('container-30')).toBeInTheDocument();
    });

    it('sets max-height on scroll container', () => {
      render(<DataTable columns={testColumns} data={makeRows(100)} />);

      const scrollContainer = screen.getByTestId('virtual-scroll-container');
      expect(scrollContainer.style.maxHeight).toBe('600px');
    });

    it('shows empty state in virtual mode with no matching data', () => {
      render(
        <DataTable columns={testColumns} data={makeRows(100)} searchKey="name" />
      );

      const searchInput = screen.getByPlaceholderText('Filter...');
      fireEvent.change(searchInput, { target: { value: 'nonexistent-xyz' } });

      expect(screen.getByText('No results.')).toBeInTheDocument();
    });

    it('does not show scroll-to-top by default', () => {
      render(<DataTable columns={testColumns} data={makeRows(100)} />);
      expect(screen.queryByTestId('scroll-to-top')).not.toBeInTheDocument();
    });
  });

  describe('sorting', () => {
    it('renders sort icons on sortable columns', () => {
      render(<DataTable columns={testColumns} data={makeRows(5)} />);

      // Each column header should have an ArrowUpDown icon
      const headers = screen.getAllByRole('columnheader');
      headers.forEach((header) => {
        expect(header.querySelector('svg')).toBeInTheDocument();
      });
    });

    it('toggles sorting when clicking column header', () => {
      render(<DataTable columns={testColumns} data={makeRows(5)} />);

      const nameHeader = screen.getByText('Name').closest('th');
      expect(nameHeader).toBeInTheDocument();
      fireEvent.click(nameHeader!);

      // Table should still be rendered (sorting changes row order)
      expect(screen.getByText('container-1')).toBeInTheDocument();
    });
  });

  describe('server-side pagination mode', () => {
    it('renders server pagination controls when serverPagination is provided', () => {
      const onPageChange = vi.fn();
      render(
        <DataTable
          columns={testColumns}
          data={makeRows(10)}
          serverPagination={{ total: 100, page: 1, pageSize: 10, onPageChange }}
        />
      );

      expect(screen.getByTestId('server-pagination')).toBeInTheDocument();
      expect(screen.getByText(/Page 1 of 10/)).toBeInTheDocument();
      expect(screen.getByText(/100 total/)).toBeInTheDocument();
    });

    it('calls onPageChange when navigating server pages', () => {
      const onPageChange = vi.fn();
      render(
        <DataTable
          columns={testColumns}
          data={makeRows(10)}
          serverPagination={{ total: 100, page: 1, pageSize: 10, onPageChange }}
        />
      );

      const nextBtn = screen.getByTestId('server-next-page');
      fireEvent.click(nextBtn);
      expect(onPageChange).toHaveBeenCalledWith(2);
    });

    it('disables prev button on first page', () => {
      const onPageChange = vi.fn();
      render(
        <DataTable
          columns={testColumns}
          data={makeRows(10)}
          serverPagination={{ total: 100, page: 1, pageSize: 10, onPageChange }}
        />
      );

      const prevBtn = screen.getByTestId('server-prev-page');
      expect(prevBtn).toBeDisabled();
    });

    it('disables next button on last page', () => {
      const onPageChange = vi.fn();
      render(
        <DataTable
          columns={testColumns}
          data={makeRows(10)}
          serverPagination={{ total: 100, page: 10, pageSize: 10, onPageChange }}
        />
      );

      const nextBtn = screen.getByTestId('server-next-page');
      expect(nextBtn).toBeDisabled();
    });

    it('does not show client pagination when server pagination is active', () => {
      const onPageChange = vi.fn();
      render(
        <DataTable
          columns={testColumns}
          data={makeRows(10)}
          serverPagination={{ total: 30, page: 1, pageSize: 10, onPageChange }}
        />
      );

      // Should not have virtual scroll container
      expect(screen.queryByTestId('virtual-scroll-container')).not.toBeInTheDocument();
      // Should show server pagination, not client
      expect(screen.getByTestId('server-pagination')).toBeInTheDocument();
    });

    it('hides pagination when total fits in one page', () => {
      const onPageChange = vi.fn();
      render(
        <DataTable
          columns={testColumns}
          data={makeRows(5)}
          serverPagination={{ total: 5, page: 1, pageSize: 10, onPageChange }}
        />
      );

      expect(screen.queryByTestId('server-pagination')).not.toBeInTheDocument();
    });
  });

  describe('row selection', () => {
    it('does not render checkboxes when enableRowSelection is false', () => {
      render(<DataTable columns={testColumns} data={makeRows(3)} />);
      expect(screen.queryByTestId('select-all-checkbox')).not.toBeInTheDocument();
      expect(screen.queryByTestId('row-checkbox-0')).not.toBeInTheDocument();
    });

    it('renders select-all and row checkboxes when enableRowSelection is true', () => {
      render(
        <DataTable columns={testColumns} data={makeRows(3)} enableRowSelection />
      );
      expect(screen.getByTestId('select-all-checkbox')).toBeInTheDocument();
      expect(screen.getByTestId('row-checkbox-0')).toBeInTheDocument();
      expect(screen.getByTestId('row-checkbox-1')).toBeInTheDocument();
      expect(screen.getByTestId('row-checkbox-2')).toBeInTheDocument();
    });

    it('toggles individual row selection', () => {
      const onSelectionChange = vi.fn();
      const data = makeRows(3);
      render(
        <DataTable
          columns={testColumns}
          data={data}
          enableRowSelection
          onSelectionChange={onSelectionChange}
        />
      );

      const checkbox = screen.getByTestId('row-checkbox-0');
      fireEvent.click(checkbox);

      expect(onSelectionChange).toHaveBeenCalledWith([data[0]]);
    });

    it('selects all rows on page when select-all is clicked', () => {
      const onSelectionChange = vi.fn();
      const data = makeRows(3);
      render(
        <DataTable
          columns={testColumns}
          data={data}
          enableRowSelection
          onSelectionChange={onSelectionChange}
        />
      );

      const selectAll = screen.getByTestId('select-all-checkbox');
      fireEvent.click(selectAll);

      expect(onSelectionChange).toHaveBeenCalledWith(data);
    });

    it('disables unchecked row checkboxes when maxSelection is reached', () => {
      const data = makeRows(5);
      render(
        <DataTable
          columns={testColumns}
          data={data}
          enableRowSelection
          maxSelection={2}
        />
      );

      // Select first two rows
      fireEvent.click(screen.getByTestId('row-checkbox-0'));
      fireEvent.click(screen.getByTestId('row-checkbox-1'));

      // Third row should be disabled
      expect(screen.getByTestId('row-checkbox-2')).toBeDisabled();
      expect(screen.getByTestId('row-checkbox-3')).toBeDisabled();
      // Selected rows should still be enabled
      expect(screen.getByTestId('row-checkbox-0')).not.toBeDisabled();
      expect(screen.getByTestId('row-checkbox-1')).not.toBeDisabled();
    });

    it('applies bg-primary/5 class to selected rows', () => {
      const data = makeRows(3);
      render(
        <DataTable
          columns={testColumns}
          data={data}
          enableRowSelection
        />
      );

      fireEvent.click(screen.getByTestId('row-checkbox-0'));

      const selectedRow = screen.getByTestId('table-row-0');
      expect(selectedRow.className).toContain('bg-primary/5');
    });

    it('uses custom getRowId when provided', () => {
      const data = makeRows(3);
      render(
        <DataTable
          columns={testColumns}
          data={data}
          enableRowSelection
          getRowId={(row) => `custom-${row.id}`}
        />
      );

      // Row IDs should use custom format
      expect(screen.getByTestId('row-checkbox-custom-1')).toBeInTheDocument();
      expect(screen.getByTestId('row-checkbox-custom-2')).toBeInTheDocument();
    });

    it('clears internal selection when selectedRowIds is set to empty', () => {
      const data = makeRows(3);
      const { rerender } = render(
        <DataTable
          columns={testColumns}
          data={data}
          enableRowSelection
        />
      );

      // Select a row
      fireEvent.click(screen.getByTestId('row-checkbox-0'));
      expect(screen.getByTestId('table-row-0').className).toContain('bg-primary/5');

      // Parent clears selection via selectedRowIds
      rerender(
        <DataTable
          columns={testColumns}
          data={data}
          enableRowSelection
          selectedRowIds={{}}
        />
      );

      // Row should no longer be highlighted
      expect(screen.getByTestId('table-row-0').className).not.toContain('bg-primary/5');
    });
  });
});
