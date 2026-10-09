import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { Profiler, useCallback, useState, type ProfilerOnRenderCallback } from 'react';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { DataTable, type ColumnDef } from './data-table';

/**
 * Render-loop regression guard (#1706).
 *
 * TanStack Table 9's `useTable` returns `useMemo(() => ({ ...table, options,
 * state }), [table, tableOptions, state])`, and `tableOptions` is a fresh object
 * literal on every render — so the `table` it hands back is a new identity on
 * every render. Any effect keyed on `table` therefore runs on every render. The
 * selection notifier used to be such an effect, and it handed the parent a
 * fresh array each time; a parent that stores that array in state re-renders
 * the table, which runs the effect again: "Maximum update depth exceeded" on
 * /workloads, on mount and again on every sort.
 *
 * The vi.fn() callbacks in data-table.test.tsx cannot see this — a mock does
 * not re-render anything. These tests drive DataTable from a parent that keeps
 * the selection in real state, exactly as WorkloadExplorerPage does.
 */

interface Row {
  id: string;
  name: string;
}

const columns: ColumnDef<Row>[] = [{ accessorKey: 'name', header: 'Name' }];

const rows: Row[] = [
  { id: 'a', name: 'charlie' },
  { id: 'b', name: 'alpha' },
  { id: 'c', name: 'bravo' },
];

/** Upper bound on commits; a loop blows straight through it. */
const RENDER_BUDGET = 12;
/** Hard stop so a regression fails the assertions instead of hanging the run. */
const LOOP_GUARD = 200;

function SelectingParent({
  onSelection,
  onCommit,
}: {
  onSelection: (rows: Row[]) => void;
  onCommit: () => void;
}) {
  const [, setSelected] = useState<Row[]>([]);
  const [calls, setCalls] = useState(0);
  const handleSelectionChange = useCallback(
    (next: Row[]) => {
      onSelection(next);
      setCalls((n) => n + 1);
      // Same shape as workload-explorer's handler: store the array in state.
      setSelected(next);
    },
    [onSelection],
  );
  const onRender: ProfilerOnRenderCallback = () => onCommit();
  return (
    <Profiler id="data-table" onRender={onRender}>
      <DataTable
        columns={columns}
        data={rows}
        hideSearch
        enableRowSelection
        maxSelection={4}
        getRowId={(row) => row.id}
        // Mirrors the page, which passes an inline getRowId and re-creates
        // nothing else; the guard below stops a runaway loop after LOOP_GUARD.
        onSelectionChange={calls > LOOP_GUARD ? undefined : handleSelectionChange}
      />
    </Profiler>
  );
}

describe('DataTable — render-loop guard (#1706)', () => {
  let errorSpy: MockInstance<typeof console.error>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      // React only logs a passive-effect loop and keeps going; a loop contained
      // inside DataTable's own state cannot be stopped by LOOP_GUARD. React logs
      // from inside the looping setState, so throwing there ends the loop and
      // lets the assertions report it instead of hanging the run.
      if (args.some((a) => String(a).includes('Maximum update depth exceeded'))) {
        throw new Error('Render loop detected: Maximum update depth exceeded (#1706)');
      }
    });
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  function updateDepthErrors() {
    return errorSpy.mock.calls.filter((args) =>
      args.some((a) => String(a).includes('Maximum update depth exceeded')),
    );
  }

  it('mounting and sorting with a stateful onSelectionChange stays within a small render budget', () => {
    const onSelection = vi.fn();
    let commits = 0;
    render(
      <MemoryRouter>
        <SelectingParent onSelection={onSelection} onCommit={() => { commits += 1; }} />
      </MemoryRouter>,
    );

    expect(commits).toBeLessThanOrEqual(RENDER_BUDGET);

    const afterMount = commits;
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /name/i }));
    });

    expect(commits - afterMount).toBeLessThanOrEqual(RENDER_BUDGET);
    expect(updateDepthErrors()).toHaveLength(0);
  });

  it('does not call onSelectionChange when the selection did not change (mount, sort)', () => {
    const onSelection = vi.fn();
    render(
      <MemoryRouter>
        <SelectingParent onSelection={onSelection} onCommit={() => {}} />
      </MemoryRouter>,
    );

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /name/i }));
    });

    expect(onSelection).not.toHaveBeenCalled();
  });

  it('calls onSelectionChange exactly once per checkbox toggle, with the selected rows', () => {
    const onSelection = vi.fn();
    render(
      <MemoryRouter>
        <SelectingParent onSelection={onSelection} onCommit={() => {}} />
      </MemoryRouter>,
    );

    act(() => {
      fireEvent.click(screen.getByTestId('row-checkbox-a'));
    });
    expect(onSelection).toHaveBeenCalledTimes(1);
    expect(onSelection).toHaveBeenLastCalledWith([rows[0]]);

    act(() => {
      fireEvent.click(screen.getByTestId('row-checkbox-a'));
    });
    expect(onSelection).toHaveBeenCalledTimes(2);
    expect(onSelection).toHaveBeenLastCalledWith([]);
    expect(updateDepthErrors()).toHaveLength(0);
  });

  it('applies externalSearchValue without re-filtering on every render', () => {
    // The external-search sync is also an effect keyed on `table`, so it runs on
    // every render. It converges today only because setting an unchanged filter
    // value does not produce a new columnFilters state; pin that it stays so.
    let commits = 0;
    const onRender: ProfilerOnRenderCallback = () => {
      commits += 1;
    };
    const { rerender } = render(
      <Profiler id="search" onRender={onRender}>
        <DataTable columns={columns} data={rows} searchKey="name" externalSearchValue="al" />
      </Profiler>,
    );

    expect(commits).toBeLessThanOrEqual(RENDER_BUDGET);
    expect(updateDepthErrors()).toHaveLength(0);
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.queryByText('bravo')).not.toBeInTheDocument();

    const afterMount = commits;
    rerender(
      <Profiler id="search" onRender={onRender}>
        <DataTable columns={columns} data={rows} searchKey="name" externalSearchValue="br" />
      </Profiler>,
    );

    expect(commits - afterMount).toBeLessThanOrEqual(RENDER_BUDGET);
    expect(updateDepthErrors()).toHaveLength(0);
    expect(screen.getByText('bravo')).toBeInTheDocument();
    expect(screen.queryByText('alpha')).not.toBeInTheDocument();
  });
});
